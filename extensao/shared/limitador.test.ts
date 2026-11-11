import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarLimitador } from './limitador.ts';

describe('criarLimitador', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('executa o primeiro pedido na hora e funde os seguintes em um por intervalo', () => {
    const acao = vi.fn();
    const limitador = criarLimitador(1000, acao);

    for (let i = 0; i < 50; i++) limitador.solicitar();
    expect(acao).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(999);
    expect(acao).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(acao).toHaveBeenCalledTimes(2);
  });

  it('nunca passa de uma execução por segundo sob pedidos contínuos', () => {
    const acao = vi.fn();
    const limitador = criarLimitador(1000, acao);

    // Um pedido a cada 20 ms durante 5 segundos.
    for (let t = 0; t < 5000; t += 20) {
      limitador.solicitar();
      vi.advanceTimersByTime(20);
    }
    expect(acao.mock.calls.length).toBeLessThanOrEqual(6);
    expect(acao.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('não agenda nada sem pedido novo', () => {
    const acao = vi.fn();
    const limitador = criarLimitador(1000, acao);
    limitador.solicitar();
    vi.advanceTimersByTime(10_000);
    expect(acao).toHaveBeenCalledTimes(1);
  });

  it('cancelar descarta a execução agendada e informa se havia uma', () => {
    const acao = vi.fn();
    const limitador = criarLimitador(1000, acao);
    expect(limitador.cancelar()).toBe(false);

    limitador.solicitar();
    limitador.solicitar();
    expect(limitador.cancelar()).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(acao).toHaveBeenCalledTimes(1);
  });

  it('imediato executa já e reinicia o intervalo', () => {
    const acao = vi.fn();
    const limitador = criarLimitador(1000, acao);
    limitador.solicitar();
    limitador.solicitar();
    limitador.imediato();
    expect(acao).toHaveBeenCalledTimes(2);

    limitador.solicitar();
    vi.advanceTimersByTime(999);
    expect(acao).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(acao).toHaveBeenCalledTimes(3);
  });
});
