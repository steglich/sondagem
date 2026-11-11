/** Estatísticas usadas no resumo das execuções. Funções puras; lista vazia devolve `null`. */

/**
 * Percentil `p` (entre 0 e 1) por interpolação linear entre os vizinhos: a posição
 * é `p × (n − 1)` na lista ordenada. Com um elemento, todo percentil é o próprio elemento.
 */
export function percentil(valores: readonly number[], p: number): number | null {
  if (valores.length === 0) return null;
  if (!(p >= 0 && p <= 1)) throw new RangeError(`Percentil fora do intervalo de 0 a 1: ${p}`);
  const ordenados = [...valores].sort((a, b) => a - b);
  const posicao = p * (ordenados.length - 1);
  const abaixo = Math.floor(posicao);
  const acima = Math.ceil(posicao);
  const fracao = posicao - abaixo;
  return ordenados[abaixo]! + (ordenados[acima]! - ordenados[abaixo]!) * fracao;
}

export const mediana = (valores: readonly number[]): number | null => percentil(valores, 0.5);
export const p75 = (valores: readonly number[]): number | null => percentil(valores, 0.75);
export const p95 = (valores: readonly number[]): number | null => percentil(valores, 0.95);

export interface Resumo {
  /** Quantos valores entraram no cálculo. */
  amostras: number;
  mediana: number | null;
  p75: number | null;
  p95: number | null;
}

export function resumirValores(valores: readonly number[]): Resumo {
  return { amostras: valores.length, mediana: mediana(valores), p75: p75(valores), p95: p95(valores) };
}
