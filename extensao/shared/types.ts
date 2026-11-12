/**
 * Tipos compartilhados entre a página testada, o service worker e a interface.
 *
 * Fluxo das mensagens:
 *   página  ──(porta NOME_PORTA_PAGINA: MensagemDaPagina)──▶ service worker
 *   página  ◀─(porta NOME_PORTA_PAGINA: MensagemParaPagina)── service worker
 *   interface ──(runtime.sendMessage: ComandoInterface → RespostaComando)──▶ service worker
 *   interface ◀─(runtime.sendMessage: EventoParaInterface)── service worker
 */
import type { Cenario, Throttling } from './cenario.ts';
import type { Resumo } from './stats.ts';

// ---------------------------------------------------------------------------
// Verificações
// ---------------------------------------------------------------------------

export type IdVerificacao = 'processamento' | 'carregamento' | 'erros-pagina' | 'memoria' | 'dom-listeners' | 'cpu';

/** O que uma verificação precisa para rodar: só código na página, ou o debugger anexado à aba. */
export type Exigencia = 'pagina' | 'debugger';

/** Unidades de coleta instaladas na página. Cada verificação liga uma ou mais. */
export type Coletor = 'long-tasks' | 'interacoes' | 'inp' | 'metricas-carregamento';

export interface Verificacao {
  id: IdVerificacao;
  nome: string;
  descricao: string;
  exige: Exigencia;
  coleta: readonly Coletor[];
}

/** Verificações marcadas para uma análise, na ordem do registro. */
export type Selecao = IdVerificacao[];

/** Contexto ao qual uma seleção salva pertence: a sessão manual ou um cenário (ver `contextoDoCenario`). */
export type ContextoSelecao = string;
export const CONTEXTO_MANUAL: ContextoSelecao = 'manual';

/** Contexto da seleção de um cenário. O prefixo evita colisão com um cenário chamado "manual". */
export function contextoDoCenario(nome: string): ContextoSelecao {
  return `cenario:${nome}`;
}

// ---------------------------------------------------------------------------
// Medições
// ---------------------------------------------------------------------------

/**
 * Iteração do cenário em que um registro ocorreu. `null`: fora de qualquer iteração
 * (antes, depois ou entre elas). Ausente: sessão manual, que não tem iterações.
 */
export type IteracaoDoRegistro = number | null;

export interface LongTask {
  /** Instante de início, em ms desde a época (timeOrigin + startTime). */
  inicio: number;
  duracao: number;
  iteracao?: IteracaoDoRegistro;
  /** `true` se coincidiu com um censo de objetos: a pausa é da medição, não da página. Fica fora das estatísticas. */
  causadaPelaMedicao?: boolean;
}

export interface Interacao {
  /** `interactionId` do Event Timing; junto com `documento`, identifica a interação. */
  id: number;
  /** Documento em que a interação aconteceu (ver `DocumentoObservado.id`). */
  documento: string;
  /** Instante de início, em ms desde a época. */
  inicio: number;
  /** Do início da interação até a próxima pintura. */
  duracao: number;
  /** Tipo do evento mais demorado da interação (ex.: `click`, `keydown`). */
  tipo: string;
  /** Descrição curta do elemento alvo (ex.: `button[data-testid="acao-pesada"]`). */
  alvo: string;
  iteracao?: IteracaoDoRegistro;
}

/** Exceção não tratada ou promise rejeitada sem tratamento, vinda de `Runtime.exceptionThrown`. */
export interface ErroPagina {
  tipo: 'excecao' | 'rejeicao';
  mensagem: string;
  /** Origem do erro; `null` quando o navegador não informa. */
  arquivo: string | null;
  linha: number | null;
  coluna: number | null;
  /** ms desde a época. */
  instante: number;
  iteracao?: IteracaoDoRegistro;
}

/** Alvo de uma interação cujo elemento o navegador não informou (removido da página, por exemplo). */
export const ALVO_DESCONHECIDO = '(elemento removido)';

export type NomeMetrica = 'LCP' | 'CLS' | 'FCP' | 'TTFB' | 'INP';

/** Valores que o navegador produziu até o momento; métrica ausente = ainda não produzida. */
export type MetricasParciais = Partial<Record<NomeMetrica, number>>;

