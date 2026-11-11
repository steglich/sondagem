/**
 * Runner de cenários: executa os passos de um cenário pelo CDP, de forma repetível.
 *
 * Não usa `chrome.*`: a conexão de CDP, o relógio e o sinal de cancelamento chegam
 * por `AmbienteRunner`, e os testes rodam com um transporte falso e um relógio
 * simulado. Toda espera é uma sondagem com prazo, para que o cancelamento e o
 * tempo limite sejam vistos em até 50 ms.
 *
 * O runner altera o `AndamentoExecucao` recebido e avisa por `aoMudar` a cada
 * transição de estado e a cada início ou fim de iteração. O debugger é sempre
 * desanexado ao sair, inclusive em erro e cancelamento.
 */
import {
  type Cenario,
  INATIVIDADE_PADRAO_MS,
  type Passo,
  type PassoDeAcao,
  type PassoDeMedicao,
  TEMPO_LIMITE_PADRAO_MS,
  TENTATIVAS_EXTRAS,
  passoAtivo,
  resolverVezes,
} from '../shared/cenario.ts';
import { ESTADOS_FINAIS, transitar } from '../shared/execucao-estado.ts';
import type {
  Ambiente,
  AndamentoExecucao,
  DadosColetados,
  ErroDePasso,
  EstadoExecucao,
  Marca,
  RegistroIteracao,
} from '../shared/types.ts';
import { ConexaoPerdida, type ConexaoCdp } from './cdp.ts';
import {
  type ContextoMemoria,
  forcarColeta,
  lerContadoresDom,
  medirMemoria,
  tirarSnapshot,
} from './memoria.ts';

/** Intervalo das sondagens (`esperar` por seletor, localização de elemento, inatividade). */
export const INTERVALO_SONDAGEM_MS = 50;

/** Tempo limite do passo `snapshot` sem `tempo_limite_ms`: contar um heap grande leva bem mais que os outros passos. */
export const TEMPO_LIMITE_SNAPSHOT_MS = 120_000;

/** Motivos usados em `AbortController.abort()` para parar o runner. */
export const MOTIVO_CANCELAMENTO = 'cancelada';
export const MOTIVO_CONEXAO_PERDIDA = 'conexao-perdida';

export interface Relogio {
  agora(): number;
  /** Resolve depois de `ms`; rejeita se o sinal for acionado antes. */
  esperar(ms: number, sinal?: AbortSignal): Promise<void>;
}

export const relogioReal: Relogio = {
  agora: Date.now,
  esperar: (ms, sinal) =>
    new Promise((resolver, rejeitar) => {
      if (sinal?.aborted) return rejeitar(sinal.reason);
      const abortar = (): void => {
        clearTimeout(temporizador);
        rejeitar(sinal?.reason);
      };
      const temporizador = setTimeout(() => {
        sinal?.removeEventListener('abort', abortar);
        resolver();
      }, ms);
      sinal?.addEventListener('abort', abortar, { once: true });
    }),
};

export interface PlanoExecucao {
  cenario: Cenario;
  /** Iterações já resolvidas (confirmação → cenário → padrão). */
  iteracoes: number;
  /** Verificações marcadas; os passos de medição das outras não rodam. */
  verificacoesAtivas: readonly string[];
}

export interface AmbienteRunner {
  cdp: Pick<ConexaoCdp, 'enviar' | 'aoEvento' | 'desanexar'>;
  relogio: Relogio;
  /** Cancelamento (ou conexão perdida): nenhum passo começa depois de acionado. */
  sinal: AbortSignal;
  /** Fim, em ms desde a época, da última long task reportada pela página; `null` se nenhuma. */
  ultimaLongTask: () => number | null;
  /** Onde os passos de memória guardam o que medem. */
  memoria: { dados: DadosColetados; limiteConstrutores?: number };
  /**
   * O andamento mudou. Com `marca`, é o início ou o fim de uma iteração (ou do
   * aquecimento), que o service worker repassa à página e usa para carimbar os registros.
   */
  aoMudar: (andamento: AndamentoExecucao, marca?: Marca) => void;
}

