/**
 * Variação entre execuções repetidas do mesmo cenário nas mesmas condições.
 * Funções puras.
 *
 * De cada execução entra a mediana de cada métrica entre as iterações. O
 * coeficiente de variação (desvio padrão amostral ÷ média) acima do limite
 * configurado sinaliza a métrica como instável: a diferença entre duas execuções
 * pode ser só ruído.
 */
import { type RegistroExecucao, podeSerReferencia } from './historico.ts';
import type { IdMetricaIteracao } from './types.ts';

/** Com menos execuções do que isto não há variação a reportar. */
export const MINIMO_DE_EXECUCOES = 2;

/** Desvio padrão amostral sobre a média, em %. `null` com menos de dois valores ou média zero. */
export function coeficienteDeVariacao(valores: readonly number[]): number | null {
  if (valores.length < 2) return null;
  const media = valores.reduce((soma, v) => soma + v, 0) / valores.length;
  if (media === 0) return null;
  const variancia = valores.reduce((soma, v) => soma + (v - media) ** 2, 0) / (valores.length - 1);
  return (Math.sqrt(variancia) / Math.abs(media)) * 100;
}

export interface VariacaoMetrica {
  id: IdMetricaIteracao;
  /** Execuções em que a métrica tinha valor. */
  execucoes: number;
  media: number | null;
  /** Em %; `null` se não deu para calcular (poucas execuções, ou média zero). */
  coeficiente: number | null;
  instavel: boolean;
}

export interface VariacaoDoGrupo {
  nomeCenario: string;
  /** Execuções comparáveis: mesmo cenário, mesmas condições e mesmo número de iterações. */
  execucoes: number;
  ids: string[];
  metricas: VariacaoMetrica[];
  /** `true` se alguma métrica passou do limite. */
  instavel: boolean;
}

/**
 * Agrupa as execuções concluídas por cenário, condições e número de iterações e
 * calcula a variação de cada métrica. Resultados parciais ficam de fora. Só
 * devolve grupos com ao menos `MINIMO_DE_EXECUCOES`.
 */
export function variacaoEntreExecucoes(registros: readonly RegistroExecucao[], limitePercentual: number): VariacaoDoGrupo[] {
  const grupos = new Map<string, RegistroExecucao[]>();
  for (const registro of registros) {
    if (!podeSerReferencia(registro) || !registro.resumo?.cenario) continue;
    const chave = `${registro.grupo}|${registro.chaveCondicoes}|${registro.configuracao?.iteracoes ?? ''}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), registro]);
  }

  const variacoes: VariacaoDoGrupo[] = [];
  for (const grupo of grupos.values()) {
    if (grupo.length < MINIMO_DE_EXECUCOES) continue;
    const porMetrica = new Map<IdMetricaIteracao, number[]>();
    for (const registro of grupo) {
      for (const estatistica of registro.resumo!.cenario!.estatisticas) {
        if (estatistica.mediana === null) continue;
        porMetrica.set(estatistica.id, [...(porMetrica.get(estatistica.id) ?? []), estatistica.mediana]);
      }
    }
    const metricas: VariacaoMetrica[] = [...porMetrica].map(([id, valores]) => {
      const coeficiente = coeficienteDeVariacao(valores);
      return {
        id,
        execucoes: valores.length,
        media: valores.length ? valores.reduce((soma, v) => soma + v, 0) / valores.length : null,
        coeficiente,
        instavel: coeficiente !== null && coeficiente > limitePercentual,
      };
    });
    variacoes.push({
      nomeCenario: grupo[0]!.nomeCenario ?? '',
      execucoes: grupo.length,
      ids: grupo.map((r) => r.id),
      metricas,
      instavel: metricas.some((m) => m.instavel),
    });
  }
  return variacoes.sort((a, b) => a.nomeCenario.localeCompare(b.nomeCenario, 'pt-BR'));
}
