import { describe, expect, it } from 'vitest';
import {
  VERIFICACOES,
  coletoresDaSelecao,
  normalizarSelecao,
  selecaoPadrao,
  verificacoesComDebugger,
} from './verificacoes.ts';

describe('registro de verificações', () => {
  it('oferece Processamento, Carregamento, Erros da página, Memória, DOM e listeners e CPU', () => {
    expect(VERIFICACOES.map((v) => v.nome)).toEqual(['Processamento', 'Carregamento', 'Erros da página', 'Memória', 'DOM e listeners', 'CPU']);
  });

  it('marca quais verificações exigem o debugger', () => {
    expect(Object.fromEntries(VERIFICACOES.map((v) => [v.id, v.exige]))).toEqual({
      processamento: 'pagina',
      carregamento: 'pagina',
      'erros-pagina': 'debugger',
      memoria: 'debugger',
      'dom-listeners': 'debugger',
      cpu: 'debugger',
    });
    expect(verificacoesComDebugger(['memoria', 'dom-listeners']).map((v) => v.nome)).toEqual(['Memória', 'DOM e listeners']);
    expect(verificacoesComDebugger(['carregamento', 'erros-pagina']).map((v) => v.nome)).toEqual(['Erros da página']);
    expect(verificacoesComDebugger(['carregamento', 'processamento'])).toEqual([]);
  });

  it('a seleção padrão da sessão manual deixa de fora o que exige o debugger; a de cenário marca tudo', () => {
    expect(selecaoPadrao()).toEqual(['processamento', 'carregamento']);
    expect(selecaoPadrao(true)).toEqual(['processamento', 'carregamento', 'erros-pagina', 'memoria', 'dom-listeners', 'cpu']);
  });

  it('"Erros da página" não instala nada na página', () => {
    expect(coletoresDaSelecao(['erros-pagina'])).toEqual([]);
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
    expect(normalizarSelecao(['carregamento', 'rede', 'carregamento', 3])).toEqual(['carregamento']);
    expect(normalizarSelecao('processamento')).toEqual([]);
    expect(normalizarSelecao(undefined)).toEqual([]);
  });

  it('ordena como o registro', () => {
    expect(normalizarSelecao(['carregamento', 'processamento'])).toEqual(['processamento', 'carregamento']);
  });
});
