import { describe, expect, it, vi } from 'vitest';
import type { Coletor, Selecao } from '../shared/types.ts';
import { criarAlvoSimulado, criarObservadorSimulado } from './apoio-teste.ts';
import { instalarObservadores } from './instalacao.ts';
import type { EscopoRastreavel } from './rastreador.ts';
import type { AoMedir } from './vitals.ts';

function instalar(selecao: Selecao) {
  const fabrica = criarObservadorSimulado();
  const { Alvo, ativos } = criarAlvoSimulado();
  const escopo = { PerformanceObserver: fabrica.Observador, EventTarget: Alvo } as unknown as EscopoRastreavel;
  let medir: AoMedir = () => undefined;
  // Faz o papel da web-vitals: cria um observador e um listener, como a biblioteca faria.
  const instalarVitals = vi.fn((coletores: readonly Coletor[], aoMedir: AoMedir) => {
    medir = aoMedir;
    if (!coletores.includes('metricas-carregamento') && !coletores.includes('inp')) return;
    new escopo.PerformanceObserver(() => undefined).observe({ type: 'paint', buffered: true });
    (escopo.EventTarget.prototype.addEventListener as (...a: unknown[]) => void).call(
      new Alvo(),
      'visibilitychange',
      () => undefined,
      true,
    );
  });
  const instalacao = instalarObservadores(selecao, {
    escopo,
    origemTempo: 5000,
    urlAtual: () => 'http://localhost:4300/cpu-pesada',
    instalarVitals,
  });
  return { fabrica, ativos, instalacao, instalarVitals, medir: (...a: Parameters<AoMedir>) => medir(...a) };
}

describe('instalação conforme a seleção', () => {
  it('só com "Carregamento", nenhum observador de long task ou de interação é criado', () => {
    const { fabrica, instalarVitals } = instalar(['carregamento']);

    expect(fabrica.doTipo('longtask')).toEqual([]);
    expect(fabrica.doTipo('event')).toEqual([]);
    expect(fabrica.criados.flatMap((o) => o.opcoes.map((opcoes) => opcoes.type))).toEqual(['paint']);
    expect(instalarVitals).toHaveBeenCalledWith(['metricas-carregamento'], expect.any(Function));
  });

  it('só com "Processamento", observa long tasks e interações e não pede métricas de carregamento', () => {
    const { fabrica, instalarVitals } = instalar(['processamento']);

    expect(fabrica.doTipo('longtask')).toHaveLength(1);
    expect(fabrica.doTipo('event')).toHaveLength(1);
    expect(instalarVitals).toHaveBeenCalledWith(['long-tasks', 'interacoes', 'inp'], expect.any(Function));
  });

  it('seleção vazia não instala nada', () => {
    const { fabrica, ativos } = instalar([]);
    expect(fabrica.criados).toEqual([]);
    expect(ativos).toEqual([]);
  });
});

describe('lote e desinstalação', () => {
  it('o lote leva o documento e só as métricas que mudaram desde o anterior', () => {
    const { instalacao, medir } = instalar(['carregamento']);
    medir('FCP', 120);
    medir('LCP', 300);

    expect(instalacao.drenar()).toEqual({
      documento: { id: '5000', url: 'http://localhost:4300/cpu-pesada', inicio: 5000 },
      longTasks: [],
      interacoes: [],
      metricas: { FCP: 120, LCP: 300 },
    });
    medir('LCP', 450);
    expect(instalacao.drenar().metricas).toEqual({ LCP: 450 });
    expect(instalacao.drenar().metricas).toEqual({});
  });

  it('desinstalar desconecta tudo, inclusive o que a web-vitals criou, e devolve as contagens', () => {
    const { fabrica, ativos, instalacao, medir } = instalar(['processamento', 'carregamento']);
    expect(fabrica.tiposAtivos().sort()).toEqual(['event', 'longtask', 'paint']);
    expect(ativos).toHaveLength(1);

    expect(instalacao.desinstalar()).toEqual({ observadores: 3, listeners: 1 });
    expect(fabrica.tiposAtivos()).toEqual([]);
    expect(ativos).toEqual([]);

    // Medições tardias da web-vitals são ignoradas.
    medir('LCP', 999);
    expect(instalacao.drenar().metricas).toEqual({});
  });
});
