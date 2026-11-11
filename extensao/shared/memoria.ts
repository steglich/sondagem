/**
 * Análise de memória, sem efeitos colaterais: comparação entre censos, série por
 * iteração, classificação de vazamento provável e variação de nós desanexados e
 * listeners. Os dados chegam prontos do service worker (`background/memoria.ts`).
 */
import type {
  AnaliseMemoria,
  ClassificacaoVazamento,
  ComparacaoSnapshots,
  DadosColetados,
  MedicaoMemoria,
  MetricaMemoria,
  PontoDaSerie,
  RegistroIteracao,
  ResumoSnapshot,
  Selecao,
  SerieMemoria,
  Variacao,
  VariacaoConstrutor,
  VariacaoDomListeners,
} from './types.ts';

// ---------------------------------------------------------------------------
// Limites
// ---------------------------------------------------------------------------

export interface LimitesClassificacao {
  /** Abaixo disso a classificação é "dados insuficientes". */
  iteracoesMinimas: number;
  /** Fração mínima das transições entre iterações consecutivas em que o valor precisa subir. */
  proporcaoCrescente: number;
  /** Crescimento total (último − primeiro) que cada série precisa superar, para ignorar flutuação. */
  crescimentoMinimo: Readonly<Record<MetricaMemoria, number>>;
}

/** Valores calibrados contra a página de teste; ver o design da fase 3. */
export const LIMITES_PADRAO: LimitesClassificacao = {
  iteracoesMinimas: 5,
  proporcaoCrescente: 0.8,
  crescimentoMinimo: { heap_usado: 100 * 1024, nos_dom: 3, listeners: 3 },
};

/** Quantos construtores o resumo de um censo guarda; o resto vira "outros". */
export const LIMITE_CONSTRUTORES = 500;
/** Intervalo das medições leves na sessão manual. */
export const INTERVALO_MEDICAO_MANUAL_MS = 5000;
/** Construtores exibidos na lista dos que mais cresceram. */
export const CONSTRUTORES_EXIBIDOS = 20;

export const METRICAS_MEMORIA: readonly MetricaMemoria[] = ['heap_usado', 'nos_dom', 'listeners'];

const CAMPO_DA_METRICA: Record<MetricaMemoria, 'heapUsado' | 'nosDom' | 'listeners'> = {
  heap_usado: 'heapUsado',
  nos_dom: 'nosDom',
  listeners: 'listeners',
};

// ---------------------------------------------------------------------------
// Comparação entre censos
// ---------------------------------------------------------------------------

function variar(antes: number, depois: number): Variacao {
  return { antes, depois, variacao: depois - antes };
}

/**
 * Junta os dois censos por nome de construtor e ordena pela variação de contagem,
 * do que mais ganhou objetos para o que mais perdeu. Um construtor que só existe em
 * um dos lados conta como zero no outro (ele pode estar em "outros", que não entra
 * na comparação).
 */
export function compararSnapshots(primeiro: ResumoSnapshot, ultimo: ResumoSnapshot): ComparacaoSnapshots {
  const antes = new Map(primeiro.construtores.map((c) => [c.nome, c.contagem]));
  const depois = new Map(ultimo.construtores.map((c) => [c.nome, c.contagem]));
  const nomes = new Set([...antes.keys(), ...depois.keys()]);

  const construtores: VariacaoConstrutor[] = [...nomes].map((nome) => ({
    nome,
    situacao: antes.has(nome) && depois.has(nome) ? 'ambos' : depois.has(nome) ? 'novo' : 'removido',
    contagem: variar(antes.get(nome) ?? 0, depois.get(nome) ?? 0),
  }));
  construtores.sort((x, y) => y.contagem.variacao - x.contagem.variacao || x.nome.localeCompare(y.nome));
  return { de: primeiro.rotulo, para: ultimo.rotulo, construtores };
}

// ---------------------------------------------------------------------------
// Série por iteração e classificação
// ---------------------------------------------------------------------------

/**
 * Classifica uma série de valores medidos depois de cada iteração:
 *   1. menos pontos do que `iteracoesMinimas` → "dados insuficientes";
 *   2. subiu em pelo menos `proporcaoCrescente` das transições e
 *   3. cresceu no total mais do que `crescimentoMinimo` → "vazamento provável";
 *   caso contrário, "sem indício".
 * Um degrau único (cache legítimo) falha na condição 2; ruído em torno de um valor
 * estável falha na 2 ou na 3.
 */
