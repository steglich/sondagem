import { describe, expect, it } from 'vitest';
import type { PerfilThrottling } from '../shared/condicoes.ts';
import { lerConfiguracao, salvarConfiguracao } from './configuracao.ts';
import { CHAVE_PERFIS, listarPerfis, removerPerfil, salvarPerfil } from './perfis.ts';
import type { Armazenamento } from './selecao.ts';

function armazenamentoFalso(inicial: Record<string, unknown> = {}): Armazenamento & { itens: Record<string, unknown> } {
  const itens = { ...inicial };
  return {
    itens,
    get: async (chave) => ({ [chave]: itens[chave] }),
    set: async (novos) => void Object.assign(itens, structuredClone(novos)),
  };
}

const LENTO: PerfilThrottling = { nome: 'celular-antigo', cpu: 6, rede: { latenciaMs: 300, downloadKbps: 400, uploadKbps: null } };

describe('perfis de throttling salvos', () => {
  it('sem nada salvo, a lista é vazia', async () => {
    expect(await listarPerfis(armazenamentoFalso())).toEqual([]);
  });

  it('salva, lista em ordem alfabética e substitui pelo nome', async () => {
    const armazenamento = armazenamentoFalso();
    await salvarPerfil(armazenamento, LENTO);
    await salvarPerfil(armazenamento, { nome: ' apenas-cpu ', cpu: 2, rede: null });
    expect((await listarPerfis(armazenamento)).map((p) => p.nome)).toEqual(['apenas-cpu', 'celular-antigo']);

    await salvarPerfil(armazenamento, { ...LENTO, cpu: 8 });
    const perfis = await listarPerfis(armazenamento);
    expect(perfis).toHaveLength(2);
    expect(perfis.find((p) => p.nome === 'celular-antigo')).toEqual({ ...LENTO, cpu: 8 });
  });

  it('recusa perfil inválido e nome reservado, sem gravar', async () => {
    const armazenamento = armazenamentoFalso();
    await expect(salvarPerfil(armazenamento, { ...LENTO, cpu: 0 })).rejects.toThrow(/CPU/);
    await expect(salvarPerfil(armazenamento, { ...LENTO, nome: 'padrao' })).rejects.toThrow(/reservado/);
    expect(armazenamento.itens[CHAVE_PERFIS]).toBeUndefined();
  });

  it('remove pelo nome', async () => {
    const armazenamento = armazenamentoFalso();
    await salvarPerfil(armazenamento, LENTO);
    await removerPerfil(armazenamento, 'celular-antigo');
    expect(await listarPerfis(armazenamento)).toEqual([]);
  });

  it('o que está guardado e não é mais válido fica de fora', async () => {
    const armazenamento = armazenamentoFalso({ [CHAVE_PERFIS]: [LENTO, { nome: 'quebrado' }, 'texto', { nome: 'padrao', cpu: 9, rede: null }] });
    expect(await listarPerfis(armazenamento)).toEqual([LENTO]);
  });
});

describe('configuração de armazenamento salva', () => {
  it('sem nada salvo valem os padrões, e o que é salvo volta igual', async () => {
    const armazenamento = armazenamentoFalso();
    expect(await lerConfiguracao(armazenamento)).toMatchObject({ limiteExecucaoMb: 20, limiteHistoricoMb: 500, retencao: { maximoPorCenario: 50 } });

    const nova = { limiteExecucaoMb: 5, limiteHistoricoMb: 100, retencao: { maximoPorCenario: 10, idadeMaximaDias: 30 }, limiteVariacao: 15 };
    await salvarConfiguracao(armazenamento, nova);
    expect(await lerConfiguracao(armazenamento)).toEqual(nova);
  });
});
