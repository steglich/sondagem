/**
 * Orquestração da sessão no service worker: início, agregação dos lotes,
 * publicação de status, parada com limpeza e recuperação.
 *
 * Tudo o que depende de `chrome.*` chega por `AmbienteSessao`, para que a
 * lógica rode em testes unitários. As operações passam por uma fila, uma de
 * cada vez, porque quase todas leem e gravam o mesmo estado.
 *
 * Uma execução de cenário dura muito mais do que uma operação da fila, então o
 * runner (`scenarios.ts`) roda fora dela: ele altera o andamento da sessão em
 * memória e avisa a cada mudança, e só o encerramento volta para a fila. Quem
 * está na fila pode esperar o runner; o runner nunca espera a fila.
 */
import { type Marcacao, aplicarErroPagina, aplicarLote } from '../shared/agregacao.ts';
import { type Cenario, type Passo, type Throttling, mascararCenario, resolverIteracoes, validarCenario } from '../shared/cenario.ts';
import { type PerfilThrottling, SEM_CONDICOES, condicoesDe, resolverThrottling, semLimitacao } from '../shared/condicoes.ts';
import { LIMITE_PERFIL_MANUAL_MS } from '../shared/cpu.ts';
import { erroDaPagina } from '../shared/erros-pagina.ts';
import { ESTADOS_FINAIS } from '../shared/execucao-estado.ts';
import {
  BYTES_POR_MB,
  CONFIGURACAO_PADRAO,
  type ConfiguracaoArmazenamento,
  interromperRegistro,
  registroEmAndamento,
  registroFinal,
  resultadoDoRegistro,
} from '../shared/historico.ts';
import { type TiposConfirmados, confirmarLimpeza, descreverStorage } from '../shared/limpeza-storage.ts';
import { type Limitador, criarLimitador } from '../shared/limitador.ts';
import { comecarParada, concluir, estadoInicial, iniciar, visaoDe } from '../shared/sessao-estado.ts';
import { FALHAS_DE_ANEXACAO } from '../shared/mensagens-debugger.ts';
import { INTERVALO_MEDICAO_MANUAL_MS, METRICAS_MEMORIA } from '../shared/memoria.ts';
import {
  type ComandoInterface,
  type CondicoesDeTeste,
  type ConfiguracaoExecucao,
  type Desconectados,
  type Desfecho,
  type EstadoSessao,
  type ExtensaoAtiva,
  INTERVALO_LOTE_MS,
  type ItemLimpeza,
  type Lote,
  type MensagemDaPagina,
  type MensagemParaPagina,
  type MotivoDesconexao,
  type MotivoRecusa,
  type Navegador,
  type PedidoCenario,
  type RespostaComando,
  type SessaoEmAndamento,
  type VisaoSessao,
} from '../shared/types.ts';
import { avaliarUrl } from '../shared/url.ts';
import { normalizarSelecao, verificacoesComDebugger } from '../shared/verificacoes.ts';
import type { RepositorioResultados } from '../storage/repository.ts';
import { type ConexaoCdp, FalhaAnexacao } from './cdp.ts';
import { efeitosDasCondicoes } from './condicoes.ts';
import { type PerfilCpu, criarPerfilCpu } from './cpu.ts';
import { type PilhaDeEfeitos, criarPilhaDeEfeitos } from './efeitos.ts';
import { type ContextoMemoria, lerContadoresDom, medirMemoria, tirarSnapshot } from './memoria.ts';
import { MOTIVO_CANCELAMENTO, MOTIVO_CONEXAO_PERDIDA, type Relogio, executarCenario, relogioReal } from './scenarios.ts';

export const ID_SCRIPT_SESSAO = 'sondagem-sessao';

/** Quanto esperar pela resposta da página ao pedido de encerramento. */
export const ESPERA_ENCERRAMENTO_MS = 1500;

