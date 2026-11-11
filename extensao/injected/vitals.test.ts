import { describe, expect, it } from 'vitest';
import { aplicarLote, dadosVazios, inpDaAnalise, metricasDeCarregamento } from '../shared/agregacao.ts';
import type { MetricasParciais } from '../shared/types.ts';
import { mapearMetrica, metricasDosColetores } from './vitals.ts';

describe('mapeamento da web-vitals', () => {
  it('converte cada métrica reportada no par nome/valor', () => {
    expect(mapearMetrica({ name: 'LCP', value: 812.4 })).toEqual({ nome: 'LCP', valor: 812.4 });
    expect(mapearMetrica({ name: 'CLS', value: 0 })).toEqual({ nome: 'CLS', valor: 0 });
    expect(mapearMetrica({ name: 'INP', value: 320 })).toEqual({ nome: 'INP', valor: 320 });
  });

  it('descarta métricas desconhecidas e valores que não são números finitos', () => {
    expect(mapearMetrica({ name: 'FID', value: 12 })).toBeNull();
    expect(mapearMetrica({ name: 'LCP', value: Number.NaN })).toBeNull();
  });

  it('liga só as métricas dos coletores pedidos', () => {
    expect(metricasDosColetores(['metricas-carregamento'])).toEqual(['LCP', 'CLS', 'FCP', 'TTFB']);
    expect(metricasDosColetores(['long-tasks', 'interacoes', 'inp'])).toEqual(['INP']);
    expect(metricasDosColetores([])).toEqual([]);
  });

  it('métrica que o navegador não emitiu chega ao resultado como indisponível, não como zero', () => {
    // O navegador reportou FCP, TTFB e um CLS igual a zero; LCP e INP nunca vieram.
    const reportadas = [
      { name: 'FCP', value: 120 },
      { name: 'TTFB', value: 35 },
      { name: 'CLS', value: 0 },
    ];
    const metricas: MetricasParciais = {};
    for (const metrica of reportadas) {
      const mapeada = mapearMetrica(metrica);
      if (mapeada) metricas[mapeada.nome] = mapeada.valor;
    }
    const dados = aplicarLote(dadosVazios(), {
      documento: { id: 'd', url: 'http://localhost:4300/limpa', inicio: 0 },
      longTasks: [],
      interacoes: [],
      metricas,
    });

    expect(metricasDeCarregamento(dados.documentos[0]!.metricas)).toEqual({ lcp: null, cls: 0, fcp: 120, ttfb: 35 });
    expect(inpDaAnalise(dados)).toBeNull();
  });
});
