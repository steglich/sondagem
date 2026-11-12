import { describe, expect, it } from 'vitest';
import { execucaoDeTeste } from '../shared/apoio-registro.ts';
import { idsARemover } from '../shared/historico.ts';
import { CHAVE_LINHAS_DE_BASE, definirLinhaDeBase, idsDeReferencia, lerLinhaDeBase, lerLinhasDeBase, removerLinhaDeBase } from './linha-de-base.ts';
import type { Armazenamento } from './selecao.ts';

function armazenamentoFalso(inicial: Record<string, unknown> = {}): Armazenamento & { itens: Record<string, unknown> } {
  const itens = { ...inicial };
  return {
    itens,
    get: async (chave) => ({ [chave]: itens[chave] }),
    set: async (novos) => void Object.assign(itens, structuredClone(novos)),
  };
}

describe('linha de base por cenário', () => {
  it('sem nada salvo, o cenário não tem linha de base', async () => {
    const armazenamento = armazenamentoFalso();
    expect(await lerLinhaDeBase(armazenamento, 'abrir-fechar')).toBeNull();
    expect(await idsDeReferencia(armazenamento)).toEqual([]);
  });

  it('marca, troca e desmarca, por cenário', async () => {
    const armazenamento = armazenamentoFalso();
    await definirLinhaDeBase(armazenamento, 'abrir-fechar', { id: 'exec-1', limites: {} });
    await definirLinhaDeBase(armazenamento, 'checkout', { id: 'exec-9', limites: { 'pior-interacao': 20 } });
    expect(await lerLinhaDeBase(armazenamento, 'abrir-fechar')).toEqual({ id: 'exec-1', limites: {} });
    expect(await lerLinhaDeBase(armazenamento, 'checkout')).toEqual({ id: 'exec-9', limites: { 'pior-interacao': 20 } });
    expect((await idsDeReferencia(armazenamento)).sort()).toEqual(['exec-1', 'exec-9']);

    await definirLinhaDeBase(armazenamento, 'abrir-fechar', { id: 'exec-2', limites: { 'duracao-iteracao': 5 } });
    expect(await lerLinhaDeBase(armazenamento, 'abrir-fechar')).toEqual({ id: 'exec-2', limites: { 'duracao-iteracao': 5 } });

    await removerLinhaDeBase(armazenamento, 'abrir-fechar');
    expect(await lerLinhaDeBase(armazenamento, 'abrir-fechar')).toBeNull();
    expect(Object.keys(await lerLinhasDeBase(armazenamento))).toEqual(['checkout']);
    await expect(removerLinhaDeBase(armazenamento, 'nao-existe')).resolves.toBeUndefined();
  });

  it('fica em uma chave própria do `chrome.storage.local`, com os limites por métrica', async () => {
    const armazenamento = armazenamentoFalso();
    await definirLinhaDeBase(armazenamento, 'abrir-fechar', { id: 'exec-1', limites: { 'tempo-long-tasks': 30 } });
    expect(armazenamento.itens).toEqual({ [CHAVE_LINHAS_DE_BASE]: { 'abrir-fechar': { id: 'exec-1', limites: { 'tempo-long-tasks': 30 } } } });
  });

  it('ignora o que foi salvo com formato inválido e recusa marcar sem execução', async () => {
    const armazenamento = armazenamentoFalso({ [CHAVE_LINHAS_DE_BASE]: { quebrado: { limites: {} }, bom: { id: 'x', limites: { 'pior-interacao': 'muito' } } } });
    expect(await lerLinhasDeBase(armazenamento)).toEqual({ bom: { id: 'x', limites: {} } });
    await expect(definirLinhaDeBase(armazenamento, 'a', { id: '', limites: {} })).rejects.toThrow(/execução de referência/);
    // Um cenário chamado como uma propriedade de Object não é confundido com ela.
    expect(await lerLinhaDeBase(armazenamento, 'constructor')).toBeNull();
  });

  it('a retenção nunca remove a execução de referência, nem por quantidade nem por idade', async () => {
    const armazenamento = armazenamentoFalso();
    const registros = [1, 2, 3, 4].map((n) => execucaoDeTeste(`exec-${n}`, {}, { inicio: n * 1000 }));
    const retencao = { maximoPorCenario: 2, idadeMaximaDias: null };
    expect(idsARemover(registros, retencao, 0).sort()).toEqual(['exec-1', 'exec-2']);

    await definirLinhaDeBase(armazenamento, 'abrir-fechar', { id: 'exec-1', limites: {} });
    const protegidos = await idsDeReferencia(armazenamento);
    // A referência fica e não ocupa vaga: continuam as duas mais recentes.
    expect(idsARemover(registros, retencao, 0, protegidos)).toEqual(['exec-2']);
    const DIA = 24 * 60 * 60 * 1000;
    expect(idsARemover(registros, { maximoPorCenario: null, idadeMaximaDias: 1 }, 10 * DIA, protegidos).sort()).toEqual(['exec-2', 'exec-3', 'exec-4']);
  });
});
