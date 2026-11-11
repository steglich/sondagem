/**
 * Tipos compartilhados entre a página testada, o service worker e a interface.
 *
 * Fluxo das mensagens:
 *   página  ──(porta NOME_PORTA_PAGINA: MensagemDaPagina)──▶ service worker
 *   página  ◀─(porta NOME_PORTA_PAGINA: MensagemParaPagina)── service worker
 *   interface ──(runtime.sendMessage: ComandoInterface → RespostaComando)──▶ service worker
 *   interface ◀─(runtime.sendMessage: EventoParaInterface)── service worker
 */

// ---------------------------------------------------------------------------
// Verificações
// ---------------------------------------------------------------------------

export type IdVerificacao = 'processamento' | 'carregamento';

/** O que uma verificação precisa para rodar. `debugger` entra na fase 2. */
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

/** Contexto ao qual uma seleção salva pertence: a sessão manual ou, a partir da fase 2, o nome de um cenário. */
export type ContextoSelecao = string;
export const CONTEXTO_MANUAL: ContextoSelecao = 'manual';

// ---------------------------------------------------------------------------
// Medições
// ---------------------------------------------------------------------------

export interface LongTask {
  /** Instante de início, em ms desde a época (timeOrigin + startTime). */
  inicio: number;
  duracao: number;
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
}

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
}

/** O que a interface mostra enquanto a análise roda. Os registros detalhados só vão ao término. */
export interface StatusResumido {
  longTasks: number;
  interacoes: number;
  /** Maior duração de long task até agora, ou `null` se não houve nenhuma. */
  piorLongTask: number | null;
  carregamentos: number;
}

// ---------------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------------

export type FaseSessao = 'ociosa' | 'ativa' | 'parando';

export type TipoAnalise = 'sessao-manual';

export type Desfecho = 'concluida' | 'cancelada' | 'interrompida';

export type TipoRecurso = 'script-registrado' | 'observador' | 'listener' | 'porta' | 'temporizador';

/** Uma linha da "lista do que foi removido" exibida depois da limpeza. */
export interface ItemLimpeza {
  recurso: TipoRecurso;
  quantidade: number;
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

export type MensagemParaPagina = { tipo: 'configurar'; selecao: Selecao } | { tipo: 'encerrar' };

export type MensagemDaPagina =
  | { tipo: 'lote'; lote: Lote }
  | { tipo: 'encerrado'; lote: Lote; desconectados: Desconectados };

// ---------------------------------------------------------------------------
// Mensagens interface ↔ service worker
// ---------------------------------------------------------------------------

export type ComandoInterface =
  | { tipo: 'obter-visao' }
  | { tipo: 'iniciar'; idAba: number; selecao: Selecao }
  | { tipo: 'parar' }
  | { tipo: 'cancelar' };

export type MotivoRecusa = 'sessao-ativa' | 'sem-sessao' | 'sem-verificacao' | 'url-nao-suportada' | 'erro';

export type RespostaComando =
  | { ok: true; visao: VisaoSessao }
  | { ok: false; motivo: MotivoRecusa; mensagem: string; visao: VisaoSessao };

export type EventoParaInterface = { tipo: 'visao'; visao: VisaoSessao };
