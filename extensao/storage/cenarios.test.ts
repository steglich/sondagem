import { describe, expect, it } from 'vitest';
import type { Cenario } from '../shared/cenario.ts';
import {
  CHAVE_CENARIOS,
  lerCenarioSelecionado,
  listarCenarios,
  removerCenario,
  salvarCenario,
  selecionarCenario,
} from './cenarios.ts';
import type { Armazenamento } from './selecao.ts';

function armazenamentoEmMemoria(inicial: Record<string, unknown> = {}) {
  const dados: Record<string, unknown> = { ...inicial };
  const armazenamento: Armazenamento = {
    get: async (chave) => (chave in dados ? { [chave]: structuredClone(dados[chave]) } : {}),
    set: async (itens) => void Object.assign(dados, structuredClone(itens)),
  };
  return { armazenamento, dados };
}

const cenario = (nome: string, iteracoes = 5): Cenario => ({
  versao_esquema: 1,
  nome,
  url_inicial: 'http://localhost:4300/limpa',
  execucao: { iteracoes },
  passos: [{ tipo: 'esperar', ms: 10 }],
});

describe('cenários salvos', () => {
  it('começa vazio', async () => {
    const { armazenamento } = armazenamentoEmMemoria();
    expect(await listarCenarios(armazenamento)).toEqual([]);
    expect(await lerCenarioSelecionado(armazenamento)).toBeNull();
  });

  it('salva, lista em ordem alfabética e substitui pelo nome', async () => {
    const { armazenamento } = armazenamentoEmMemoria();
    await salvarCenario(armazenamento, cenario('modal'));
    await salvarCenario(armazenamento, cenario('busca'));
    await salvarCenario(armazenamento, cenario('modal', 20));

    const lista = await listarCenarios(armazenamento);
    expect(lista.map((c) => [c.nome, c.execucao?.iteracoes])).toEqual([
      ['busca', 5],
      ['modal', 20],
    ]);
  });

  it('seleciona um cenário e esquece a seleção quando ele é removido', async () => {
    const { armazenamento } = armazenamentoEmMemoria();
    await salvarCenario(armazenamento, cenario('modal'));
    await salvarCenario(armazenamento, cenario('busca'));
    await selecionarCenario(armazenamento, 'modal');
    expect(await lerCenarioSelecionado(armazenamento)).toBe('modal');

    await removerCenario(armazenamento, 'busca');
    expect(await lerCenarioSelecionado(armazenamento)).toBe('modal');

    await removerCenario(armazenamento, 'modal');
    expect(await listarCenarios(armazenamento)).toEqual([]);
    expect(await lerCenarioSelecionado(armazenamento)).toBeNull();
  });

  it('seleção de um nome que não existe não vale', async () => {
    const { armazenamento } = armazenamentoEmMemoria();
    await selecionarCenario(armazenamento, 'fantasma');
    expect(await lerCenarioSelecionado(armazenamento)).toBeNull();
  });

  it('ignora dados guardados que não são cenários válidos', async () => {
    const { armazenamento } = armazenamentoEmMemoria({
      [CHAVE_CENARIOS]: { bom: cenario('bom'), ruim: { nome: 'ruim' }, trocado: cenario('outro-nome') },
    });
    expect((await listarCenarios(armazenamento)).map((c) => c.nome)).toEqual(['bom']);
  });
});
