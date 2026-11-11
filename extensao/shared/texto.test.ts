import { describe, expect, it } from 'vitest';
import { formatarBytes, formatarMs, formatarVariacaoBytes } from './texto.ts';

describe('formatarMs', () => {
  it('formata com uma casa decimal e unidade', () => {
    expect(formatarMs(12)).toBe('12.0 ms');
    expect(formatarMs(250.46)).toBe('250.5 ms');
  });
});

describe('formatarBytes', () => {
  it('escolhe a unidade pelo tamanho', () => {
    expect(formatarBytes(0)).toBe('0 B');
    expect(formatarBytes(1000)).toBe('1000 B');
    expect(formatarBytes(1536)).toBe('1.5 KB');
    expect(formatarBytes(50 * 1024)).toBe('50.0 KB');
    expect(formatarBytes(3 * 1024 * 1024 + 512 * 1024)).toBe('3.50 MB');
    expect(formatarBytes(1024 * 1024 * 1024)).toBe('1024.00 MB');
  });

  it('variações levam o sinal', () => {
    expect(formatarVariacaoBytes(2048)).toBe('+2.0 KB');
    expect(formatarVariacaoBytes(-2048)).toBe('-2.0 KB');
    expect(formatarVariacaoBytes(0)).toBe('0 B');
  });
});
