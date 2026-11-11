import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lote } from '../shared/types.ts';
import { criarObservadorSimulado } from './apoio-teste.ts';
import { criarEmissor } from './lotes.ts';
import { criarColeta } from './observers.ts';

describe('envio em lotes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function montar() {
    const fabrica = criarObservadorSimulado();
    const coleta = criarColeta({
      coletores: ['long-tasks'],
      Observador: fabrica.Observador,
      origemTempo: 0,
      documento: 'doc-1',
    });
    const enviados: Lote[] = [];
    const emissor = criarEmissor({
      drenar: () => ({ documento: { id: 'doc-1', url: 'http://x/', inicio: 0 }, ...coleta.drenar(), metricas: {} }),
      enviar: (lote) => enviados.push(lote),
    });
    return { observador: fabrica.doTipo('longtask')[0]!, enviados, emissor };
  }

  it('50 long tasks em um segundo saem em um único lote', () => {
    const { observador, enviados } = montar();

    for (let i = 0; i < 50; i++) {
      observador.emitir([{ startTime: i * 20, duration: 60 }]);
      vi.advanceTimersByTime(19);
    }
    expect(enviados).toHaveLength(0);

    vi.advanceTimersByTime(50);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]?.longTasks).toHaveLength(50);
  });

  it('envia no máximo um lote por segundo, e cada registro uma única vez', () => {
    const { observador, enviados } = montar();

    for (let t = 0; t < 3000; t += 10) {
      observador.emitir([{ startTime: t, duration: 55 }]);
      vi.advanceTimersByTime(10);
    }
    expect(enviados).toHaveLength(3);
    expect(enviados.flatMap((lote) => lote.longTasks)).toHaveLength(300);
  });

  it('parar cancela o temporizador', () => {
    const { enviados, emissor } = montar();
    emissor.parar();
    vi.advanceTimersByTime(5000);
    expect(enviados).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
