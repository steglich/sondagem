/**
 * Orquestração da sessão no service worker: início, agregação dos lotes,
 * publicação de status, parada com limpeza e recuperação.
 *
 * Tudo o que depende de `chrome.*` chega por `AmbienteSessao`, para que a
 * lógica rode em testes unitários. As operações passam por uma fila, uma de
 * cada vez, porque quase todas leem e gravam o mesmo estado.
 */
import { aplicarLote } from '../shared/agregacao.ts';
import { type Limitador, criarLimitador } from '../shared/limitador.ts';
import { comecarParada, concluir, estadoInicial, iniciar, visaoDe } from '../shared/sessao-estado.ts';
import {
  type ComandoInterface,
  type Desconectados,
  type Desfecho,
  type EstadoSessao,
  INTERVALO_LOTE_MS,
  type ItemLimpeza,
  type Lote,
  type MensagemDaPagina,
  type MensagemParaPagina,
  type MotivoRecusa,
  type RespostaComando,
  type VisaoSessao,
} from '../shared/types.ts';
import { avaliarUrl } from '../shared/url.ts';
import { normalizarSelecao } from '../shared/verificacoes.ts';

export const ID_SCRIPT_SESSAO = 'sondagem-sessao';

/** Quanto esperar pela resposta da página ao pedido de encerramento. */
export const ESPERA_ENCERRAMENTO_MS = 1500;

export interface AmbienteSessao {
  lerEstado(): Promise<EstadoSessao | undefined>;
  gravarEstado(estado: EstadoSessao): Promise<void>;
  /** URL da aba, ou `null` se a aba não existe mais. */
  urlDaAba(idAba: number): Promise<string | null | undefined>;
  /** Registra o content script dinâmico da sessão para o padrão de URL dado. */
  registrarScript(id: string, padrao: string): Promise<void>;
  /** Remove os content scripts dinâmicos (todos, se `ids` for omitido). Devolve quantos removeu. */
  removerScripts(ids?: string[]): Promise<number>;
  /** Injeta o código de medição na aba já aberta. */
  injetar(idAba: number): Promise<void>;
  /** Envia a visão atual à interface. */
  publicar(visao: VisaoSessao): void;
  agora(): number;
}

/** Porta aberta pelo código injetado, já reduzida ao que a orquestração usa. */
export interface PortaDaPagina {
  idAba: number | undefined;
  idQuadro: number | undefined;
  enviar(mensagem: MensagemParaPagina): void;
  desconectar(): void;
  aoReceber(ouvinte: (mensagem: MensagemDaPagina) => void): void;
  aoDesconectar(ouvinte: () => void): void;
}

export interface Orquestrador {
  /** Lê o estado gravado e desfaz o que uma sessão anterior tenha deixado. Chamar ao acordar. */
  recuperar(): Promise<void>;
  comando(comando: ComandoInterface): Promise<RespostaComando>;
  portaConectada(porta: PortaDaPagina): void;
  abaRemovida(idAba: number): Promise<void>;
}

interface Encerramento {
  lote: Lote;
  desconectados: Desconectados;
}

const MENSAGENS: Record<MotivoRecusa, string> = {
  'sessao-ativa': 'Já existe uma análise em andamento.',
  'sem-sessao': 'Não há análise em andamento.',
  'sem-verificacao': 'Marque ao menos uma verificação.',
  'url-nao-suportada': 'Esta página não pode ser analisada.',
  erro: 'Não foi possível iniciar a análise.',
};