export interface AmbienteSessao {
  lerEstado(): Promise<EstadoSessao | undefined>;
  gravarEstado(estado: EstadoSessao): Promise<void>;
  /** URL da aba, ou `null` se a aba não existe mais. */
  urlDaAba(idAba: number): Promise<string | null | undefined>;
  /** Registra o content script dinâmico da sessão para os padrões de URL dados. */
  registrarScript(id: string, padroes: string[]): Promise<void>;
  /** Remove os content scripts dinâmicos (todos, se `ids` for omitido). Devolve quantos removeu. */
  removerScripts(ids?: string[]): Promise<number>;
  /** Injeta o código de medição na aba já aberta. */
  injetar(idAba: number): Promise<void>;
  /** Envia a visão atual à interface. */
  publicar(visao: VisaoSessao): void;
  agora(): number;
  /** Cria a conexão de CDP de uma análise. Só é chamada quando a análise exige o debugger. */
  criarCdp(): ConexaoCdp;
  /**
   * Desanexa o debugger de uma aba sem ter a conexão em memória (o service worker
   * foi reiniciado no meio de uma análise). Devolve `true` se havia o que desanexar.
   */
  soltarDepurador(idAba: number): Promise<boolean>;
  /** Relógio do runner. O padrão usa temporizadores reais. */
  relogio?: Relogio;
  /** Repete a ação a cada `ms` e devolve quem cancela. O padrão é `setInterval`. */
  repetir?: (acao: () => void, ms: number) => () => void;
  /** Duração máxima do perfil de CPU na sessão manual. O padrão é `LIMITE_PERFIL_MANUAL_MS`. */
  limitePerfilCpuMs?: number;
  /** Histórico de resultados. Sem ele, o resultado fica só na memória do service worker. */
  repositorio?: RepositorioResultados;
  /** Perfis de throttling salvos pelo usuário. */
  lerPerfis?: () => Promise<PerfilThrottling[]>;
  /** Limites e retenção do histórico. O padrão é `CONFIGURACAO_PADRAO`. */
  lerConfiguracao?: () => Promise<ConfiguracaoArmazenamento>;
  /** Outras extensões ativas no perfil do navegador. */
  outrasExtensoes?: () => Promise<ExtensaoAtiva[]>;
  navegador?: () => Navegador | null;
  /** Identificador de uma nova análise. O padrão é `crypto.randomUUID()`. */
  novoId?: () => string;
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
  'cenario-invalido': 'O cenário é inválido.',
  'perfil-inexistente': 'O perfil de throttling não existe.',
  'limpeza-nao-confirmada': 'A limpeza de storage não foi confirmada.',
  debugger: 'Não foi possível anexar o debugger à aba.',
  snapshot: 'Não foi possível tirar o snapshot.',
  erro: 'Não foi possível iniciar a análise.',
};

/** O que, além das verificações, depende do debugger em uma execução de cenário. */
export const DEPENDENTE_CENARIO = 'Execução do cenário';
/** Na sessão manual, o throttling escolhido na confirmação também depende do debugger. */
export const DEPENDENTE_THROTTLING = 'Throttling';

interface Plano {
  /** Cenário como o usuário escreveu, com os textos de login. Não é gravado em lugar nenhum. */
  definicao: Cenario;
  configuracao: ConfiguracaoExecucao;
  condicoes: CondicoesDeTeste;
  limparStorage: TiposConfirmados | null;
}

/** Runner em curso: quem cancela aciona o `controle` e espera a `corrida` terminar. */
interface Execucao {
  sessao: SessaoEmAndamento;
  controle: AbortController;
  corrida: Promise<unknown>;
}

/** URLs que o cenário abre: a inicial e as dos passos `navegar`, resolvidas contra a inicial. */
function urlsDoCenario(cenario: Cenario): string[] {
  const urls = [cenario.url_inicial];
  const percorrer = (passos: readonly Passo[]): void => {
    for (const passo of passos) {
      if (passo.tipo === 'repetir') percorrer(passo.passos);
      else if (passo.tipo === 'navegar') {
        try {
          urls.push(new URL(passo.url, cenario.url_inicial).href);
        } catch {
          // URL inválida: o passo falha na execução, com a mensagem própria.
        }
      }
    }
  };
  percorrer(cenario.aquecimento ?? []);
  percorrer(cenario.passos);
  return urls;
}

function marcacaoDe(sessao: SessaoEmAndamento): Marcacao | undefined {
  return sessao.cenario?.andamento;
}

