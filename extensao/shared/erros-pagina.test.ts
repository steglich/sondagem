import { describe, expect, it } from 'vitest';
import { type Marcacao, aplicarErroPagina, dadosVazios, resumir } from './agregacao.ts';
import { erroDaPagina } from './erros-pagina.ts';

/** Eventos como o Chrome 158 os envia em `Runtime.exceptionThrown`. */
const EXCECAO = {
  timestamp: 1_700_000_000_000,
  exceptionDetails: {
    exceptionId: 1,
    text: 'Uncaught',
    lineNumber: 11,
    columnNumber: 8,
    url: 'http://localhost:4300/erros.ts',
    stackTrace: { callFrames: [{ functionName: 'lancar', url: 'http://localhost:4300/erros.ts', lineNumber: 11, columnNumber: 8 }] },
    exception: { type: 'object', className: 'Error', description: 'Error: falha de propósito\n    at lancar (http://localhost:4300/erros.ts:12:9)' },
  },
};
const REJEICAO = {
  timestamp: 1_700_000_000_500,
  exceptionDetails: {
    exceptionId: 2,
    text: 'Uncaught (in promise)',
    lineNumber: 0,
    columnNumber: 0,
    exception: { type: 'string', value: 'pedido recusado' },
    stackTrace: { callFrames: [{ functionName: 'rejeitar', url: 'http://localhost:4300/erros.ts', lineNumber: 16, columnNumber: 2 }] },
  },
};

describe('erroDaPagina', () => {
  it('exceção não tratada: mensagem, arquivo, linha e instante', () => {
    expect(erroDaPagina(EXCECAO, 5000)).toEqual({
      tipo: 'excecao',
      mensagem: 'Error: falha de propósito',
      arquivo: 'http://localhost:4300/erros.ts',
      linha: 12,
      coluna: 9,
      instante: 5000,
    });
  });

  it('promise rejeitada sem tratamento: o motivo vira a mensagem', () => {
    expect(erroDaPagina(REJEICAO, 6000)).toMatchObject({
      tipo: 'rejeicao',
      mensagem: 'pedido recusado',
      arquivo: 'http://localhost:4300/erros.ts',
      linha: 1,
    });
  });

  it('evento sem detalhes não quebra a coleta', () => {
    expect(erroDaPagina({}, 1)).toEqual({ tipo: 'excecao', mensagem: 'Erro sem mensagem', arquivo: null, linha: null, coluna: null, instante: 1 });
    expect(erroDaPagina(null, 1).mensagem).toBe('Erro sem mensagem');
  });
});

describe('erros associados à iteração', () => {
  const marcacao: Marcacao = {
    aquecimento: { inicio: 1000, fim: 2000 },
    iteracoes: [
      { numero: 4, inicio: 5000, fim: 6000 },
      { numero: 5, inicio: 6000, fim: null },
    ],
  };

  it('o erro recebe a iteração em que ocorreu', () => {
    const dados = dadosVazios();
    aplicarErroPagina(dados, erroDaPagina(EXCECAO, 6500), marcacao);
    aplicarErroPagina(dados, erroDaPagina(REJEICAO, 5999), marcacao);
    aplicarErroPagina(dados, erroDaPagina(EXCECAO, 3000), marcacao);

    expect(dados.errosPagina.map((e) => [e.tipo, e.iteracao])).toEqual([
      ['excecao', 5],
      ['rejeicao', 4],
      ['excecao', null],
    ]);
    expect(resumir(dados).errosPagina).toBe(3);
  });

  it('erro durante o aquecimento não entra no resultado', () => {
    const dados = aplicarErroPagina(dadosVazios(), erroDaPagina(EXCECAO, 1500), marcacao);
    expect(dados.errosPagina).toEqual([]);
  });

  it('em sessão manual o erro fica sem iteração', () => {
    const dados = aplicarErroPagina(dadosVazios(), erroDaPagina(EXCECAO, 1500));
    expect(dados.errosPagina).toHaveLength(1);
    expect(dados.errosPagina[0]).not.toHaveProperty('iteracao');
  });
});