export function criarOrquestrador(ambiente: AmbienteSessao): Orquestrador {
  let estado: EstadoSessao = estadoInicial();
  let fila: Promise<unknown> = Promise.resolve();
  /** Portas aceitas (já configuradas) da aba em análise. */
  const portas = new Set<PortaDaPagina>();
  /** Quem espera o `encerrado` de cada porta durante a parada. */
  const aguardandoEncerramento = new Map<PortaDaPagina, (resposta: Encerramento | null) => void>();
  /** Lotes que chegam enquanto a parada está em curso, fora da fila. */
  let lotesTardios: Lote[] | null = null;

  const limitador: Limitador = criarLimitador(INTERVALO_LOTE_MS, () => ambiente.publicar(visaoDe(estado)), ambiente.agora);

  function enfileirar<T>(operacao: () => Promise<T>): Promise<T> {
    const resultado = fila.then(operacao);
    fila = resultado.catch((erro: unknown) => console.error('Sondagem: falha na sessão', erro));
    return resultado;
  }

  async function gravar(novo: EstadoSessao): Promise<void> {
    estado = novo;
    await ambiente.gravarEstado(estado);
  }

  function aceita(): RespostaComando {
    return { ok: true, visao: visaoDe(estado) };
  }

  function recusa(motivo: MotivoRecusa, mensagem = MENSAGENS[motivo]): RespostaComando {
    return { ok: false, motivo, mensagem, visao: visaoDe(estado) };
  }

  async function iniciarSessao(idAba: number, selecaoPedida: unknown): Promise<RespostaComando> {
    if (estado.fase !== 'ociosa') return recusa('sessao-ativa');
    const selecao = normalizarSelecao(selecaoPedida);
    if (selecao.length === 0) return recusa('sem-verificacao');

    const url = await ambiente.urlDaAba(idAba);
    const avaliacao = avaliarUrl(url);
    if (!url || !avaliacao.suportada) {
      return recusa('url-nao-suportada', avaliacao.suportada ? MENSAGENS['url-nao-suportada'] : avaliacao.motivo);
    }

    const anterior = estado;
    try {
      // Sobra de uma sessão que não terminou direito não pode impedir o registro.
      await ambiente.removerScripts([ID_SCRIPT_SESSAO]);
      await ambiente.registrarScript(ID_SCRIPT_SESSAO, avaliacao.padrao);
      const transicao = iniciar(estado, {
        idAba,
        url,
        selecao,
        inicio: ambiente.agora(),
        idsScripts: [ID_SCRIPT_SESSAO],
      });
      if (!transicao.ok) return recusa(transicao.motivo);
      // O estado é gravado antes da injeção: o script conecta assim que roda,
      // e a porta só é aceita com a sessão ativa.
      await gravar(transicao.estado);
      await ambiente.injetar(idAba);
    } catch (erro) {
      await ambiente.removerScripts([ID_SCRIPT_SESSAO]).catch(() => 0);
      await gravar(anterior);
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      return recusa('erro', `${MENSAGENS.erro} ${detalhe}`);
    }

    limitador.imediato();
    return aceita();
  }

  /** Pede o encerramento a cada porta e espera a resposta, a queda da porta ou o tempo limite. */
  async function encerrarPaginas(): Promise<{ respostas: Encerramento[]; temporizadores: number }> {
    let temporizadores = 0;
    const esperas = [...portas].map(
      (porta) =>
        new Promise<Encerramento | null>((resolver) => {
          const limite = setTimeout(() => concluirEspera(null), ESPERA_ENCERRAMENTO_MS);
          temporizadores++;
          function concluirEspera(resposta: Encerramento | null): void {
            clearTimeout(limite);
            aguardandoEncerramento.delete(porta);
            resolver(resposta);
          }
          aguardandoEncerramento.set(porta, concluirEspera);
          try {
            porta.enviar({ tipo: 'encerrar' });
          } catch {
            concluirEspera(null);
          }
        }),
    );
    const respostas = (await Promise.all(esperas)).filter((r) => r !== null);
    return { respostas, temporizadores };
  }

  /**
   * Desfaz tudo o que a sessão instalou e guarda o resultado. Com `avisarPagina`,
   * pede antes à página que desligue os observadores e mande o último lote.
   */
  async function finalizar(desfecho: Desfecho, avisarPagina: boolean): Promise<void> {
    const sessao = estado.sessao;
    if (!sessao) return;

    // Contadas antes do pedido: a página fecha a própria porta logo depois de responder.
    const portasDaSessao = portas.size;
    lotesTardios = [];
    const encerramento = avisarPagina ? await encerrarPaginas() : { respostas: [], temporizadores: 0 };
    for (const lote of lotesTardios) aplicarLote(sessao.dados, lote);
    lotesTardios = null;
    for (const resposta of encerramento.respostas) aplicarLote(sessao.dados, resposta.lote);

    const scripts = await ambiente.removerScripts(sessao.idsScripts).catch(() => 0);

    for (const porta of portas) {
      try {
        porta.desconectar();
      } catch {
        // A porta já caiu do outro lado.
      }
    }
    portas.clear();

    const publicacaoPendente = limitador.cancelar() ? 1 : 0;
    const somar = (campo: keyof Desconectados): number =>
      encerramento.respostas.reduce((total, r) => total + r.desconectados[campo], 0);

    const limpeza: ItemLimpeza[] = (
      [
        { recurso: 'script-registrado', quantidade: scripts },
        { recurso: 'observador', quantidade: somar('observadores') },
        { recurso: 'listener', quantidade: somar('listeners') },
        { recurso: 'porta', quantidade: portasDaSessao },
        {
          recurso: 'temporizador',
          quantidade: somar('temporizadores') + encerramento.temporizadores + publicacaoPendente,
        },
      ] satisfies ItemLimpeza[]
    ).filter((item) => item.quantidade > 0);

    const transicao = concluir(estado, {
      desfecho,
      fim: ambiente.agora(),
      limpeza,
      paginaRespondeu: encerramento.respostas.length > 0,
    });
    if (transicao.ok) await gravar(transicao.estado);
    limitador.imediato();
  }

  async function pararSessao(desfecho: 'concluida' | 'cancelada'): Promise<RespostaComando> {
    const transicao = comecarParada(estado);
    if (!transicao.ok) return recusa(transicao.motivo);
    await gravar(transicao.estado);
    limitador.imediato();
    await finalizar(desfecho, true);
    return aceita();
  }

  async function receberLote(lote: Lote): Promise<void> {
    if (estado.fase !== 'ativa' || !estado.sessao) return;
    aplicarLote(estado.sessao.dados, lote);
    await ambiente.gravarEstado(estado);
    limitador.solicitar();
  }

  async function validarPorta(porta: PortaDaPagina, caiu: () => boolean): Promise<void> {
    const sessao = estado.sessao;
    const daSessao = estado.fase === 'ativa' && sessao && porta.idAba === sessao.idAba && porta.idQuadro === 0;
    if (!daSessao || caiu()) {
      // Sem `configurar`, o script não instala nada (ou desliga o que tinha) e termina.
      try {
        porta.desconectar();
      } catch {
        // Já desconectada.
      }
      return;
    }
    portas.add(porta);
    porta.enviar({ tipo: 'configurar', selecao: sessao.selecao });
  }

  return {
    recuperar: () =>
      enfileirar(async () => {
        estado = (await ambiente.lerEstado()) ?? estadoInicial();
        if (estado.fase === 'ociosa') {
          // Nenhuma sessão: nada da extensão pode continuar registrado.
          await ambiente.removerScripts().catch(() => 0);
          return;
        }
        // O service worker foi suspenso com uma sessão em curso. Se a aba ainda
        // existe e a sessão estava ativa, ela continua: o script reconecta sozinho.
        const aba = estado.sessao ? await ambiente.urlDaAba(estado.sessao.idAba) : null;
        if (estado.fase === 'parando' || aba === null) await finalizar('interrompida', false);
      }),

    comando: (comando) =>
      enfileirar(async () => {
        switch (comando.tipo) {
          case 'obter-visao':
            return aceita();
          case 'iniciar':
            return iniciarSessao(comando.idAba, comando.selecao);
          case 'parar':
            return pararSessao('concluida');
          case 'cancelar':
            return pararSessao('cancelada');
        }
      }),

    portaConectada(porta) {
      let caiu = false;
      // Os ouvintes entram na hora, antes de qualquer espera, para não perder mensagens.
      porta.aoReceber((mensagem) => {
        if (!portas.has(porta)) return;
        if (mensagem.tipo === 'encerrado') {
          aguardandoEncerramento.get(porta)?.({ lote: mensagem.lote, desconectados: mensagem.desconectados });
        } else if (lotesTardios) {
          lotesTardios.push(mensagem.lote);
        } else {
          void enfileirar(() => receberLote(mensagem.lote));
        }
      });
      porta.aoDesconectar(() => {
        caiu = true;
        portas.delete(porta);
        aguardandoEncerramento.get(porta)?.(null);
      });
      void enfileirar(() => validarPorta(porta, () => caiu));
    },

    abaRemovida: (idAba) =>
      enfileirar(async () => {
        if (estado.fase === 'ociosa' || estado.sessao?.idAba !== idAba) return;
        await finalizar('interrompida', false);
      }),
  };
}
