/**
 * Comparação entre duas execuções do mesmo cenário e avaliação de regressão contra
 * a linha de base. Funções puras, sobre o registro leve do histórico (as
 * estatísticas estão nele; os detalhes não são necessários).
 *
 * De cada execução entra a mediana de cada métrica entre as iterações. Para todas
 * as métricas atuais, menor é melhor.
 */
import { descreverCondicoes } from './condicoes.ts';
import { type RegistroExecucao, podeSerReferencia } from './historico.ts';
import { METRICAS_DE_ITERACAO } from './relatorio.ts';
import type { IdMetricaIteracao } from './types.ts';

export type MotivoRecusaComparacao = 'cenarios-diferentes' | 'sessao-manual' | 'resultado-incompleto';

export interface MetricaComparada {
  id: IdMetricaIteracao;
  nome: string;
  unidade: string;
  /** Mediana em cada execução; `null`: sem dado (a verificação não rodou, ou não houve amostra). */
  a: number | null;
  b: number | null;
  /** `b − a`; `null` se faltar um dos lados. */
  diferenca: number | null;
  /** Diferença sobre `a`, em %; `null` se faltar um dos lados ou se `a` for zero. */
  percentual: number | null;
  situacao: 'melhor' | 'pior' | 'igual' | 'sem-dado';
}

export interface DiferencaDeContexto {
  campo: string;
  a: string;
  b: string;
}

export interface LadoDaComparacao {
  id: string;
  inicio: number;
  versaoBuild: string | null;
}

export type Comparacao =
  | {
      ok: true;
      nomeCenario: string;
      a: LadoDaComparacao;
      b: LadoDaComparacao;
      metricas: MetricaComparada[];
      /** Diferenças nas condições de teste. Com alguma, os números não são diretamente comparáveis. */
      condicoes: DiferencaDeContexto[];
      /** Diferenças no ambiente: navegador, janela, extensões ativas. */
      ambiente: DiferencaDeContexto[];
    }
  | { ok: false; motivo: MotivoRecusaComparacao; mensagem: string };

const ORDEM: readonly IdMetricaIteracao[] = ['duracao-iteracao', 'tempo-long-tasks', 'pior-interacao'];

function recusa(a: RegistroExecucao, b: RegistroExecucao): Extract<Comparacao, { ok: false }> | null {
  if (a.tipo !== 'cenario' || b.tipo !== 'cenario') {
    return { ok: false, motivo: 'sessao-manual', mensagem: 'Sessões manuais não podem ser comparadas: só execuções de cenário têm iterações comparáveis.' };
  }
  if (a.grupo !== b.grupo) {
    return {
      ok: false,
      motivo: 'cenarios-diferentes',
      mensagem: `As execuções são de cenários diferentes ("${a.nomeCenario ?? ''}" e "${b.nomeCenario ?? ''}"). Só execuções do mesmo cenário podem ser comparadas.`,
    };
  }
  if (!podeSerReferencia(a) || !podeSerReferencia(b)) {
    return {
      ok: false,
      motivo: 'resultado-incompleto',
      mensagem: 'Uma das execuções não terminou bem (interrompida, cancelada, com erro ou com falha de sessão). Só execuções completas podem ser comparadas.',
    };
  }
  return null;
}

function mediana(registro: RegistroExecucao, id: IdMetricaIteracao): number | null {
  return registro.resumo?.cenario?.estatisticas.find((e) => e.id === id)?.mediana ?? null;
}

function comparar(id: IdMetricaIteracao, a: number | null, b: number | null): MetricaComparada {
  const base = { id, ...METRICAS_DE_ITERACAO[id], a, b };
  if (a === null || b === null) return { ...base, diferenca: null, percentual: null, situacao: 'sem-dado' };
  const diferenca = b - a;
  return {
    ...base,
    diferenca,
    percentual: a === 0 ? null : (diferenca / a) * 100,
    situacao: diferenca === 0 ? 'igual' : diferenca < 0 ? 'melhor' : 'pior',
  };
}

function diferencas(pares: readonly (readonly [string, string, string])[]): DiferencaDeContexto[] {
  return pares.filter(([, a, b]) => a !== b).map(([campo, a, b]) => ({ campo, a, b }));
}

const simNao = (valor: boolean): string => (valor ? 'sim' : 'não');
const ou = (valor: string | number | null | undefined): string => (valor === null || valor === undefined || valor === '' ? '—' : String(valor));

function diferencasDeCondicoes(a: RegistroExecucao, b: RegistroExecucao): DiferencaDeContexto[] {
  const rede = (r: RegistroExecucao): string => descreverCondicoes({ cpu: 1, rede: r.condicoes.rede });
  return diferencas([
    ['Perfil de throttling', a.condicoes.perfil, b.condicoes.perfil],
    ['Fator de CPU', `${a.condicoes.cpu}×`, `${b.condicoes.cpu}×`],
    ['Rede', rede(a), rede(b)],
    ['Cache desligado', simNao(a.condicoes.cacheDesligado), simNao(b.condicoes.cacheDesligado)],
    ['Cache limpo antes', simNao(a.condicoes.cacheLimpo), simNao(b.condicoes.cacheLimpo)],
    ['Storage apagado', ou([...a.condicoes.storageLimpo].sort().join(', ')), ou([...b.condicoes.storageLimpo].sort().join(', '))],
    ['Iterações', ou(a.configuracao?.iteracoes), ou(b.configuracao?.iteracoes)],
    ['Verificações', [...a.selecao].sort().join(', '), [...b.selecao].sort().join(', ')],
  ]);
}

