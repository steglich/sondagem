import { describe, expect, it } from 'vitest';
import { VERIFICACOES, coletoresDaSelecao, normalizarSelecao, selecaoPadrao } from './verificacoes.ts';

describe('registro de verificações', () => {
  it('oferece Processamento e Carregamento, ambas rodando só com a página', () => {
    expect(VERIFICACOES.map((v) => v.nome)).toEqual(['Processamento', 'Carregamento']);
    expect(VERIFICACOES.every((v) => v.exige === 'pagina')).toBe(true);
  });

  it('a seleção padrão marca todas', () => {
    expect(selecaoPadrao()).toEqual(['processamento', 'carregamento']);
  });
});

describe('coletoresDaSelecao', () => {
  it('seleção vazia não coleta nada', () => {
    expect(coletoresDaSelecao([])).toEqual([]);
  });

  it('seleção parcial coleta só o que a verificação marcada exige', () => {
    expect(coletoresDaSelecao(['carregamento'])).toEqual(['metricas-carregamento']);
    expect(coletoresDaSelecao(['processamento'])).toEqual(['long-tasks', 'interacoes', 'inp']);
  });

  it('seleção completa coleta tudo, sem repetição', () => {
    expect(coletoresDaSelecao(['carregamento', 'processamento', 'carregamento'])).toEqual([
      'long-tasks',
      'interacoes',
      'inp',
      'metricas-carregamento',
    ]);
  });
});

describe('normalizarSelecao', () => {
  it('descarta valores desconhecidos, repetições e entradas que não são lista', () => {
    expect(normalizarSelecao(['carregamento', 'memoria', 'carregamento', 3])).toEqual(['carregamento']);
    expect(normalizarSelecao('processamento')).toEqual([]);
    expect(normalizarSelecao(undefined)).toEqual([]);
  });

  it('ordena como o registro', () => {
    expect(normalizarSelecao(['carregamento', 'processamento'])).toEqual(['processamento', 'carregamento']);
  });
});
