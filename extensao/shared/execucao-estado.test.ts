import { describe, expect, it } from 'vitest';
import { ESTADOS_FINAIS, TRANSICOES, TransicaoInvalida, podeTransitar, transitar } from './execucao-estado.ts';
import type { EstadoExecucao } from './types.ts';

const ESTADOS = Object.keys(TRANSICOES) as EstadoExecucao[];

describe('máquina de estados da execução', () => {
  it('tem os oito estados da spec', () => {
    expect(ESTADOS.sort()).toEqual(
      ['aquecendo', 'cancelada', 'coletando', 'concluida', 'erro', 'executando', 'ociosa', 'preparando'].sort(),
    );
  });

  it('caminho completo com aquecimento e duas iterações', () => {
    const caminho: EstadoExecucao[] = [
      'preparando',
      'aquecendo',
      'executando',
      'coletando',
      'executando',
      'coletando',
      'concluida',
      'ociosa',
    ];
    let estado: EstadoExecucao = 'ociosa';
    for (const proximo of caminho) estado = transitar(estado, proximo);
    expect(estado).toBe('ociosa');
  });

  it('sem aquecimento, vai de preparando direto para executando', () => {
    expect(podeTransitar('preparando', 'executando')).toBe(true);
  });

  it.each(['preparando', 'aquecendo', 'executando', 'coletando'] as const)(
    '%s pode terminar em erro ou cancelada',
    (estado) => {
      expect(podeTransitar(estado, 'erro')).toBe(true);
      expect(podeTransitar(estado, 'cancelada')).toBe(true);
    },
  );

  it.each([
    ['ociosa', 'executando'],
    ['ociosa', 'concluida'],
    ['preparando', 'coletando'],
    ['preparando', 'concluida'],
    ['aquecendo', 'coletando'],
    ['aquecendo', 'aquecendo'],
    ['executando', 'concluida'],
    ['executando', 'aquecendo'],
    ['coletando', 'aquecendo'],
    ['concluida', 'executando'],
    ['erro', 'concluida'],
    ['cancelada', 'preparando'],
  ] as const)('recusa %s → %s', (de, para) => {
    expect(podeTransitar(de, para)).toBe(false);
    expect(() => transitar(de, para)).toThrow(TransicaoInvalida);
  });

  it('estados finais só voltam a ociosa', () => {
    for (const final of ESTADOS_FINAIS) expect(TRANSICOES[final]).toEqual(['ociosa']);
  });

  it('todo destino da tabela é um estado conhecido', () => {
    for (const destinos of Object.values(TRANSICOES)) for (const d of destinos) expect(ESTADOS).toContain(d);
  });
});
