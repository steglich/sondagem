import { describe, expect, it } from 'vitest';
import { mediana, p75, p95, percentil, resumirValores } from './stats.ts';

describe('stats', () => {
  it('lista vazia: tudo indisponível', () => {
    expect(mediana([])).toBeNull();
    expect(p75([])).toBeNull();
    expect(p95([])).toBeNull();
    expect(resumirValores([])).toEqual({ amostras: 0, mediana: null, p75: null, p95: null });
  });

  it('um elemento: todos os percentis são o próprio elemento', () => {
    expect(resumirValores([42])).toEqual({ amostras: 1, mediana: 42, p75: 42, p95: 42 });
  });

  it('mediana de quantidade ímpar e par', () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 3, 2])).toBe(2.5);
  });

  it('p75 e p95 por interpolação linear', () => {
    const valores = [10, 20, 30, 40, 50];
    expect(p75(valores)).toBe(40);
    expect(p95(valores)).toBeCloseTo(48);
    expect(p75([1, 2])).toBeCloseTo(1.75);
    expect(p95([0, 100])).toBeCloseTo(95);
  });

  it('não depende da ordem nem altera a lista recebida', () => {
    const valores = [50, 10, 40, 20, 30];
    expect(mediana(valores)).toBe(30);
    expect(valores).toEqual([50, 10, 40, 20, 30]);
  });

  it('extremos e valores repetidos', () => {
    expect(percentil([5, 7, 9], 0)).toBe(5);
    expect(percentil([5, 7, 9], 1)).toBe(9);
    expect(p95([8, 8, 8, 8])).toBe(8);
  });

  it('recusa percentil fora de 0 a 1', () => {
    expect(() => percentil([1], 1.5)).toThrow(RangeError);
  });
});