export function classificarSerie(
  valores: readonly number[],
  crescimentoMinimo: number,
  limites: Pick<LimitesClassificacao, 'iteracoesMinimas' | 'proporcaoCrescente'> = LIMITES_PADRAO,
): ClassificacaoVazamento {
  if (valores.length < limites.iteracoesMinimas || valores.length < 2) return 'dados-insuficientes';
  const transicoes = valores.length - 1;
  const consistente = contarCrescentes(valores) / transicoes >= limites.proporcaoCrescente;
  const relevante = valores[valores.length - 1]! - valores[0]! > crescimentoMinimo;
  return consistente && relevante ? 'vazamento-provavel' : 'sem-indicio';
}

function contarCrescentes(valores: readonly number[]): number {
  let crescentes = 0;
  for (let i = 1; i < valores.length; i++) if (valores[i]! > valores[i - 1]!) crescentes++;
  return crescentes;
}

/**
 * Série de cada métrica: o valor da última medição de cada iteração completa. Uma
 * métrica que nenhum passo `medir` pediu sai com a série vazia.
 */
export function seriesPorIteracao(
  medicoes: readonly MedicaoMemoria[],
  iteracoes: readonly Pick<RegistroIteracao, 'numero' | 'completa'>[],
  limites: LimitesClassificacao = LIMITES_PADRAO,
): SerieMemoria[] {
  const completas = iteracoes.filter((i) => i.completa).map((i) => i.numero);
  return METRICAS_MEMORIA.map((metrica) => {
    const campo = CAMPO_DA_METRICA[metrica];
    const pontos: PontoDaSerie[] = [];
    for (const numero of completas) {
      const valor = medicoes.filter((m) => m.iteracao === numero && m[campo] !== null).at(-1)?.[campo];
      if (valor !== undefined && valor !== null) pontos.push({ iteracao: numero, valor });
    }
    const valores = pontos.map((p) => p.valor);
    return {
      metrica,
      pontos,
      crescimentoMedio: valores.length < 2 ? null : (valores[valores.length - 1]! - valores[0]!) / (valores.length - 1),
      transicoesCrescentes: contarCrescentes(valores),
      classificacao: classificarSerie(valores, limites.crescimentoMinimo[metrica], limites),
    };
  });
}

/**
 * Classificação da execução a partir das três séries. Basta uma delas crescer de
 * forma consistente: um nó DOM retido quase não aparece no heap de JavaScript, e é a
 * série de nós que o acusa. Sem nenhuma série com pontos suficientes, os dados são
 * insuficientes.
 */
export function classificarExecucao(series: readonly Pick<SerieMemoria, 'classificacao'>[]): ClassificacaoVazamento {
  if (series.some((s) => s.classificacao === 'vazamento-provavel')) return 'vazamento-provavel';
  if (series.some((s) => s.classificacao === 'sem-indicio')) return 'sem-indicio';
  return 'dados-insuficientes';
}

// ---------------------------------------------------------------------------
// Nós desanexados e listeners
// ---------------------------------------------------------------------------

/** Variação de nós desanexados e de listeners entre os contadores de início e de fim da análise. */
export function variacaoDomListeners(dados: Pick<DadosColetados, 'contadoresDom'>): VariacaoDomListeners {
  const { inicio, fim } = dados.contadoresDom;
  if (!inicio || !fim) return { nosDesanexados: null, listeners: null };
  return {
    nosDesanexados: inicio.nosDesanexados !== null && fim.nosDesanexados !== null ? variar(inicio.nosDesanexados, fim.nosDesanexados) : null,
    listeners: variar(inicio.listeners, fim.listeners),
  };
}

// ---------------------------------------------------------------------------
// Análise completa
// ---------------------------------------------------------------------------

/**
 * Monta a parte de memória do resultado, ou `null` se nenhuma das duas verificações
 * foi marcada. `iteracoes` nulo: sessão manual, sem série nem classificação.
 */
export function analisarMemoria(
  dados: DadosColetados,
  selecao: Selecao,
  iteracoes: readonly Pick<RegistroIteracao, 'numero' | 'completa'>[] | null,
  limites: LimitesClassificacao = LIMITES_PADRAO,
): AnaliseMemoria | null {
  const comMemoria = selecao.includes('memoria');
  const comDom = selecao.includes('dom-listeners');
  if (!comMemoria && !comDom) return null;

  const series = comMemoria && iteracoes ? seriesPorIteracao(dados.medicoes, iteracoes, limites) : [];
  const primeiro = dados.snapshots[0];
  const ultimo = dados.snapshots.at(-1);
  return {
    classificacao: comMemoria && iteracoes ? classificarExecucao(series) : null,
    series,
    comparacao: primeiro && ultimo && primeiro !== ultimo ? compararSnapshots(primeiro, ultimo) : null,
    domListeners: comDom ? variacaoDomListeners(dados) : null,
  };
}