/** Métricas de um carregamento. `null` significa indisponível (o navegador não produziu), nunca zero. */
export interface MetricasCarregamento {
  lcp: number | null;
  cls: number | null;
  fcp: number | null;
  ttfb: number | null;
}

/** Cada documento carregado na aba durante a sessão (recargas e navegações criam um novo). */
export interface DocumentoObservado {
  id: string;
  url: string;
  /** `performance.timeOrigin` do documento, em ms desde a época. */
  inicio: number;
  metricas: MetricasParciais;
}

export interface DadosColetados {
  longTasks: LongTask[];
  interacoes: Interacao[];
  documentos: DocumentoObservado[];
  /** Só é preenchido com a verificação "Erros da página" marcada. */
  errosPagina: ErroPagina[];
  /** Medições leves de memória: uma por passo `medir`, ou uma a cada 5 s na sessão manual. */
  medicoes: MedicaoMemoria[];
  /** Censos de objetos por construtor (passo `snapshot`), na ordem em que foram feitos. */
  snapshots: ResumoSnapshot[];
  /** Intervalos em que a página ficou parada por um censo. */
  pausasDeMedicao: Intervalo[];
  /** Contadores lidos no início e no fim da análise, com "DOM e listeners" marcada. */
  contadoresDom: { inicio: ContadoresDom | null; fim: ContadoresDom | null };
  /** Perfil de CPU; `null` sem a verificação "CPU" marcada. */
  cpu: ColetaCpu | null;
}

// ---------------------------------------------------------------------------
// CPU
// ---------------------------------------------------------------------------

/** Uma função do perfil de CPU. Tempos em ms. */
export interface FuncaoCpu {
  /** Nome no código servido; `(anônima)` para função sem nome. */
  nome: string;
  /** URL do arquivo; `null` quando o navegador não informa (código avaliado, função nativa). */
  arquivo: string | null;
  /** Linha e coluna em base 1; `null` quando o navegador não informa. */
  linha: number | null;
  coluna: number | null;
  /** Tempo das amostras em que a função estava no topo da pilha. */
  tempoProprio: number;
  /** Tempo das amostras em que a função estava em qualquer ponto da pilha. */
  tempoTotal: number;
  /** Tempo próprio sobre o tempo amostrado sem o ocioso, de 0 a 100. */
  percentual: number;
}

/** Tempo, em ms, do que não é função da página. Fica fora da lista de funções. */
export interface CategoriasCpu {
  ocioso: number;
  coletaDeLixo: number;
  /** Tempo interno do motor: `(program)` e `(root)`. */
  programa: number;
  /** Funções de extensões do navegador (`chrome-extension://`), inclusive desta. */
  extensoes: number;
}

/** O que sobra do perfil de CPU: o bruto é descartado na agregação. */
export interface ResumoCpu {
  /** Tempo coberto pelas amostras consideradas, em ms. */
  tempoAmostrado: number;
  /** `tempoAmostrado` menos o ocioso: a base dos percentuais. */
  tempoAtivo: number;
  amostras: number;
  categorias: CategoriasCpu;
  /** Por tempo próprio decrescente, até o limite do resumo. */
  funcoes: FuncaoCpu[];
  /** Soma das funções que ficaram fora da lista; `null` se todas couberam. */
  outras: { quantidade: number; tempoProprio: number; percentual: number } | null;
}

export interface ColetaCpu {
  estado: 'coletando' | 'concluida' | 'falhou';
  /** `true` se o perfil chegou a ser ligado: as outras métricas foram medidas com esse custo. */
  ativo: boolean;
  resumo: ResumoCpu | null;
  /** Por que não há resumo, quando `estado` é `falhou`. */
  falha: string | null;
  /** O navegador perdeu parte dos dados do perfil (ou a entrega não terminou a tempo). */
  incompleto: boolean;
  /** Sessão manual: o perfil parou ao atingir a duração máxima. */
  limiteAtingido: boolean;
}

// ---------------------------------------------------------------------------
// Memória
// ---------------------------------------------------------------------------

export type MetricaMemoria = 'heap_usado' | 'nos_dom' | 'listeners';

/** Medição leve, sem percorrer o heap. Métrica não pedida fica `null`. */
export interface MedicaoMemoria {
  /** ms desde a época. */
  instante: number;
  /** Bytes em uso no heap de JavaScript da página. */
  heapUsado: number | null;
  nosDom: number | null;
  listeners: number | null;
  iteracao?: IteracaoDoRegistro;
}

