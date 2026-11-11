import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';
import type { Coletor, NomeMetrica } from '../shared/types.ts';

export type AoMedir = (nome: NomeMetrica, valor: number) => void;

/** Métricas da `web-vitals` que cada coletor liga. */
export function metricasDosColetores(coletores: readonly Coletor[]): NomeMetrica[] {
  const metricas: NomeMetrica[] = [];
  if (coletores.includes('metricas-carregamento')) metricas.push('LCP', 'CLS', 'FCP', 'TTFB');
  if (coletores.includes('inp')) metricas.push('INP');
  return metricas;
}

/**
 * Converte o que a `web-vitals` reporta no par nome/valor do protocolo. Valores
 * que não são números finitos são descartados, e a métrica fica indisponível.
 */
export function mapearMetrica(metrica: { name: string; value: number }): { nome: NomeMetrica; valor: number } | null {
  const nomes: readonly string[] = ['LCP', 'CLS', 'FCP', 'TTFB', 'INP'] satisfies NomeMetrica[];
  if (!nomes.includes(metrica.name) || !Number.isFinite(metrica.value)) return null;
  return { nome: metrica.name as NomeMetrica, valor: metrica.value };
}

/**
 * Liga a `web-vitals` para as métricas pedidas. `reportAllChanges` faz o valor
 * chegar assim que muda, em vez de só quando a página é ocultada. A biblioteca
 * não tem como ser desligada: quem desconecta seus observadores é o rastreador.
 */
export function instalarVitals(coletores: readonly Coletor[], aoMedir: AoMedir): void {
  const pedidas = metricasDosColetores(coletores);
  const reportar = (metrica: { name: string; value: number }): void => {
    const mapeada = mapearMetrica(metrica);
    if (mapeada) aoMedir(mapeada.nome, mapeada.valor);
  };
  const opcoes = { reportAllChanges: true };
  if (pedidas.includes('LCP')) onLCP(reportar, opcoes);
  if (pedidas.includes('CLS')) onCLS(reportar, opcoes);
  if (pedidas.includes('FCP')) onFCP(reportar, opcoes);
  if (pedidas.includes('TTFB')) onTTFB(reportar, opcoes);
  if (pedidas.includes('INP')) onINP(reportar, opcoes);
}
