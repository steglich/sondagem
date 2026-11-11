import { describe, expect, it } from 'vitest';
import { criarAlvoSimulado, criarObservadorSimulado } from './apoio-teste.ts';
import { type EscopoRastreavel, obterRastreador } from './rastreador.ts';

function montar() {
  const fabrica = criarObservadorSimulado();
  const { Alvo, ativos } = criarAlvoSimulado();
  const escopo = { PerformanceObserver: fabrica.Observador, EventTarget: Alvo } as unknown as EscopoRastreavel;
  const rastreador = obterRastreador(escopo);
  const alvo = new Alvo() as unknown as EventTarget;
  return { fabrica, ativos, escopo, rastreador, alvo };
}

describe('rastreador', () => {
  it('conta e desconecta observadores e listeners criados depois de instalado', () => {
    const { fabrica, ativos, escopo, rastreador, alvo } = montar();
    const ouvinte = (): void => undefined;

    new escopo.PerformanceObserver(() => undefined).observe({ type: 'longtask' });
    new escopo.PerformanceObserver(() => undefined).observe({ type: 'event' });
    alvo.addEventListener('visibilitychange', ouvinte, true);
    alvo.addEventListener('pageshow', ouvinte);

    expect(rastreador.desconectarTudo()).toEqual({ observadores: 2, listeners: 2 });
    expect(fabrica.tiposAtivos()).toEqual([]);
    expect(ativos).toEqual([]);
  });

  it('não conta o que já foi desligado por quem criou', () => {
    const { escopo, rastreador, alvo } = montar();
    const ouvinte = (): void => undefined;
    const observador = new escopo.PerformanceObserver(() => undefined);
    observador.observe({ type: 'longtask' });
    observador.disconnect();
    alvo.addEventListener('load', ouvinte, true);
    alvo.removeEventListener('load', ouvinte, true);

    expect(rastreador.desconectarTudo()).toEqual({ observadores: 0, listeners: 0 });
  });

  it('não conta duas vezes o mesmo listener', () => {
    const { rastreador, alvo } = montar();
    const ouvinte = (): void => undefined;
    alvo.addEventListener('click', ouvinte, { capture: true });
    alvo.addEventListener('click', ouvinte, true);
    expect(rastreador.desconectarTudo().listeners).toBe(1);
  });

  it('remove também o auxiliar dos listeners "once"', () => {
    const { ativos, rastreador, alvo } = montar();
    alvo.addEventListener('keydown', () => undefined, { once: true, capture: true });
    expect(ativos).toHaveLength(2);

    expect(rastreador.desconectarTudo().listeners).toBe(1);
    expect(ativos).toEqual([]);
  });

  it('depois de desconectar, ignora novos observadores e listeners até ser reativado', () => {
    const { fabrica, ativos, escopo, rastreador, alvo } = montar();
    rastreador.desconectarTudo();

    new escopo.PerformanceObserver(() => undefined).observe({ type: 'longtask' });
    alvo.addEventListener('click', () => undefined);
    expect(fabrica.tiposAtivos()).toEqual([]);
    expect(ativos).toEqual([]);

    // Uma nova injeção no mesmo documento reaproveita o rastreador já instalado.
    expect(obterRastreador(escopo)).toBe(rastreador);
    new escopo.PerformanceObserver(() => undefined).observe({ type: 'longtask' });
    expect(fabrica.tiposAtivos()).toEqual(['longtask']);
  });
});