export interface ContadoresDom {
  nosDom: number;
  listeners: number;
  /** Nós DOM fora do documento que continuam na memória; `null` se o navegador não informou. */
  nosDesanexados: number | null;
}

export interface ResumoConstrutor {
  nome: string;
  /** Quantidade de objetos vivos. */
  contagem: number;
}

/** O que o censo devolve da página: só a tabela de contagens, nada do heap. */
export interface DadosCenso {
  totalObjetos: number;
  /** Os construtores com mais objetos, em ordem decrescente. */
  construtores: ResumoConstrutor[];
  /** Soma dos construtores que ficaram fora da lista; `null` se todos couberam. */
  outros: ResumoConstrutor | null;
}

/** Resumo produzido por um passo `snapshot`: o censo de objetos por construtor naquele instante. */
export interface ResumoSnapshot extends DadosCenso {
  rotulo: string;
  /** ms desde a época. */
  instante: number;
  iteracao?: IteracaoDoRegistro;
}

/** Valor antes e depois, com a diferença. */
export interface Variacao {
  antes: number;
  depois: number;
  variacao: number;
}

export interface VariacaoConstrutor {
  nome: string;
  /** `novo`: só no último censo; `removido`: só no primeiro. */
  situacao: 'ambos' | 'novo' | 'removido';
  contagem: Variacao;
}

/** Diferença entre o primeiro e o último censo da análise. */
export interface ComparacaoSnapshots {
  de: string;
  para: string;
  /** Do que mais ganhou objetos para o que mais perdeu. */
  construtores: VariacaoConstrutor[];
}

export type ClassificacaoVazamento = 'vazamento-provavel' | 'sem-indicio' | 'dados-insuficientes';

export interface PontoDaSerie {
  iteracao: number;
  valor: number;
}

/** Uma métrica medida depois de cada iteração completa. */
export interface SerieMemoria {
  metrica: MetricaMemoria;
  pontos: PontoDaSerie[];
  /** (último − primeiro) ÷ transições; `null` com menos de dois pontos. */
  crescimentoMedio: number | null;
  /** Transições entre iterações consecutivas em que o valor subiu. */
  transicoesCrescentes: number;
  classificacao: ClassificacaoVazamento;
}

export interface VariacaoDomListeners {
  /** Do início para o fim da análise; `null` se os contadores não foram lidos. */
  nosDesanexados: Variacao | null;
  listeners: Variacao | null;
}

/** Parte do resultado que só existe com "Memória" ou "DOM e listeners" marcadas. */
export interface AnaliseMemoria {
  /** Dada pela série de heap usado. `null` na sessão manual, que não tem iterações comparáveis. */
  classificacao: ClassificacaoVazamento | null;
  series: SerieMemoria[];
  comparacao: ComparacaoSnapshots | null;
  /** Só com "DOM e listeners" marcada. */
  domListeners: VariacaoDomListeners | null;
}

/** O que a interface mostra enquanto a análise roda. Os registros detalhados só vão ao término. */
export interface StatusResumido {
  longTasks: number;
  interacoes: number;
  /** Maior duração de long task até agora, ou `null` se não houve nenhuma. */
  piorLongTask: number | null;
  carregamentos: number;
  errosPagina: number;
  /** Heap usado na medição mais recente, ou `null` se ainda não houve nenhuma. */
  heapUsado: number | null;
  snapshots: number;
  /** Situação do perfil de CPU; `null` sem a verificação "CPU". */
  cpu: 'coletando' | 'concluida' | 'limite-atingido' | 'falhou' | null;
}

// ---------------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------------

export type FaseSessao = 'ociosa' | 'ativa' | 'parando';

export type TipoAnalise = 'sessao-manual' | 'cenario';

/** `erro`: um passo do cenário falhou e interrompeu a execução. */
export type Desfecho = 'concluida' | 'cancelada' | 'interrompida' | 'erro';

export type TipoRecurso = 'script-registrado' | 'observador' | 'listener' | 'porta' | 'temporizador' | 'depurador';

/** Uma linha da "lista do que foi removido" exibida depois da limpeza. */
export interface ItemLimpeza {
  recurso: TipoRecurso;
  quantidade: number;
}