export function criarOrquestrador(ambiente: AmbienteSessao): Orquestrador {
  let estado: EstadoSessao = estadoInicial();
  let fila: Promise<unknown> = Promise.resolve();
  /** Portas aceitas (já configuradas) da aba em análise. */
  const portas = new Set<PortaDaPagina>();
  /** Quem espera o `encerrado` de cada porta durante a parada. */
  const aguardandoEncerramento = new Map<PortaDaPagina, (resposta: Encerramento | null) => void>();
  /** Lotes que chegam enquanto a parada está em curso, fora da fila. */
  let lotesTardios: Lote[] | null = null;
  /** Conexão de CDP da sessão em curso, se ela usa o debugger. */
  let conexao: ConexaoCdp | null = null;
  let execucao: Execucao | null = null;
  /** Fim da última long task recebida da página, para o passo `aguardar_inatividade`. */
  let fimUltimaLongTask: number | null = null;
  /** Cancela as medições periódicas da sessão manual com "Memória". */
  let pararMedicoes: (() => void) | null = null;
  /** `true` enquanto um snapshot pedido pelo usuário está em curso: a medição periódica espera. */
  let tirandoSnapshot = false;
  /** Perfil de CPU da sessão manual; o do cenário pertence ao runner. */
  let perfilCpu: PerfilCpu | null = null;
  /** Cancela o temporizador do limite de duração do perfil de CPU. */
  let pararLimiteCpu: (() => void) | null = null;
  /** Throttling aplicado na sessão manual, a desfazer no encerramento. O do cenário pertence ao runner. */
  let condicoesManuais: PilhaDeEfeitos | null = null;
  /** Quantas condições o runner desfez na restauração da execução em curso. */
  let condicoesRestauradas = 0;
  const repositorio = ambiente.repositorio ?? null;
  const repetir =
    ambiente.repetir ??
    ((acao: () => void, ms: number) => {
      const id = setInterval(acao, ms);
      return () => clearInterval(id);
    });
  const relogio: Relogio = ambiente.relogio ?? { ...relogioReal, agora: () => ambiente.agora() };

  const limitador: Limitador = criarLimitador(INTERVALO_LOTE_MS, () => ambiente.publicar(visaoDe(estado)), ambiente.agora);

  function enfileirar<T>(operacao: () => Promise<T>): Promise<T> {
    const resultado = fila.then(operacao);
    fila = resultado.catch((erro: unknown) => console.error('Sondagem: falha na sessão', erro));
    return resultado;
  }

  /** O resultado não vai para `chrome.storage.session`: fica no repositório e é relido pelo `idResultado`. */
  function salvarEstado(): Promise<void> {
    return ambiente.gravarEstado(estado.resultado ? { ...estado, resultado: null } : estado);
  }

  async function gravar(novo: EstadoSessao): Promise<void> {
    estado = novo;
    await salvarEstado();
  }

  async function configuracaoDoHistorico(): Promise<ConfiguracaoArmazenamento> {
    return (await ambiente.lerConfiguracao?.().catch(() => undefined)) ?? CONFIGURACAO_PADRAO;
  }

  /** Grava no histórico a análise em curso, com o que já foi coletado. Uma falha aqui não para a análise. */
  async function salvarParcial(sessao: SessaoEmAndamento): Promise<void> {
    if (!repositorio) return;
    try {
      const { registro, dados } = registroEmAndamento(sessao);
      await repositorio.gravar(registro, dados);
    } catch (erro) {
      console.error('Sondagem: falha ao gravar a análise em andamento', erro);
    }
  }

  /**
   * Grava o resultado final no histórico, dentro dos limites, e aplica a retenção.
   * Devolve o estado com o resultado como ficou guardado (pode ter listas truncadas).
   */
  async function guardarResultado(novo: EstadoSessao, definicao: Cenario | null): Promise<EstadoSessao> {
    const resultado = novo.resultado;
    if (!repositorio || !resultado) return novo;
    try {
      const configuracao = await configuracaoDoHistorico();
      let final = registroFinal(resultado, definicao, configuracao.limiteExecucaoMb * BYTES_POR_MB);
      const outras = (await repositorio.listar()).filter((r) => r.id !== resultado.id).reduce((total, r) => total + r.tamanho, 0);
      // Histórico cheio: a execução entra só com as estatísticas, e o resultado diz o que ficou de fora.
      if (outras + final.registro.tamanho > configuracao.limiteHistoricoMb * BYTES_POR_MB) final = registroFinal(resultado, definicao, 0);
      await repositorio.gravar(final.registro, final.dados);
      await repositorio.aplicarRetencao(configuracao.retencao, ambiente.agora());
      return { ...novo, resultado: final.resultado };
    } catch (erro) {
      console.error('Sondagem: falha ao gravar o resultado no histórico', erro);
      return novo;
    }
  }

  /** Fecha como interrompidas as análises que ficaram "em andamento" no histórico sem sessão que as conduza. */
  async function fecharOrfas(): Promise<void> {
    if (!repositorio) return;
    try {
      const pendentes = (await repositorio.emAndamento()).filter((registro) => registro.id !== estado.sessao?.id);
      if (pendentes.length === 0) return;
      const limite = (await configuracaoDoHistorico()).limiteExecucaoMb * BYTES_POR_MB;
      for (const pendente of pendentes) {
        const guardada = await repositorio.ler(pendente.id);
        if (!guardada) continue;
        const fechada = interromperRegistro(guardada, ambiente.agora(), limite);
        await repositorio.gravar(fechada.registro, fechada.dados);
      }
    } catch (erro) {
      console.error('Sondagem: falha ao recuperar análises interrompidas', erro);
    }
  }

  function aceita(): RespostaComando {
    return { ok: true, visao: visaoDe(estado) };
  }

  function recusa(motivo: MotivoRecusa, mensagem = MENSAGENS[motivo]): RespostaComando {
    return { ok: false, motivo, mensagem, visao: visaoDe(estado) };
  }

  /** Grava o estado sem esperar e pede uma publicação. Para mudanças feitas fora da fila. */
  function persistir(): void {
    void enfileirar(() => salvarEstado());
    limitador.solicitar();
  }

  async function perfisSalvos(): Promise<PerfilThrottling[]> {
    return (await ambiente.lerPerfis?.().catch(() => undefined)) ?? [];
  }

  /**
   * Valida o cenário pedido e resolve a configuração e as condições efetivas. Cenário
   * inválido, perfil de throttling inexistente ou limpeza de storage sem confirmação
   * não executam nada.
   */
  async function planejar(pedido: PedidoCenario): Promise<Plano | { recusa: RespostaComando }> {
    const validacao = validarCenario(pedido.definicao);
    if (!validacao.ok) {
      const [primeiro] = validacao.erros;
      const outros = validacao.erros.length - 1;
      const resto = outros > 0 ? ` (e mais ${outros} erro${outros > 1 ? 's' : ''})` : '';
      return { recusa: recusa('cenario-invalido', `${MENSAGENS['cenario-invalido']} ${primeiro!.caminho || '/'}: ${primeiro!.mensagem}${resto}`) };
    }
    const definicao = validacao.cenario;
    const throttling = resolverThrottling(definicao.execucao?.throttling, await perfisSalvos());
    if (!throttling.ok) return { recusa: recusa('perfil-inexistente', throttling.mensagem) };
    const limpeza = confirmarLimpeza(definicao, pedido.storageConfirmado);
    if (!limpeza.ok) {
      return {
        recusa: recusa(
          'limpeza-nao-confirmada',
          `Este cenário apaga ${descreverStorage(limpeza.faltando)} da aplicação, e isso não foi confirmado. A execução não começou e nada foi apagado.`,
        ),
      };
    }
    return {
      definicao,
      configuracao: {
        nome: definicao.nome,
        urlInicial: definicao.url_inicial,
        iteracoes: resolverIteracoes(definicao, pedido.iteracoes),
        throttling: definicao.execucao?.throttling ?? null,
        versaoBuild: pedido.versaoBuild?.trim() || null,
      },
      condicoes: condicoesDe(throttling.perfil, {
        desligado: definicao.execucao?.manter_cache !== true,
        limpo: true,
        storageLimpo: limpeza.tipos,
      }),
      limparStorage: limpeza.tipos.length > 0 ? limpeza.tipos : null,
    };
  }

  /** Liga a coleta de erros da página: exceções e rejeições chegam por `Runtime.exceptionThrown`. */
  async function coletarErrosDaPagina(sessao: SessaoEmAndamento, cdp: ConexaoCdp): Promise<void> {
    cdp.aoEvento('Runtime.exceptionThrown', (parametros) => {
      if (estado.sessao !== sessao || estado.fase !== 'ativa') return;
      aplicarErroPagina(sessao.dados, erroDaPagina(parametros, ambiente.agora()), marcacaoDe(sessao));
      persistir();
    });
    await cdp.enviar('Runtime.enable');
  }

  function contextoMemoria(sessao: SessaoEmAndamento, cdp: ConexaoCdp): ContextoMemoria {
    return { cdp, dados: sessao.dados, agora: () => ambiente.agora() };
  }

  /**
   * Memória na sessão manual: uma medição leve agora e outra a cada 5 segundos, sem
   * coleta forçada. Roda fora da fila, como o runner; uma falha só perde a medição.
   */
  async function coletarMemoriaManual(sessao: SessaoEmAndamento, cdp: ConexaoCdp): Promise<void> {
    const medir = async (): Promise<void> => {
      if (estado.sessao !== sessao || estado.fase !== 'ativa' || tirandoSnapshot || !cdp.anexada) return;
      try {
        await medirMemoria(contextoMemoria(sessao, cdp), METRICAS_MEMORIA);
        if (estado.sessao === sessao) persistir();
      } catch {
        // A conexão caiu no meio: o encerramento já está a caminho.
      }
    };
    await medir();
    pararMedicoes = repetir(() => void medir(), INTERVALO_MEDICAO_MANUAL_MS);
  }

  /**
   * CPU na sessão manual: o perfil cobre a sessão até o limite de duração. No limite,
   * só o perfil para; as outras verificações continuam. Se o navegador recusar o
   * perfil, a sessão segue sem ele e o resultado avisa.
   */
  async function coletarCpuManual(sessao: SessaoEmAndamento, cdp: ConexaoCdp): Promise<void> {
    const perfil = criarPerfilCpu({ cdp, dados: sessao.dados, relogio });
    try {
      await perfil.iniciar();
    } catch (erro) {
      perfil.falhar(erro);
      return;
    }
    perfilCpu = perfil;
    const cancelar = repetir(() => {
      cancelar();
      if (pararLimiteCpu === cancelar) pararLimiteCpu = null;
      if (estado.sessao !== sessao || estado.fase !== 'ativa') return;
      void perfil.encerrar({ limiteAtingido: true }).then(() => {
        if (estado.sessao === sessao) persistir();
      });
    }, ambiente.limitePerfilCpuMs ?? LIMITE_PERFIL_MANUAL_MS);
    pararLimiteCpu = cancelar;
  }

  /** Censo de objetos a pedido, só na sessão manual com "Memória" marcada. */
  async function tirarSnapshotManual(): Promise<RespostaComando> {
    const sessao = estado.sessao;
    const cdp = conexao;
    if (estado.fase !== 'ativa' || !sessao) return recusa('sem-sessao');
    if (sessao.tipo !== 'sessao-manual' || !sessao.selecao.includes('memoria') || !cdp) {
      return recusa('snapshot', 'O snapshot a pedido só existe na sessão manual com a verificação "Memória" marcada.');
    }
    tirandoSnapshot = true;
    try {
      const censo = (): Promise<unknown> => tirarSnapshot(contextoMemoria(sessao, cdp), `manual-${sessao.dados.snapshots.length + 1}`);
      // A pausa do censo não é da página: fica fora do perfil de CPU.
      await (perfilCpu ? perfilCpu.excluir(censo) : censo());
    } catch (erro) {
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      return recusa('snapshot', `${MENSAGENS.snapshot} ${detalhe}`);
    } finally {
      tirandoSnapshot = false;
    }
    if (estado.sessao === sessao) await salvarEstado();
    limitador.imediato();
    return aceita();
  }

  /** A conexão caiu por fora: para o runner na hora e encerra a análise como interrompida. */
  function conexaoPerdida(sessao: SessaoEmAndamento, motivo: MotivoDesconexao): void {
    if (estado.sessao !== sessao) return;
    sessao.conexaoPerdida = motivo;
    execucao?.controle.abort(MOTIVO_CONEXAO_PERDIDA);
    void enfileirar(async () => {
      if (estado.sessao !== sessao) return;
      await execucao?.corrida;
      // Com a aba fechada não há página a quem pedir o encerramento.
      await finalizar('interrompida', motivo !== 'target_closed');
    });
  }

  function iniciarExecucao(sessao: SessaoEmAndamento, cdp: ConexaoCdp, plano: Plano): void {
    const { configuracao, andamento } = sessao.cenario!;
    const controle = new AbortController();
    condicoesRestauradas = 0;
    const corrida = executarCenario(
      {
        // A definicao do plano, e não a da sessão: a da sessão vem sem os textos de login.
        cenario: plano.definicao,
        iteracoes: configuracao.iteracoes,
        verificacoesAtivas: sessao.selecao,
        condicoes: plano.condicoes,
        limparStorage: plano.limparStorage,
      },
      {
        cdp,
        relogio,
        sinal: controle.signal,
        ultimaLongTask: () => fimUltimaLongTask,
        memoria: { dados: sessao.dados },
        aoMudar(_, marca) {
          if (estado.sessao !== sessao) return;
          if (marca) {
            for (const porta of portas) {
              try {
                porta.enviar({ tipo: 'marcar', marca });
              } catch {
                // A página está navegando: o próximo documento reconecta sozinho.
              }
            }
          }
          persistir();
          // Ao fim de cada iteração, o que foi agregado vai para o histórico.
          if (marca?.fase === 'fim' && marca.iteracao !== 'aquecimento') void enfileirar(() => salvarParcial(sessao));
        },
        aoRestaurar(desfeitas) {
          if (estado.sessao === sessao) condicoesRestauradas = desfeitas.length;
        },
      },
      andamento,
    );
    execucao = { sessao, controle, corrida };
    void corrida.then(() =>
      enfileirar(async () => {
        if (estado.sessao === sessao) await finalizar(desfechoDaExecucao(sessao), true);
      }),
    );
  }

  function desfechoDaExecucao(sessao: SessaoEmAndamento): Desfecho {
    if (sessao.conexaoPerdida) return 'interrompida';
    const final = sessao.cenario?.andamento.estado;
    return final === 'concluida' ? 'concluida' : final === 'cancelada' ? 'cancelada' : 'erro';
  }

  async function iniciarSessao(
    idAba: number,
    selecaoPedida: unknown,
    pedido?: PedidoCenario,
    throttlingManual?: Throttling,
  ): Promise<RespostaComando> {
    if (estado.fase !== 'ociosa') return recusa('sessao-ativa');
    const selecao = normalizarSelecao(selecaoPedida);
    if (selecao.length === 0) return recusa('sem-verificacao');

    let plano: Plano | undefined;
    // Sessão manual: nada muda na aba, a não ser que o usuário tenha escolhido um throttling na confirmação.
    let condicoes: CondicoesDeTeste = SEM_CONDICOES;
    if (pedido) {
      const planejado = await planejar(pedido);
      if ('recusa' in planejado) return planejado.recusa;
      plano = planejado;
      condicoes = plano.condicoes;
    } else if (throttlingManual !== undefined) {
      const throttling = resolverThrottling(throttlingManual, await perfisSalvos());
      if (!throttling.ok) return recusa('perfil-inexistente', throttling.mensagem);
      condicoes = condicoesDe(throttling.perfil, { desligado: false, limpo: false });
    }
    const comThrottlingManual = !plano && !semLimitacao(condicoes);

    const url = await ambiente.urlDaAba(idAba);
    const avaliacao = avaliarUrl(url);
    if (!url || !avaliacao.suportada) {
      return recusa('url-nao-suportada', avaliacao.suportada ? MENSAGENS['url-nao-suportada'] : avaliacao.motivo);
    }
    // O script de medição acompanha a aba por todas as páginas que o cenário abre.
    const padroes = new Set([avaliacao.padrao]);
    if (plano) {
      for (const [indice, destino] of urlsDoCenario(plano.definicao).entries()) {
        const avaliada = avaliarUrl(destino);
        if (avaliada.suportada) padroes.add(avaliada.padrao);
        else if (indice === 0) return recusa('url-nao-suportada', `URL inicial do cenário: ${avaliada.motivo}`);
      }
    }

    // O debugger só é anexado aqui, depois da confirmação, e só se a análise exigir.
    const dependentes = [
      ...(plano ? [DEPENDENTE_CENARIO] : []),
      ...(comThrottlingManual ? [DEPENDENTE_THROTTLING] : []),
      ...verificacoesComDebugger(selecao).map((v) => v.nome),
    ];
    let cdp: ConexaoCdp | null = null;
    if (dependentes.length > 0) {
      cdp = ambiente.criarCdp();
      try {
        await cdp.anexar(idAba);
      } catch (erro) {
        if (!(erro instanceof FalhaAnexacao)) {
          const detalhe = erro instanceof Error ? erro.message : String(erro);
          return recusa('erro', `${MENSAGENS.erro} ${detalhe}`);
        }
        // Nada foi instalado, e a extensão não age sobre o outro depurador.
        const { titulo, orientacao } = FALHAS_DE_ANEXACAO[erro.categoria];
        return {
          ...recusa('debugger', `${titulo} ${orientacao}`),
          falhaDebugger: { categoria: erro.categoria, original: erro.original, dependentes },
        } as RespostaComando;
      }
    }

    const anterior = estado;
    const id = ambiente.novoId?.() ?? crypto.randomUUID();
    try {
      // Sobra de uma sessão que não terminou direito não pode impedir o registro.
      await ambiente.removerScripts([ID_SCRIPT_SESSAO]);
      await ambiente.registrarScript(ID_SCRIPT_SESSAO, [...padroes]);
      const transicao = iniciar(estado, {
        idAba,
        url: plano ? plano.configuracao.urlInicial : url,
        selecao,
        inicio: ambiente.agora(),
        idsScripts: [ID_SCRIPT_SESSAO],
        usaDebugger: cdp !== null,
        // No estado e no histórico o cenário vai sem os textos digitados no login.
        cenario: plano ? { definicao: mascararCenario(plano.definicao), configuracao: plano.configuracao } : undefined,
        id,
        condicoes,
        extensoes: (await ambiente.outrasExtensoes?.().catch(() => undefined)) ?? [],
        navegador: ambiente.navegador?.() ?? null,
      });
      if (!transicao.ok) {
        await cdp?.desanexar();
        await ambiente.removerScripts([ID_SCRIPT_SESSAO]).catch(() => 0);
        return recusa(transicao.motivo);
      }
      // O estado é gravado antes da injeção: o script conecta assim que roda,
      // e a porta só é aceita com a sessão ativa.
      await gravar(transicao.estado);
      const sessao = transicao.estado.sessao!;
      // A análise entra no histórico já ao começar, como "em andamento".
      await salvarParcial(sessao);
      conexao = cdp;
      fimUltimaLongTask = null;
      if (cdp) {
        cdp.aoPerder((motivo) => conexaoPerdida(sessao, motivo));
        if (selecao.includes('erros-pagina')) await coletarErrosDaPagina(sessao, cdp);
      }
      // Em cenário não há injeção direta: a carga da URL inicial traz o script registrado.
      if (plano && cdp) iniciarExecucao(sessao, cdp, plano);
      else {
        if (cdp && comThrottlingManual) {
          condicoesManuais = criarPilhaDeEfeitos();
          if (condicoes.rede) await cdp.enviar('Network.enable');
          for (const efeito of efeitosDasCondicoes(condicoes, cdp)) await condicoesManuais.aplicar(efeito);
        }
        await ambiente.injetar(idAba);
        if (cdp && selecao.includes('dom-listeners')) await lerContadoresDom(contextoMemoria(sessao, cdp), 'inicio');
        if (cdp && selecao.includes('memoria')) await coletarMemoriaManual(sessao, cdp);
        // Por último, para que o perfil não inclua as leituras de início.
        if (cdp && selecao.includes('cpu')) await coletarCpuManual(sessao, cdp);
      }
    } catch (erro) {
      pararMedicoes?.();
      pararMedicoes = null;
      pararLimiteCpu?.();
      pararLimiteCpu = null;
      await perfilCpu?.abandonar();
      perfilCpu = null;
      await condicoesManuais?.desfazerTudo();
      condicoesManuais = null;
      await cdp?.desanexar();
      conexao = null;
      await ambiente.removerScripts([ID_SCRIPT_SESSAO]).catch(() => 0);
      await repositorio?.remover(id).catch(() => undefined);
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
    const marcacao = marcacaoDe(sessao);
    for (const lote of lotesTardios) aplicarLote(sessao.dados, lote, marcacao);
    lotesTardios = null;
    for (const resposta of encerramento.respostas) aplicarLote(sessao.dados, resposta.lote, marcacao);

    // O debugger sai antes de a interface receber o desfecho. O runner já desanexa
    // ao terminar; aqui cobre a sessão manual e o que tiver sobrado (é idempotente).
    const depurador = sessao.usaDebugger && !sessao.conexaoPerdida ? 1 : 0;
    const medicoesPeriodicas = pararMedicoes ? 1 : 0;
    pararMedicoes?.();
    pararMedicoes = null;
    const limiteCpu = pararLimiteCpu ? 1 : 0;
    pararLimiteCpu?.();
    pararLimiteCpu = null;
    // Sessão manual: o perfil de CPU é lido antes das leituras finais e antes de o debugger sair.
    if (perfilCpu) {
      if (conexao?.anexada && desfecho !== 'cancelada') await perfilCpu.encerrar();
      await perfilCpu.abandonar();
      perfilCpu = null;
    }
    // Sessão manual: os contadores de fim são lidos enquanto o debugger ainda está anexado.
    if (conexao?.anexada && sessao.tipo === 'sessao-manual' && sessao.selecao.includes('dom-listeners')) {
      await lerContadoresDom(contextoMemoria(sessao, conexao), 'fim').catch(() => undefined);
    }
    // Sessão manual: o throttling escolhido sai antes do debugger. Em cenário, o runner já restaurou.
    const condicoesDesfeitas = condicoesRestauradas + ((await condicoesManuais?.desfazerTudo())?.length ?? 0);
    condicoesManuais = null;
    condicoesRestauradas = 0;
    await conexao?.desanexar();
    conexao = null;
    execucao = null;
    fimUltimaLongTask = null;

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
          quantidade: somar('temporizadores') + encerramento.temporizadores + publicacaoPendente + medicoesPeriodicas + limiteCpu,
        },
        { recurso: 'depurador', quantidade: depurador },
        { recurso: 'condicao-de-teste', quantidade: condicoesDesfeitas },
      ] satisfies ItemLimpeza[]
    ).filter((item) => item.quantidade > 0);

    const transicao = concluir(estado, {
      desfecho,
      fim: ambiente.agora(),
      limpeza,
      paginaRespondeu: encerramento.respostas.length > 0,
    });
    if (transicao.ok) await gravar(await guardarResultado(transicao.estado, sessao.cenario?.definicao ?? null));
    limitador.imediato();
  }

  async function pararSessao(desfecho: 'concluida' | 'cancelada'): Promise<RespostaComando> {
    const transicao = comecarParada(estado);
    if (!transicao.ok) return recusa(transicao.motivo);
    const sessao = transicao.estado.sessao!;
    const emExecucao = execucao?.sessao === sessao ? execucao : null;
    // Antes de qualquer espera: nenhum passo começa depois do cancelamento.
    emExecucao?.controle.abort(MOTIVO_CANCELAMENTO);
    await gravar(transicao.estado);
    limitador.imediato();
    if (emExecucao) {
      // Um cenário interrompido pelo usuário é sempre um cancelamento; se o runner
      // já tinha terminado quando o comando chegou, vale o desfecho dele.
      await emExecucao.corrida;
      await finalizar(desfechoDaExecucao(sessao), true);
    } else {
      await finalizar(sessao.conexaoPerdida ? 'interrompida' : desfecho, true);
    }
    return aceita();
  }

  function notarLongTasks(lote: Lote): void {
    for (const tarefa of lote.longTasks) fimUltimaLongTask = Math.max(fimUltimaLongTask ?? 0, tarefa.inicio + tarefa.duracao);
  }

  async function receberLote(lote: Lote): Promise<void> {
    if (estado.fase !== 'ativa' || !estado.sessao) return;
    aplicarLote(estado.sessao.dados, lote, marcacaoDe(estado.sessao));
    await salvarEstado();
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

  /** Desfaz o que uma sessão anterior tenha deixado, conforme o estado gravado. */
  async function recuperarSessao(): Promise<void> {
    if (estado.fase === 'ociosa') {
      // Nenhuma sessão: nada da extensão pode continuar registrado.
      await ambiente.removerScripts().catch(() => 0);
      return;
    }
    // O service worker foi suspenso com uma sessão em curso. Se a aba ainda
    // existe e a sessão estava ativa, ela continua: o script reconecta sozinho.
    const aba = estado.sessao ? await ambiente.urlDaAba(estado.sessao.idAba) : null;
    // Com o debugger é diferente: o runner e os ouvintes de CDP viviam na memória
    // que se perdeu. A análise acaba como interrompida, e o debugger é solto.
    const sessao = estado.sessao;
    if (sessao?.usaDebugger) {
      const solto = await ambiente.soltarDepurador(sessao.idAba).catch(() => false);
      if (!solto) sessao.usaDebugger = false;
      if (sessao.cenario && !ESTADOS_FINAIS.includes(sessao.cenario.andamento.estado)) {
        sessao.cenario.andamento.estado = 'erro';
        sessao.cenario.andamento.falhas.push({
          caminho: '',
          tipoPasso: '',
          iteracao: sessao.cenario.andamento.iteracoes.find((i) => i.fim === null)?.numero ?? null,
          motivo: 'A extensão foi suspensa durante a execução.',
          acao: 'interrompeu',
        });
      }
      await finalizar('interrompida', false);
      return;
    }
    if (estado.fase === 'parando' || aba === null) await finalizar('interrompida', false);
  }

  return {
    recuperar: () =>
      enfileirar(async () => {
        estado = (await ambiente.lerEstado()) ?? estadoInicial();
        // O último resultado mora no repositório; o estado gravado só guarda o id.
        if (estado.idResultado && repositorio) {
          const guardada = await repositorio.ler(estado.idResultado).catch(() => null);
          estado = { ...estado, resultado: guardada ? resultadoDoRegistro(guardada) : null };
        }
        await recuperarSessao();
        // Por último, o que ficou "em andamento" no histórico sem estado de sessão (o navegador fechou).
        await fecharOrfas();
      }),

    comando: (comando) =>
      enfileirar(async () => {
        switch (comando.tipo) {
          case 'obter-visao':
            return aceita();
          case 'iniciar':
            return iniciarSessao(comando.idAba, comando.selecao, comando.cenario, comando.throttling);
          case 'parar':
            return pararSessao('concluida');
          case 'cancelar':
            return pararSessao('cancelada');
          case 'tirar-snapshot':
            return tirarSnapshotManual();
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
          // Fora da fila, para que `aguardar_inatividade` veja a long task sem atraso.
          notarLongTasks(mensagem.lote);
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
        if (execucao) {
          execucao.controle.abort(MOTIVO_CONEXAO_PERDIDA);
          await execucao.corrida;
        }
        await finalizar('interrompida', false);
      }),
  };
}