class Cancelado extends Error {}
/** Falha de um passo; a política `em_erro` decide o que acontece. */
class FalhaDePasso extends Error {}
/** Um passo falhou com `interromper` (ou esgotou as tentativas): a execução acaba. */
class ExecucaoInterrompida extends Error {}

interface Contexto {
  /** Registro da iteração em curso, ou `null` fora das iterações. */
  iteracao: RegistroIteracao | null;
  aquecimento: boolean;
}

interface Localizacao {
  estado: 'ausente' | 'invisivel' | 'ok';
  x?: number;
  y?: number;
  /** Descrição do elemento que está por cima, ou `null`. */
  coberto?: string | null;
}

interface RespostaEvaluate {
  result?: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

/** Expressão que localiza o elemento, rola até ele e devolve o centro e quem está por cima. */
function expressaoLocalizar(seletor: string): string {
  return `(() => {
  const el = document.querySelector(${JSON.stringify(seletor)});
  if (!el) return { estado: 'ausente' };
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { estado: 'invisivel' };
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  const topo = document.elementFromPoint(x, y);
  const livre = topo !== null && (topo === el || el.contains(topo));
  const descrever = (e) => e ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.dataset && e.dataset.testid ? '[data-testid="' + e.dataset.testid + '"]' : '') : 'fora da área visível';
  return { estado: 'ok', x, y, coberto: livre ? null : descrever(topo) };
})()`;
}

/** Soma os `vezes` dos `repetir` do nível principal: cada volta deles é uma iteração numerada. */
export function contarIteracoes(passos: readonly Passo[], iteracoes: number): number {
  return passos.reduce((total, passo) => total + (passo.tipo === 'repetir' ? resolverVezes(passo.vezes, iteracoes) : 0), 0);
}

/**
 * Executa o cenário e devolve o andamento final (o mesmo objeto recebido). O estado
 * final é `concluida`, `erro` ou `cancelada`; nunca rejeita.
 */
export async function executarCenario(
  plano: PlanoExecucao,
  ambiente: AmbienteRunner,
  andamento: AndamentoExecucao,
): Promise<AndamentoExecucao> {
  const { cdp, relogio, sinal } = ambiente;
  const { cenario } = plano;
  andamento.totalIteracoes = contarIteracoes(cenario.passos, plano.iteracoes);

  // Rejeita quando o sinal é acionado, para soltar um comando de CDP que não volta.
  const abortado = new Promise<never>((_, rejeitar) => {
    if (sinal.aborted) rejeitar(new Cancelado());
    else sinal.addEventListener('abort', () => rejeitar(new Cancelado()), { once: true });
  });
  abortado.catch(() => undefined);

  const cancelarAssinaturas: (() => void)[] = [];
  const rede = { pendentes: new Set<string>(), ultimaAtividade: 0 };

  function conferirCancelamento(): void {
    if (sinal.aborted) throw new Cancelado();
  }

  function enviar<T>(metodo: string, parametros?: object): Promise<T> {
    conferirCancelamento();
    return Promise.race([cdp.enviar<T>(metodo, parametros), abortado]);
  }

  async function pausar(ms: number): Promise<void> {
    try {
      await relogio.esperar(ms, sinal);
    } catch (erro) {
      if (sinal.aborted) throw new Cancelado();
      throw erro;
    }
  }

  function ir(para: EstadoExecucao): void {
    andamento.estado = transitar(andamento.estado, para);
    ambiente.aoMudar(andamento);
  }

  async function avaliar<T>(expressao: string): Promise<T> {
    const resposta = await enviar<RespostaEvaluate>('Runtime.evaluate', { expression: expressao, returnByValue: true });
    if (resposta.exceptionDetails) {
      const detalhe = resposta.exceptionDetails.exception?.description ?? resposta.exceptionDetails.text ?? 'erro';
      throw new FalhaDePasso(`A página recusou a operação: ${detalhe.split('\n')[0]}`);
    }
    return resposta.result?.value as T;
  }

  function prazoDe(passo: { tempo_limite_ms?: number }): { limite: number; ms: number } {
    const ms = passo.tempo_limite_ms ?? TEMPO_LIMITE_PADRAO_MS;
    return { limite: relogio.agora() + ms, ms };
  }

  /**
   * Espera o elemento existir e ficar parado (duas leituras iguais). Com `livre`,
   * exige também que nada esteja por cima do ponto do clique.
   */
  async function localizar(seletor: string, prazo: { limite: number; ms: number }, livre: boolean): Promise<{ x: number; y: number }> {
    let anterior: Localizacao | null = null;
    for (;;) {
      const atual = await avaliar<Localizacao>(expressaoLocalizar(seletor));
      const parado = atual.estado === 'ok' && anterior?.estado === 'ok' && anterior.x === atual.x && anterior.y === atual.y;
      if (parado && (!livre || !atual.coberto)) return { x: atual.x!, y: atual.y! };
      if (relogio.agora() >= prazo.limite) {
        const motivo =
          atual.estado === 'ausente'
            ? `nenhum elemento corresponde a "${seletor}"`
            : atual.estado === 'invisivel'
              ? `o elemento "${seletor}" não ficou visível`
              : !parado
                ? `o elemento "${seletor}" não parou de se mover`
                : `outro elemento está por cima de "${seletor}" (${atual.coberto})`;
        throw new FalhaDePasso(`Tempo limite de ${prazo.ms} ms: ${motivo}.`);
      }
      anterior = atual;
      await pausar(INTERVALO_SONDAGEM_MS);
    }
  }

  async function navegar(url: string, prazo: { limite: number; ms: number }): Promise<void> {
    let destino: string;
    try {
      destino = new URL(url, cenario.url_inicial).href;
    } catch {
      throw new FalhaDePasso(`Endereço inválido: "${url}".`);
    }
    let carregou = false;
    const cancelar = cdp.aoEvento('Page.loadEventFired', () => (carregou = true));
    try {
      const resposta = await enviar<{ errorText?: string; loaderId?: string }>('Page.navigate', { url: destino });
      if (resposta.errorText) throw new FalhaDePasso(`Não foi possível abrir ${destino}: ${resposta.errorText}.`);
      // Sem `loaderId`, a navegação ficou no mesmo documento (mudança de hash): não há carregamento a esperar.
      if (!resposta.loaderId) return;
      while (!carregou) {
        if (relogio.agora() >= prazo.limite) {
          throw new FalhaDePasso(`Tempo limite de ${prazo.ms} ms: ${destino} não terminou de carregar.`);
        }
        await pausar(INTERVALO_SONDAGEM_MS);
      }
    } finally {
      cancelar();
    }
  }

  async function executarAcao(passo: PassoDeAcao): Promise<void> {
    const prazo = prazoDe(passo);
    switch (passo.tipo) {
      case 'navegar':
        return navegar(passo.url, prazo);

      case 'clicar': {
        const { x, y } = await localizar(passo.seletor, prazo, true);
        // Entrada pelo domínio `Input`: os eventos chegam à página como os de um usuário (`isTrusted`).
        await enviar('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await enviar('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await enviar('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        return;
      }

      case 'digitar': {
        await localizar(passo.seletor, prazo, false);
        const focado = await avaliar<boolean>(`(() => {
  const el = document.querySelector(${JSON.stringify(passo.seletor)});
  if (!el) return false;
  el.focus();
  if (${passo.limpar === true} && typeof el.select === 'function') el.select();
  return document.activeElement === el;
})()`);
        if (!focado) throw new FalhaDePasso(`O elemento "${passo.seletor}" não aceita foco.`);
        await enviar('Input.insertText', { text: passo.texto });
        return;
      }

      case 'rolar': {
        const ponto = passo.seletor
          ? await localizar(passo.seletor, prazo, false)
          : await avaliar<{ x: number; y: number }>('({ x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) })');
        await enviar('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: ponto.x,
          y: ponto.y,
          deltaX: passo.x ?? 0,
          deltaY: passo.y ?? 0,
        });
        return;
      }

      case 'esperar': {
        if (passo.seletor === undefined) return pausar(passo.ms ?? 0);
        const expressao = `document.querySelector(${JSON.stringify(passo.seletor)}) !== null`;
        while (!(await avaliar<boolean>(expressao))) {
          if (relogio.agora() >= prazo.limite) {
            throw new FalhaDePasso(`Tempo limite de ${prazo.ms} ms: nenhum elemento corresponde a "${passo.seletor}".`);
          }
          await pausar(INTERVALO_SONDAGEM_MS);
        }
        return;
      }

      case 'aguardar_inatividade': {
        const janela = passo.ms ?? INATIVIDADE_PADRAO_MS;
        const inicio = relogio.agora();
        for (;;) {
          const agora = relogio.agora();
          const desde = Math.max(inicio, rede.ultimaAtividade, ambiente.ultimaLongTask() ?? 0);
          if (rede.pendentes.size === 0 && agora - desde >= janela) return;
          if (agora >= prazo.limite) {
            const causa = rede.pendentes.size > 0 ? `${rede.pendentes.size} requisição(ões) em andamento` : 'long tasks seguidas';
            throw new FalhaDePasso(`Tempo limite de ${prazo.ms} ms: a página não ficou ${janela} ms inativa (${causa}).`);
          }
          await pausar(INTERVALO_SONDAGEM_MS);
        }
      }
    }
  }

  /** Comandos pelo `enviar` daqui, para que o cancelamento solte também os passos de memória. */
  const memoria: ContextoMemoria = {
    cdp: { enviar },
    dados: ambiente.memoria.dados,
    agora: () => relogio.agora(),
    limiteConstrutores: ambiente.memoria.limiteConstrutores,
  };

  /** Espera a operação por sondagem, para que o prazo e o cancelamento sejam vistos. */
  async function comPrazo<T>(operacao: Promise<T>, prazo: { limite: number; ms: number }, oQue: string): Promise<T> {
    let pendente = true;
    const assentada = operacao.then(
      (valor) => ({ valor }),
      (erro: unknown) => ({ erro }),
    );
    void assentada.then(() => (pendente = false));
    while (pendente) {
      if (relogio.agora() >= prazo.limite) throw new FalhaDePasso(`Tempo limite de ${prazo.ms} ms: ${oQue}.`);
      await pausar(INTERVALO_SONDAGEM_MS);
    }
    const desfecho = await assentada;
    if ('erro' in desfecho) throw desfecho.erro;
    return desfecho.valor;
  }

  /** Passos de medição. Só chegam aqui com a verificação "Memória" marcada (ver `passoAtivo`). */
  async function executarMedicao(passo: PassoDeMedicao, contexto: Contexto): Promise<void> {
    const iteracao = contexto.iteracao?.numero ?? null;
    switch (passo.tipo) {
      case 'forcar_gc':
        return forcarColeta(memoria);
      case 'medir':
        await medirMemoria(memoria, passo.metricas, iteracao);
        return;
      case 'snapshot': {
        const ms = passo.tempo_limite_ms ?? TEMPO_LIMITE_SNAPSHOT_MS;
        await comPrazo(tirarSnapshot(memoria, passo.rotulo, iteracao), { limite: relogio.agora() + ms, ms }, 'a contagem de objetos não terminou');
      }
    }
  }

  /** Contadores de início e de fim para "DOM e listeners". Sem eles o resultado ainda vale. */
  async function contarDom(momento: 'inicio' | 'fim'): Promise<void> {
    if (!plano.verificacoesAtivas.includes('dom-listeners')) return;
    try {
      await lerContadoresDom(memoria, momento);
    } catch (erro) {
      if (erro instanceof Cancelado || erro instanceof ConexaoPerdida) throw erro;
    }
  }

  /** Executa um passo aplicando `em_erro`. Devolve sem lançar se o passo foi pulado. */
  async function executarComPolitica(passo: PassoDeAcao | PassoDeMedicao, caminho: string, contexto: Contexto): Promise<void> {
    const politica = passo.em_erro ?? 'interromper';
    const tentativas = politica === 'repetir' ? 1 + TENTATIVAS_EXTRAS : 1;
    for (let tentativa = 1; ; tentativa++) {
      conferirCancelamento();
      try {
        if (passo.tipo === 'medir' || passo.tipo === 'snapshot' || passo.tipo === 'forcar_gc') await executarMedicao(passo, contexto);
        else await executarAcao(passo);
        andamento.passosExecutados++;
        if (contexto.iteracao) contexto.iteracao.passosExecutados++;
        return;
      } catch (erro) {
        if (erro instanceof Cancelado || erro instanceof ConexaoPerdida) throw erro;
        if (tentativa < tentativas) continue;
        const motivo = erro instanceof Error ? erro.message : String(erro);
        const falha: ErroDePasso = {
          caminho,
          tipoPasso: passo.tipo,
          iteracao: contexto.iteracao?.numero ?? null,
          motivo: tentativas > 1 ? `${motivo} (${tentativas} tentativas)` : motivo,
          acao: politica === 'pular' ? 'pulou' : 'interrompeu',
        };
        andamento.falhas.push(falha);
        // Com um passo a menos, a iteração não é comparável às outras: fica fora das estatísticas.
        if (contexto.iteracao) contexto.iteracao.completa = false;
        ambiente.aoMudar(andamento);
        if (politica === 'pular') return;
        throw new ExecucaoInterrompida(motivo);
      }
    }
  }

  async function executarLista(lista: readonly Passo[], caminhoBase: string, contexto: Contexto): Promise<void> {
    for (const [indice, passo] of lista.entries()) {
      conferirCancelamento();
      const caminho = `${caminhoBase}/${indice}`;
      // Passo de medição sem verificação ativa não roda. O índice segue o do documento.
      if (!passoAtivo(passo, plano.verificacoesAtivas)) continue;
      if (passo.tipo !== 'repetir') {
        await executarComPolitica(passo, caminho, contexto);
        continue;
      }
      const vezes = resolverVezes(passo.vezes, plano.iteracoes);
      // Só as voltas de um `repetir` do nível principal são iterações numeradas.
      const numerada = contexto.iteracao === null && !contexto.aquecimento;
      for (let volta = 1; volta <= vezes; volta++) {
        conferirCancelamento();
        if (!numerada) {
          await executarLista(passo.passos, `${caminho}/passos`, contexto);
          continue;
        }
        const registro: RegistroIteracao = {
          numero: andamento.iteracao + 1,
          inicio: relogio.agora(),
          fim: null,
          completa: true,
          passosExecutados: 0,
        };
        andamento.iteracao = registro.numero;
        andamento.iteracoes.push(registro);
        ambiente.aoMudar(andamento, { fase: 'inicio', iteracao: registro.numero });
        try {
          await executarLista(passo.passos, `${caminho}/passos`, { iteracao: registro, aquecimento: false });
        } catch (erro) {
          registro.completa = false;
          throw erro;
        }
        andamento.estado = transitar(andamento.estado, 'coletando');
        registro.fim = relogio.agora();
        ambiente.aoMudar(andamento, { fase: 'fim', iteracao: registro.numero });
        ir('executando');
      }
    }
  }

  async function lerAmbiente(): Promise<Ambiente | null> {
    try {
      const pagina = await avaliar<{ ua: string; largura: number; altura: number; dpr: number }>(
        '({ ua: navigator.userAgent, largura: innerWidth, altura: innerHeight, dpr: devicePixelRatio })',
      );
      let versao = /Chrom(?:e|ium)\/([\d.]+)/.exec(pagina.ua)?.[1] ?? 'desconhecida';
      try {
        // O user agent traz só a versão principal; `Browser.getVersion` traz a completa.
        const { product } = await enviar<{ product?: string }>('Browser.getVersion');
        versao = product?.split('/')[1] ?? versao;
      } catch (erro) {
        if (erro instanceof Cancelado || erro instanceof ConexaoPerdida) throw erro;
      }
      return {
        versaoNavegador: versao,
        userAgent: pagina.ua,
        janela: { largura: pagina.largura, altura: pagina.altura },
        dpr: pagina.dpr,
      };
    } catch (erro) {
      if (erro instanceof Cancelado || erro instanceof ConexaoPerdida) throw erro;
      // Sem os dados do ambiente o resultado ainda vale; fica registrado como indisponível.
      return null;
    }
  }

  function acompanharRede(): void {
    const tocar = (): void => void (rede.ultimaAtividade = relogio.agora());
    const id = (parametros: unknown): string => String((parametros as { requestId?: unknown }).requestId);
    cancelarAssinaturas.push(
      cdp.aoEvento('Network.requestWillBeSent', (p) => {
        rede.pendentes.add(id(p));
        tocar();
      }),
      cdp.aoEvento('Network.loadingFinished', (p) => {
        rede.pendentes.delete(id(p));
        tocar();
      }),
      cdp.aoEvento('Network.loadingFailed', (p) => {
        rede.pendentes.delete(id(p));
        tocar();
      }),
      // Requisições do documento anterior que ficaram sem desfecho não contam para o novo.
      cdp.aoEvento('Page.frameNavigated', (p) => {
        if (!(p as { frame?: { parentId?: string } }).frame?.parentId) rede.pendentes.clear();
      }),
    );
  }

  try {
    ir('preparando');
    acompanharRede();
    await enviar('Page.enable');
    await enviar('Network.enable');
    // Carga nova da URL inicial, antes do aquecimento.
    try {
      await navegar(cenario.url_inicial, prazoDe({}));
    } catch (erro) {
      if (!(erro instanceof FalhaDePasso)) throw erro;
      andamento.falhas.push({ caminho: '/url_inicial', tipoPasso: 'navegar', iteracao: null, motivo: erro.message, acao: 'interrompeu' });
      throw new ExecucaoInterrompida(erro.message);
    }
    andamento.ambiente = await lerAmbiente();

    if (cenario.aquecimento?.length) {
      andamento.estado = transitar(andamento.estado, 'aquecendo');
      andamento.aquecimento = { inicio: relogio.agora(), fim: null };
      ambiente.aoMudar(andamento, { fase: 'inicio', iteracao: 'aquecimento' });
      await executarLista(cenario.aquecimento, '/aquecimento', { iteracao: null, aquecimento: true });
      andamento.aquecimento.fim = relogio.agora();
      ambiente.aoMudar(andamento, { fase: 'fim', iteracao: 'aquecimento' });
    }

    await contarDom('inicio');
    ir('executando');
    await executarLista(cenario.passos, '/passos', { iteracao: null, aquecimento: false });
    ir('coletando');
    await contarDom('fim');
    ir('concluida');
  } catch (erro) {
    if (andamento.aquecimento && andamento.aquecimento.fim === null) andamento.aquecimento.fim = relogio.agora();
    const cancelada = erro instanceof Cancelado && sinal.reason !== MOTIVO_CONEXAO_PERDIDA;
    if (!cancelada && !(erro instanceof ExecucaoInterrompida)) {
      const perdeu = erro instanceof ConexaoPerdida || erro instanceof Cancelado;
      andamento.falhas.push({
        caminho: '',
        tipoPasso: '',
        iteracao: andamento.iteracoes.find((i) => i.fim === null)?.numero ?? null,
        motivo: perdeu ? 'A conexão com o debugger foi perdida.' : erro instanceof Error ? erro.message : String(erro),
        acao: 'interrompeu',
      });
    }
    if (!ESTADOS_FINAIS.includes(andamento.estado)) {
      andamento.estado = transitar(andamento.estado, cancelada ? 'cancelada' : 'erro');
    }
    ambiente.aoMudar(andamento);
  } finally {
    cancelarAssinaturas.forEach((cancelar) => cancelar());
    await cdp.desanexar();
  }
  return andamento;
}