// ---------------------------------------------------------------------------
// Debugger
// ---------------------------------------------------------------------------

/** Por que não foi possível anexar o debugger à aba. */
export type CategoriaFalhaAnexacao = 'outro-depurador' | 'alvo-nao-depuravel' | 'desconhecido';

export interface FalhaDebugger {
  categoria: CategoriaFalhaAnexacao;
  /** Mensagem original do Chrome, preservada para diagnóstico. */
  original: string;
  /** Nomes do que, na análise pedida, depende do debugger. */
  dependentes: string[];
}

/**
 * Motivo de `chrome.debugger.onDetach`: `canceled_by_user` (barra de depuração),
 * `target_closed` (aba fechada), `replaced_with_devtools`, ou outro texto do Chrome.
 */
export type MotivoDesconexao = string;

// ---------------------------------------------------------------------------
// Execução de cenário
// ---------------------------------------------------------------------------

export type EstadoExecucao =
  | 'ociosa'
  | 'preparando'
  | 'aquecendo'
  | 'executando'
  | 'coletando'
  | 'concluida'
  | 'erro'
  | 'cancelada';

/** Intervalo de tempo, em ms desde a época. `fim` nulo: ainda aberto. */
export interface Intervalo {
  inicio: number;
  fim: number | null;
}

export interface RegistroIteracao extends Intervalo {
  numero: number;
  /** `false` se um passo foi pulado ou a iteração não chegou ao fim: fica fora das estatísticas. */
  completa: boolean;
  passosExecutados: number;
}

export interface ErroDePasso {
  /** JSON Pointer do passo no cenário (ex.: `/passos/3/passos/0`). */
  caminho: string;
  tipoPasso: string;
  /** Iteração em que ocorreu, ou `null` fora das iterações. */
  iteracao: number | null;
  motivo: string;
  /** O que a política `em_erro` fez com a falha. */
  acao: 'interrompeu' | 'pulou';
}

export interface Ambiente {
  versaoNavegador: string;
  userAgent: string;
  janela: { largura: number; altura: number };
  dpr: number;
}

/** Configuração efetiva de uma execução: o que realmente valeu, depois das sobrescritas. */
export interface ConfiguracaoExecucao {
  nome: string;
  urlInicial: string;
  iteracoes: number;
  throttling: Throttling | null;
  /** Informada pelo usuário na confirmação; `null` se não informou. */
  versaoBuild: string | null;
}

/** Andamento da execução, atualizado pelo runner a cada transição. */
export interface AndamentoExecucao {
  estado: EstadoExecucao;
  /** Iteração em curso (ou a última iniciada); 0 antes da primeira. */
  iteracao: number;
  totalIteracoes: number;
  aquecimento: Intervalo | null;
  iteracoes: RegistroIteracao[];
  passosExecutados: number;
  /** Passos que falharam, na ordem. O que interrompeu a execução, se houve, é o último. */
  falhas: ErroDePasso[];
  ambiente: Ambiente | null;
}

export type IdMetricaIteracao = 'duracao-iteracao' | 'tempo-long-tasks' | 'pior-interacao';

export interface EstatisticaMetrica extends Resumo {
  id: IdMetricaIteracao;
}

/** Parte do resultado que só existe em execuções de cenário. */
export interface ResultadoCenario {
  configuracao: ConfiguracaoExecucao;
  estadoFinal: EstadoExecucao;
  ambiente: Ambiente | null;
  iteracoes: RegistroIteracao[];
  iteracoesCompletas: number;
  iteracoesIncompletas: number;
  passosExecutados: number;
  falhas: ErroDePasso[];
  /** Mediana, p75 e p95 entre as iterações completas. */
  estatisticas: EstatisticaMetrica[];
}

/** O que a interface envia para executar um cenário. O service worker valida de novo. */
export interface PedidoCenario {
  definicao: unknown;
  /** Iterações informadas na confirmação; tem prioridade sobre o cenário. */
  iteracoes?: number | null;
  versaoBuild?: string | null;
}

