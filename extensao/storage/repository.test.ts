// `auto` põe no global as classes do IndexedDB (IDBRequest, IDBKeyRange...), que o `idb` usa.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { dadosVazios } from '../shared/agregacao.ts';
import type { RegistroExecucao } from '../shared/historico.ts';
import type { DadosColetados } from '../shared/types.ts';
import { NOME_DO_BANCO, type RepositorioResultados, criarRepositorio } from './repository.ts';

function registro(parcial: Partial<RegistroExecucao> & { id: string }): RegistroExecucao {
  return {
    tipo: 'cenario',
    estado: 'concluida',
    grupo: 'cenario:abrir-fechar',
    nomeCenario: 'abrir-fechar',
    url: 'http://localhost:4300/limpa',
    inicio: 1000,
    fim: 2000,
    selecao: ['processamento'],
    versaoBuild: null,
    navegador: null,
    ambiente: null,
    condicoes: { perfil: 'nenhum', cpu: 1, rede: null, cacheDesligado: true, cacheLimpo: true, storageLimpo: [] },
    chaveCondicoes: 'cpu=1',
    extensoes: [],
    definicao: null,
    configuracao: null,
    andamento: null,
    resumo: null,
    tamanho: 100,
    truncado: [],
    ...parcial,
  };
}

function dados(longTasks = 0): DadosColetados {
  return { ...dadosVazios(), longTasks: Array.from({ length: longTasks }, (_, i) => ({ inicio: i, duracao: 60 })) };
}

let repositorio: RepositorioResultados;

beforeEach(() => {
  // Um banco novo por teste.
  globalThis.indexedDB = new IDBFactory();
  repositorio = criarRepositorio();
});

describe('repositório de resultados', () => {
  it('cria o banco "sondagem" com os stores `execucoes` e `detalhes` e os índices por cenário e por data', async () => {
    await repositorio.listar();
    const banco = await new Promise<IDBDatabase>((resolver, rejeitar) => {
      const pedido = indexedDB.open(NOME_DO_BANCO);
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => rejeitar(pedido.error);
    });
    expect([...banco.objectStoreNames].sort()).toEqual(['detalhes', 'execucoes']);
    const execucoes = banco.transaction('execucoes').objectStore('execucoes');
    expect(execucoes.keyPath).toBe('id');
    expect([...execucoes.indexNames].sort()).toEqual(['grupo', 'inicio']);
    expect(banco.transaction('detalhes').objectStore('detalhes').indexNames).toHaveLength(0);
    banco.close();
  });

  it('grava e lê o registro com os detalhes', async () => {
    await repositorio.gravar(registro({ id: 'a' }), dados(3));
    const lida = await repositorio.ler('a');
    expect(lida?.registro).toMatchObject({ id: 'a', estado: 'concluida' });
    expect(lida?.dados.longTasks).toHaveLength(3);
    expect(await repositorio.ler('nao-existe')).toBeNull();
  });

  it('gravar de novo com o mesmo id substitui (em andamento → terminada)', async () => {
    await repositorio.gravar(registro({ id: 'a', estado: 'em-andamento', fim: null }), dados(1));
    expect((await repositorio.emAndamento()).map((r) => r.id)).toEqual(['a']);

    await repositorio.gravar(registro({ id: 'a', estado: 'concluida' }), dados(5));
    expect(await repositorio.listar()).toHaveLength(1);
    expect(await repositorio.emAndamento()).toEqual([]);
    expect((await repositorio.ler('a'))?.dados.longTasks).toHaveLength(5);
  });

  it('o que é gravado é uma cópia: mudar o objeto depois não muda o que está guardado', async () => {
    const detalhes = dados(1);
    await repositorio.gravar(registro({ id: 'a' }), detalhes);
    detalhes.longTasks.push({ inicio: 9, duracao: 999 });
    expect((await repositorio.ler('a'))?.dados.longTasks).toHaveLength(1);
  });

  it('lista por data, da mais recente para a mais antiga, sem os detalhes', async () => {
    await repositorio.gravar(registro({ id: 'antiga', inicio: 100 }), dados(50));
    await repositorio.gravar(registro({ id: 'recente', inicio: 300 }), dados(50));
    await repositorio.gravar(registro({ id: 'meio', inicio: 200 }), dados(50));

    const lista = await repositorio.listar();
    expect(lista.map((r) => r.id)).toEqual(['recente', 'meio', 'antiga']);
    expect(lista.every((r) => !('dados' in r))).toBe(true);
  });

  it('lista por cenário pelo índice `grupo`', async () => {
    await repositorio.gravar(registro({ id: 'a1', inicio: 1 }), dados());
    await repositorio.gravar(registro({ id: 'b1', inicio: 2, grupo: 'cenario:outro', nomeCenario: 'outro' }), dados());
    await repositorio.gravar(registro({ id: 'a2', inicio: 3 }), dados());
    await repositorio.gravar(registro({ id: 'm1', inicio: 4, grupo: 'manual', nomeCenario: null, tipo: 'sessao-manual' }), dados());

    expect((await repositorio.listar({ grupo: 'cenario:abrir-fechar' })).map((r) => r.id)).toEqual(['a2', 'a1']);
    expect((await repositorio.listar({ grupo: 'manual' })).map((r) => r.id)).toEqual(['m1']);
    expect(await repositorio.listar({ grupo: 'cenario:nenhum' })).toEqual([]);
  });

  it('remove uma execução dos dois stores', async () => {
    await repositorio.gravar(registro({ id: 'a' }), dados(2));
    await repositorio.gravar(registro({ id: 'b' }), dados(2));
    await repositorio.remover('a');
    expect((await repositorio.listar()).map((r) => r.id)).toEqual(['b']);
    expect(await repositorio.ler('a')).toBeNull();
    await expect(repositorio.remover('nao-existe')).resolves.toBeUndefined();
  });

  it('soma o tamanho estimado de todas as execuções', async () => {
    expect(await repositorio.tamanhoTotal()).toBe(0);
    await repositorio.gravar(registro({ id: 'a', tamanho: 1500 }), dados());
    await repositorio.gravar(registro({ id: 'b', tamanho: 500 }), dados());
    expect(await repositorio.tamanhoTotal()).toBe(2000);
  });

  it('retenção de 50 por cenário: ao salvar a 51ª, a mais antiga daquele cenário é removida', async () => {
    for (let i = 1; i <= 51; i++) await repositorio.gravar(registro({ id: `a-${i}`, inicio: i }), dados());
    await repositorio.gravar(registro({ id: 'b-1', inicio: 0, grupo: 'cenario:outro', nomeCenario: 'outro' }), dados());

    expect(await repositorio.aplicarRetencao({ maximoPorCenario: 50, idadeMaximaDias: null }, 1000)).toEqual(['a-1']);
    const restantes = (await repositorio.listar()).map((r) => r.id);
    expect(restantes).toHaveLength(51);
    expect(restantes).not.toContain('a-1');
    expect(restantes).toContain('b-1');
    expect(await repositorio.ler('a-1')).toBeNull();
  });

  it('os dados continuam lá para outra instância do repositório (reinício do navegador)', async () => {
    await repositorio.gravar(registro({ id: 'a' }), dados(4));
    const depoisDoReinicio = criarRepositorio();
    expect((await depoisDoReinicio.listar()).map((r) => r.id)).toEqual(['a']);
    expect((await depoisDoReinicio.ler('a'))?.dados.longTasks).toHaveLength(4);
  });
});