function diferencasDeAmbiente(a: RegistroExecucao, b: RegistroExecucao): DiferencaDeContexto[] {
  const janela = (r: RegistroExecucao): string => (r.ambiente ? `${r.ambiente.janela.largura}×${r.ambiente.janela.altura}` : '—');
  const extensoes = (r: RegistroExecucao): string => ou(r.extensoes.map((e) => e.nome).sort().join(', '));
  return diferencas([
    ['Versão do navegador', ou(a.ambiente?.versaoNavegador ?? a.navegador?.versao), ou(b.ambiente?.versaoNavegador ?? b.navegador?.versao)],
    ['Janela', janela(a), janela(b)],
    ['Densidade de pixels', ou(a.ambiente?.dpr), ou(b.ambiente?.dpr)],
    ['Outras extensões ativas', extensoes(a), extensoes(b)],
  ]);
}

/**
 * Compara `b` com `a` (a referência). Só as métricas presentes nas duas têm
 * diferença; as outras saem como "sem dado". Recusa cenários diferentes, sessões
 * manuais e resultados que não terminaram bem.
 */
export function compararExecucoes(a: RegistroExecucao, b: RegistroExecucao): Comparacao {
  const recusada = recusa(a, b);
  if (recusada) return recusada;
  const lado = (r: RegistroExecucao): LadoDaComparacao => ({ id: r.id, inicio: r.inicio, versaoBuild: r.versaoBuild });
  return {
    ok: true,
    nomeCenario: a.nomeCenario ?? '',
    a: lado(a),
    b: lado(b),
    metricas: ORDEM.map((id) => comparar(id, mediana(a, id), mediana(b, id))),
    condicoes: diferencasDeCondicoes(a, b),
    ambiente: diferencasDeAmbiente(a, b),
  };
}

/** Execuções que podem ser comparadas com `registro`: completas, do mesmo cenário, exceto ela mesma. */
export function comparaveisCom(registro: RegistroExecucao, historico: readonly RegistroExecucao[]): RegistroExecucao[] {
  if (!podeSerReferencia(registro)) return [];
  return historico.filter((outro) => outro.id !== registro.id && outro.grupo === registro.grupo && podeSerReferencia(outro));
}

// ---------------------------------------------------------------------------
// Linha de base
// ---------------------------------------------------------------------------

/** Limite de regressão padrão, em %, para toda métrica sem limite próprio. */
export const LIMITE_REGRESSAO_PADRAO = 10;

/** Linha de base de um cenário: a execução de referência e o limite de regressão por métrica, em %. */
export interface LinhaDeBase {
  id: string;
  limites: Partial<Record<IdMetricaIteracao, number>>;
}

export function limiteDe(linha: Pick<LinhaDeBase, 'limites'>, id: IdMetricaIteracao): number {
  return linha.limites[id] ?? LIMITE_REGRESSAO_PADRAO;
}

/** Aproveita o que for válido de um valor salvo; `null` se não houver execução de referência. */
export function normalizarLinhaDeBase(valor: unknown): LinhaDeBase | null {
  const v = (valor && typeof valor === 'object' ? valor : {}) as Partial<LinhaDeBase>;
  if (typeof v.id !== 'string' || v.id === '') return null;
  const limites: LinhaDeBase['limites'] = {};
  const salvos = (v.limites && typeof v.limites === 'object' ? v.limites : {}) as Record<string, unknown>;
  for (const id of ORDEM) {
    const limite = salvos[id];
    if (typeof limite === 'number' && Number.isFinite(limite) && limite >= 0) limites[id] = limite;
  }
  return { id: v.id, limites };
}

export interface MetricaAvaliada extends MetricaComparada {
  /** Limite de regressão da métrica, em %. */
  limite: number;
  /** `sem-dado`: a métrica falta na linha de base ou na nova execução, e não é avaliada. */
  resultado: 'regressao' | 'dentro-do-limite' | 'sem-dado';
}

export type AvaliacaoRegressao =
  | {
      ok: true;
      metricas: MetricaAvaliada[];
      /** `true` se alguma métrica passou do limite. */
      regressao: boolean;
      /** Diferenças de condições entre a linha de base e a nova execução. */
      condicoes: DiferencaDeContexto[];
    }
  | { ok: false; motivo: MotivoRecusaComparacao; mensagem: string };

/**
 * Compara a nova execução com a linha de base. É regressão a métrica que piorou
 * mais do que o limite, em %. Se a linha de base é zero, não há percentual:
 * qualquer aumento conta como regressão.
 */
export function avaliarRegressao(base: RegistroExecucao, nova: RegistroExecucao, linha: Pick<LinhaDeBase, 'limites'>): AvaliacaoRegressao {
  const comparacao = compararExecucoes(base, nova);
  if (!comparacao.ok) return comparacao;
  const metricas = comparacao.metricas.map((metrica): MetricaAvaliada => {
    const limite = limiteDe(linha, metrica.id);
    const passou =
      metrica.diferenca !== null && metrica.diferenca > 0 && (metrica.percentual === null || metrica.percentual > limite);
    return { ...metrica, limite, resultado: metrica.situacao === 'sem-dado' ? 'sem-dado' : passou ? 'regressao' : 'dentro-do-limite' };
  });
  return { ok: true, metricas, regressao: metricas.some((m) => m.resultado === 'regressao'), condicoes: comparacao.condicoes };
}
