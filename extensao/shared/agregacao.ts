import { resumirValores } from './stats.ts';
import {
  ALVO_DESCONHECIDO,
  type DadosColetados,
  type ErroPagina,
  type EstatisticaMetrica,
  type Intervalo,
  type LongTask,
  type Lote,
  type MetricasCarregamento,
  type MetricasParciais,
  type RegistroIteracao,
  type Selecao,
  type StatusResumido,
} from './types.ts';

export function dadosVazios(): DadosColetados {
  return {
    longTasks: [],
    interacoes: [],
    documentos: [],
    errosPagina: [],
    medicoes: [],
    snapshots: [],
    pausasDeMedicao: [],
    contadoresDom: { inicio: null, fim: null },
    cpu: null,
  };
}

/** Intervalos de uma execução de cenário, usados para carimbar cada registro com a sua iteração. */
export interface Marcacao {
  aquecimento: Intervalo | null;
  iteracoes: readonly (Intervalo & { numero: number })[];
}

function contem(intervalo: Intervalo, instante: number): boolean {
  return instante >= intervalo.inicio && (intervalo.fim === null || instante < intervalo.fim);
}

/**
 * Onde um instante cai na execução: `'aquecimento'` (o registro é descartado), o
 * número da iteração, ou `null` se está fora de qualquer iteração.
 */
export function classificarInstante(instante: number, marcacao: Marcacao): number | null | 'aquecimento' {
  if (marcacao.aquecimento && contem(marcacao.aquecimento, instante)) return 'aquecimento';
  return marcacao.iteracoes.find((iteracao) => contem(iteracao, instante))?.numero ?? null;
}

/** Carimba os registros com a iteração e tira os do aquecimento. Sem marcação (sessão manual), devolve como veio. */
function carimbar<T extends { iteracao?: number | null }>(
  registros: readonly T[],
  instante: (registro: T) => number,
  marcacao: Marcacao | undefined,
): T[] {
  if (!marcacao) return [...registros];
  const mantidos: T[] = [];
  for (const registro of registros) {
    const onde = classificarInstante(instante(registro), marcacao);
    if (onde !== 'aquecimento') mantidos.push({ ...registro, iteracao: onde });
  }
  return mantidos;
}

/** `true` se a long task coincide com a pausa de um censo de objetos: quem parou a página foi a medição. */
function duranteMedicao(tarefa: LongTask, pausas: readonly Intervalo[]): boolean {
  const fim = tarefa.inicio + tarefa.duracao;
  return pausas.some((pausa) => tarefa.inicio < (pausa.fim ?? Infinity) && fim > pausa.inicio);
}

/**
 * Marca as long tasks que já tinham chegado quando a pausa de um censo foi
 * registrada. As que chegam depois são marcadas em `aplicarLote`.
 */
export function marcarLongTasksDaMedicao(dados: DadosColetados): void {
  for (const tarefa of dados.longTasks) {
    if (!tarefa.causadaPelaMedicao && duranteMedicao(tarefa, dados.pausasDeMedicao)) tarefa.causadaPelaMedicao = true;
  }
}

/**
 * Junta um lote vindo da página aos dados da sessão. Altera e devolve `dados`.
 * Com `marcacao` (execução de cenário), cada registro recebe o número da iteração
 * em que começou, e o que ocorreu durante o aquecimento é descartado.
 */