export interface SessaoEmAndamento {
  tipo: TipoAnalise;
  idAba: number;
  url: string;
  selecao: Selecao;
  /** ms desde a época. */
  inicio: number;
  /** IDs dos content scripts registrados dinamicamente para esta sessão. */
  idsScripts: string[];
  dados: DadosColetados;
  /** `true` enquanto o debugger está anexado à aba por esta sessão. */
  usaDebugger: boolean;
  /** Preenchido quando o debugger foi desanexado por ação externa. */
  conexaoPerdida: MotivoDesconexao | null;
  /** Só em execuções de cenário. */
  cenario: { definicao: Cenario; configuracao: ConfiguracaoExecucao; andamento: AndamentoExecucao } | null;
}

export interface ResultadoSessao {
  tipo: TipoAnalise;
  desfecho: Desfecho;
  url: string;
  selecao: Selecao;
  inicio: number;
  fim: number;
  dados: DadosColetados;
  limpeza: ItemLimpeza[];
  /** `false` quando a página não respondeu ao encerramento (aba fechada, por exemplo). */
  paginaRespondeu: boolean;
  /** Motivo da desconexão do debugger, quando foi ela que interrompeu a análise. */
  conexaoPerdida: MotivoDesconexao | null;
  cenario: ResultadoCenario | null;
  memoria: AnaliseMemoria | null;
}

/** Estado gravado pelo service worker em `chrome.storage.session`. */
export interface EstadoSessao {
  fase: FaseSessao;
  sessao: SessaoEmAndamento | null;
  /** Resultado da última análise terminada. Fica só aqui até a fase 5 (histórico). */
  resultado: ResultadoSessao | null;
}

/** Recorte do estado enviado à interface. */
export interface VisaoSessao {
  fase: FaseSessao;
  alvo: { idAba: number; url: string } | null;
  selecao: Selecao;
  inicio: number | null;
  status: StatusResumido | null;
  /** Estado e progresso da execução de cenário; `null` em sessão manual ou sem análise. */
  execucao: { nome: string; estado: EstadoExecucao; iteracao: number; totalIteracoes: number } | null;
  resultado: ResultadoSessao | null;
}

// ---------------------------------------------------------------------------
// Mensagens página ↔ service worker (porta)
// ---------------------------------------------------------------------------

export const NOME_PORTA_PAGINA = 'sondagem-pagina';

/** Intervalo entre lotes da página e entre publicações de status. */
export const INTERVALO_LOTE_MS = 1000;

export interface Lote {
  documento: { id: string; url: string; inicio: number };
  longTasks: LongTask[];
  interacoes: Interacao[];
  /** Só as métricas que mudaram desde o lote anterior. */
  metricas: MetricasParciais;
}

/** Contagem do que o código injetado desligou ao encerrar. */
export interface Desconectados {
  observadores: number;
  listeners: number;
  temporizadores: number;
}

export type MensagemParaPagina =
  | { tipo: 'configurar'; selecao: Selecao }
  /** Início ou fim de iteração (ou do aquecimento): a página envia na hora o que acumulou. */
  | { tipo: 'marcar'; marca: Marca }
  | { tipo: 'encerrar' };

export interface Marca {
  fase: 'inicio' | 'fim';
  /** Número da iteração, ou `'aquecimento'`. */
  iteracao: number | 'aquecimento';
}

export type MensagemDaPagina =
  | { tipo: 'lote'; lote: Lote }
  | { tipo: 'encerrado'; lote: Lote; desconectados: Desconectados };

// ---------------------------------------------------------------------------
// Mensagens interface ↔ service worker
// ---------------------------------------------------------------------------

export type ComandoInterface =
  | { tipo: 'obter-visao' }
  | { tipo: 'iniciar'; idAba: number; selecao: Selecao; cenario?: PedidoCenario }
  | { tipo: 'parar' }
  | { tipo: 'cancelar' }
  /** Sessão manual com "Memória": faz um censo de objetos agora. */
  | { tipo: 'tirar-snapshot' };

export type MotivoRecusa =
  | 'sessao-ativa'
  | 'sem-sessao'
  | 'sem-verificacao'
  | 'url-nao-suportada'
  | 'cenario-invalido'
  | 'debugger'
  | 'snapshot'
  | 'erro';

export type RespostaComando =
  | { ok: true; visao: VisaoSessao }
  | { ok: false; motivo: MotivoRecusa; mensagem: string; visao: VisaoSessao; falhaDebugger?: FalhaDebugger };

export type EventoParaInterface = { tipo: 'visao'; visao: VisaoSessao };
