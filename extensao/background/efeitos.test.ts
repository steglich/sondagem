import { describe, expect, it } from 'vitest';
import { type Efeito, criarPilhaDeEfeitos } from './efeitos.ts';

function efeito(nome: string, registro: string[], falhas: { aplicar?: boolean; desfazer?: boolean } = {}): Efeito {
  return {
    nome,
    async aplicar() {
      registro.push(`aplicar ${nome}`);
      if (falhas.aplicar) throw new Error(`falha ao aplicar ${nome}`);
    },
    async desfazer() {
      registro.push(`desfazer ${nome}`);
      if (falhas.desfazer) throw new Error(`falha ao desfazer ${nome}`);
    },
  };
}

describe('pilha de efeitos reversíveis', () => {
  it('desfaz na ordem inversa da aplicação e devolve o que desfez', async () => {
    const registro: string[] = [];
    const pilha = criarPilhaDeEfeitos();
    for (const nome of ['cpu', 'rede', 'cache']) await pilha.aplicar(efeito(nome, registro));
    expect(pilha.pendentes).toBe(3);

    expect(await pilha.desfazerTudo()).toEqual(['cache', 'rede', 'cpu']);
    expect(registro).toEqual(['aplicar cpu', 'aplicar rede', 'aplicar cache', 'desfazer cache', 'desfazer rede', 'desfazer cpu']);
    expect(pilha.pendentes).toBe(0);
  });

  it('desfazer de novo não repete nada', async () => {
    const registro: string[] = [];
    const pilha = criarPilhaDeEfeitos();
    await pilha.aplicar(efeito('cpu', registro));
    await pilha.desfazerTudo();
    expect(await pilha.desfazerTudo()).toEqual([]);
    expect(registro.filter((r) => r.startsWith('desfazer'))).toHaveLength(1);
  });

  it('em erro na aplicação, o que já foi aplicado é desfeito na ordem inversa, inclusive o efeito que falhou', async () => {
    const registro: string[] = [];
    const pilha = criarPilhaDeEfeitos();
    await pilha.aplicar(efeito('cpu', registro));
    await expect(pilha.aplicar(efeito('rede', registro, { aplicar: true }))).rejects.toThrow('falha ao aplicar rede');

    // A aplicação pode ter valido no navegador antes de falhar: o desfazer roda mesmo assim.
    expect(await pilha.desfazerTudo()).toEqual(['rede', 'cpu']);
  });

  it('em cancelamento no meio da preparação, o `finally` desfaz o que entrou na pilha', async () => {
    const registro: string[] = [];
    const pilha = criarPilhaDeEfeitos();
    const controle = new AbortController();
    const preparar = async (): Promise<void> => {
      try {
        for (const nome of ['cpu', 'rede', 'cache']) {
          controle.signal.throwIfAborted();
          await pilha.aplicar(efeito(nome, registro));
          if (nome === 'rede') controle.abort(new Error('cancelada'));
        }
      } finally {
        await pilha.desfazerTudo();
      }
    };
    await expect(preparar()).rejects.toThrow('cancelada');
    expect(registro).toEqual(['aplicar cpu', 'aplicar rede', 'desfazer rede', 'desfazer cpu']);
  });

  it('uma falha ao desfazer não impede os outros, e o que falhou fica fora da lista', async () => {
    const registro: string[] = [];
    const pilha = criarPilhaDeEfeitos();
    await pilha.aplicar(efeito('cpu', registro));
    await pilha.aplicar(efeito('rede', registro, { desfazer: true }));
    await pilha.aplicar(efeito('cache', registro));

    expect(await pilha.desfazerTudo()).toEqual(['cache', 'cpu']);
    expect(registro.slice(3)).toEqual(['desfazer cache', 'desfazer rede', 'desfazer cpu']);
  });
});