export function aplicarLote(dados: DadosColetados, lote: Lote, marcacao?: Marcacao): DadosColetados {
  for (const tarefa of carimbar(lote.longTasks, (t) => t.inicio, marcacao)) {
    dados.longTasks.push(duranteMedicao(tarefa, dados.pausasDeMedicao) ? { ...tarefa, causadaPelaMedicao: true } : tarefa);
  }

  // A mesma interação pode chegar em dois lotes (pointerdown em um, click no seguinte):
  // fica o registro mais demorado.
  for (const interacao of carimbar(lote.interacoes, (i) => i.inicio, marcacao)) {
    const existente = dados.interacoes.find((i) => i.id === interacao.id && i.documento === interacao.documento);
    if (!existente) dados.interacoes.push(interacao);
    else if (interacao.duracao > existente.duracao) {
      const alvo = interacao.alvo === ALVO_DESCONHECIDO ? existente.alvo : interacao.alvo;
      Object.assign(existente, interacao, { alvo });
    } else if (existente.alvo === ALVO_DESCONHECIDO) {
      // O registro que fica pode ter chegado sem alvo; outro evento da mesma interação o traz.
      existente.alvo = interacao.alvo;
    }
  }

  let documento = dados.documentos.find((d) => d.id === lote.documento.id);
  if (!documento) {
    documento = { ...lote.documento, metricas: {} };
    dados.documentos.push(documento);
  }
  documento.url = lote.documento.url;
  Object.assign(documento.metricas, lote.metricas);
  return dados;
}

/** Registra um erro da página. Em cenários, recebe a iteração e some se ocorreu no aquecimento. */
export function aplicarErroPagina(dados: DadosColetados, erro: ErroPagina, marcacao?: Marcacao): DadosColetados {
  dados.errosPagina.push(...carimbar([erro], (e) => e.instante, marcacao));
  return dados;
}

/**
 * Mediana, p75 e p95 de cada métrica por iteração, só entre as iterações completas.
 * Uma iteração sem interação não entra na amostra de "pior interação". Long tasks
 * causadas pela medição (censo de objetos) não contam.
 */
export function estatisticasDaExecucao(
  dados: DadosColetados,
  iteracoes: readonly RegistroIteracao[],
  selecao: Selecao,
): EstatisticaMetrica[] {
  const completas = iteracoes.filter((iteracao) => iteracao.completa && iteracao.fim !== null);
  const estatisticas: EstatisticaMetrica[] = [
    { id: 'duracao-iteracao', ...resumirValores(completas.map((i) => i.fim! - i.inicio)) },
  ];
  if (!selecao.includes('processamento')) return estatisticas;

  const tempoLongTasks = completas.map((iteracao) =>
    dados.longTasks.filter((t) => t.iteracao === iteracao.numero && !t.causadaPelaMedicao).reduce((total, t) => total + t.duracao, 0),
  );
  const piorInteracao = completas
    .map((iteracao) => dados.interacoes.filter((i) => i.iteracao === iteracao.numero).map((i) => i.duracao))
    .filter((duracoes) => duracoes.length > 0)
    .map((duracoes) => Math.max(...duracoes));
  estatisticas.push(
    { id: 'tempo-long-tasks', ...resumirValores(tempoLongTasks) },
    { id: 'pior-interacao', ...resumirValores(piorInteracao) },
  );
  return estatisticas;
}

export function resumir(dados: DadosColetados): StatusResumido {
  return {
    longTasks: dados.longTasks.length,
    interacoes: dados.interacoes.length,
    piorLongTask: dados.longTasks.length ? Math.max(...dados.longTasks.map((t) => t.duracao)) : null,
    carregamentos: dados.documentos.length,
    errosPagina: dados.errosPagina.length,
    heapUsado: dados.medicoes.filter((m) => m.heapUsado !== null).at(-1)?.heapUsado ?? null,
    snapshots: dados.snapshots.length,
    cpu: dados.cpu === null ? null : dados.cpu.limiteAtingido ? 'limite-atingido' : dados.cpu.estado,
  };
}

/** Métrica que o navegador não produziu vira `null` (indisponível), nunca zero. */
export function metricasDeCarregamento(metricas: MetricasParciais): MetricasCarregamento {
  return {
    lcp: metricas.LCP ?? null,
    cls: metricas.CLS ?? null,
    fcp: metricas.FCP ?? null,
    ttfb: metricas.TTFB ?? null,
  };
}

/** INP da análise: o pior INP entre os documentos observados, ou `null` se nenhum produziu. */
export function inpDaAnalise(dados: DadosColetados): number | null {
  const valores = dados.documentos.map((d) => d.metricas.INP).filter((v) => v !== undefined);
  return valores.length ? Math.max(...valores) : null;
}
