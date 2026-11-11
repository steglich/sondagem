import { describe, expect, it } from 'vitest';
import { formatarMs } from './texto.ts';

describe('formatarMs', () => {
  it('formata com uma casa decimal e unidade', () => {
    expect(formatarMs(12)).toBe('12.0 ms');
    expect(formatarMs(250.46)).toBe('250.5 ms');
  });
});
