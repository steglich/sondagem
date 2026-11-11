import { describe, expect, it } from 'vitest';
import { type Armazenamento, CHAVE_SELECOES, lerSelecao, salvarSelecao } from './selecao.ts';

function armazenamentoEmMemoria(inicial: Record<string, unknown> = {}) {
  const dados: Record<string, unknown> = { ...inicial };
  const armazenamento: Armazenamento = {
    get: async (chave) => (chave in dados ? { [chave]: structuredClone(dados[chave]) } : {}),
    set: async (itens) => void Object.assign(dados, structuredClone(itens)),
  };
  return { armazenamento, dados };
}

describe('memória da seleção', () => {
  it('sem nada salvo, devolve todas as verificações marcadas', async () => {
    const { armazenamento } = armazenamentoEmMemoria();
    expect(await lerSelecao(armazenamento, 'manual')).toEqual(['processamento', 'carregamento']);
  });

  it('a seleção salva volta na próxima leitura do mesmo contexto', async () => {
    const { armazenamento } = armazenamentoEmMemoria();
    await salvarSelecao(armazenamento, 'manual', ['carregamento']);
    expect(await lerSelecao(armazenamento, 'manual')).toEqual(['carregamento']);
  });

  it('cada contexto tem a sua seleção', async () => {
    const { armazenamento } = armazenamentoEmMemoria();
    await salvarSelecao(armazenamento, 'manual', ['carregamento']);
    await salvarSelecao(armazenamento, 'cenario-login', ['processamento']);

    expect(await lerSelecao(armazenamento, 'manual')).toEqual(['carregamento']);
    expect(await lerSelecao(armazenamento, 'cenario-login')).toEqual(['processamento']);
    expect(await lerSelecao(armazenamento, 'cenario-novo')).toEqual(['processamento', 'carregamento']);
  });

  it('guarda apenas a seleção', async () => {
    const { armazenamento, dados } = armazenamentoEmMemoria();
    await salvarSelecao(armazenamento, 'manual', ['carregamento']);
    expect(dados).toEqual({ [CHAVE_SELECOES]: { manual: ['carregamento'] } });
  });

  it('ignora dados inválidos e verificações que deixaram de existir', async () => {
    const { armazenamento } = armazenamentoEmMemoria({
      [CHAVE_SELECOES]: { manual: 'tudo', antigo: ['memoria-v0', 'carregamento'] },
    });
    expect(await lerSelecao(armazenamento, 'manual')).toEqual(['processamento', 'carregamento']);
    expect(await lerSelecao(armazenamento, 'antigo')).toEqual(['carregamento']);
  });
});
