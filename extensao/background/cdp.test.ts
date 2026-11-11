import { describe, expect, it } from 'vitest';
import { criarTransporteFalso } from './apoio-teste.ts';
import { ConexaoPerdida, FalhaAnexacao, classificarFalhaAnexacao, criarConexaoCdp } from './cdp.ts';

describe('conexão de CDP', () => {
  it('anexa com o protocolo 1.3, envia comandos e entrega os eventos da aba', async () => {
    const transporte = criarTransporteFalso();
    transporte.responder = (metodo) => (metodo === 'Runtime.evaluate' ? { result: { value: 2 } } : {});
    const conexao = criarConexaoCdp(transporte);

    await conexao.anexar(5);
    expect(conexao.anexada).toBe(true);
    expect([...transporte.anexadas]).toEqual([5]);

    const resposta = await conexao.enviar<{ result: { value: number } }>('Runtime.evaluate', { expression: '1+1' });
    expect(resposta.result.value).toBe(2);
    expect(transporte.comandos).toEqual([{ idAba: 5, metodo: 'Runtime.evaluate', parametros: { expression: '1+1' } }]);

    const recebidos: unknown[] = [];
    const cancelar = conexao.aoEvento('Page.loadEventFired', (p) => recebidos.push(p));
    transporte.emitir(5, 'Page.loadEventFired', { timestamp: 1 });
    transporte.emitir(9, 'Page.loadEventFired', { timestamp: 2 }); // outra aba
    transporte.emitir(5, 'Network.requestWillBeSent', {}); // outro evento
    expect(recebidos).toEqual([{ timestamp: 1 }]);

    cancelar();
    transporte.emitir(5, 'Page.loadEventFired', { timestamp: 3 });
    expect(recebidos).toHaveLength(1);
  });

  it('desanexar é idempotente e solta todos os ouvintes', async () => {
    const transporte = criarTransporteFalso();
    const conexao = criarConexaoCdp(transporte);
    await conexao.anexar(5);
    conexao.aoEvento('Page.loadEventFired', () => undefined);
    expect(transporte.ouvintesAtivos()).toBe(2);

    expect(await conexao.desanexar()).toBe(true);
    expect(await conexao.desanexar()).toBe(false);
    expect(await conexao.desanexar()).toBe(false);

    expect(transporte.chamadas.desanexar).toBe(1);
    expect(transporte.anexadas.size).toBe(0);
    expect(transporte.ouvintesAtivos()).toBe(0);
    expect(conexao.anexada).toBe(false);
  });

  it('desanexar sem ter anexado não chama o navegador', async () => {
    const transporte = criarTransporteFalso();
    expect(await criarConexaoCdp(transporte).desanexar()).toBe(false);
    expect(transporte.chamadas.desanexar).toBe(0);
  });

  it('desanexar não falha se a aba já fechou', async () => {
    const transporte = criarTransporteFalso();
    const conexao = criarConexaoCdp(transporte);
    await conexao.anexar(5);
    transporte.anexadas.delete(5); // o navegador já desfez

    await expect(conexao.desanexar()).resolves.toBe(false);
  });

  it('enviar depois de desanexar rejeita com ConexaoPerdida', async () => {
    const conexao = criarConexaoCdp(criarTransporteFalso());
    await conexao.anexar(5);
    await conexao.desanexar();
    await expect(conexao.enviar('Page.enable')).rejects.toBeInstanceOf(ConexaoPerdida);
  });

  describe('falhas de anexação', () => {
    it('aba que já tem um depurador: não anexa nem age sobre o outro depurador', async () => {
      const transporte = criarTransporteFalso();
      transporte.depuradasPorOutro.add(5);
      const conexao = criarConexaoCdp(transporte);

      const erro = await conexao.anexar(5).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(FalhaAnexacao);
      expect((erro as FalhaAnexacao).categoria).toBe('outro-depurador');
      expect(transporte.chamadas).toEqual({ anexar: 0, desanexar: 0 });
      expect(transporte.comandos).toEqual([]);
      expect(conexao.anexada).toBe(false);
    });

    it.each([
      ['Another debugger is already attached to the tab with id: 5.', 'outro-depurador'],
      ['Cannot access a chrome:// URL', 'alvo-nao-depuravel'],
      ['Cannot access a chrome-extension:// URL of different extension', 'alvo-nao-depuravel'],
      ['The extensions gallery cannot be scripted.', 'alvo-nao-depuravel'],
      ['No tab with given id 5.', 'alvo-nao-depuravel'],
      ['Algo que o Chrome nunca disse antes', 'desconhecido'],
    ] as const)('"%s" → %s, com a mensagem original preservada', async (mensagem, categoria) => {
      expect(classificarFalhaAnexacao(mensagem)).toBe(categoria);

      const transporte = criarTransporteFalso();
      transporte.erroAoAnexar = mensagem;
      const conexao = criarConexaoCdp(transporte);
      const erro = (await conexao.anexar(5).catch((e: unknown) => e)) as FalhaAnexacao;

      expect(erro).toBeInstanceOf(FalhaAnexacao);
      expect(erro.categoria).toBe(categoria);
      expect(erro.original).toBe(mensagem);
      expect(conexao.anexada).toBe(false);
      expect(transporte.ouvintesAtivos()).toBe(0);
    });

    it('se a consulta prévia falhar, a anexação decide', async () => {
      const transporte = criarTransporteFalso();
      transporte.alvoJaDepurado = async () => {
        throw new Error('getTargets indisponível');
      };
      const conexao = criarConexaoCdp(transporte);
      await conexao.anexar(5);
      expect(conexao.anexada).toBe(true);
    });
  });

  describe('conexão perdida', () => {
    it.each(['canceled_by_user', 'target_closed', 'replaced_with_devtools'])(
      'desanexação externa (%s) avisa com o motivo e encerra a conexão',
      async (motivo) => {
        const transporte = criarTransporteFalso();
        const conexao = criarConexaoCdp(transporte);
        await conexao.anexar(5);
        const motivos: string[] = [];
        conexao.aoPerder((m) => motivos.push(m));

        transporte.derrubar(5, motivo);

        expect(motivos).toEqual([motivo]);
        expect(conexao.anexada).toBe(false);
        expect(transporte.ouvintesAtivos()).toBe(0);
        await expect(conexao.enviar('Page.enable')).rejects.toMatchObject({ name: 'ConexaoPerdida', motivo });
        // Não há mais o que desanexar: a tentativa de garantia não conta como desanexação.
        expect(await conexao.desanexar()).toBe(false);
        expect(await conexao.desanexar()).toBe(false);
        expect(transporte.chamadas.desanexar).toBe(1);
      },
    );

    it('desanexação de outra aba não afeta a conexão', async () => {
      const transporte = criarTransporteFalso();
      const conexao = criarConexaoCdp(transporte);
      await conexao.anexar(5);
      let perdeu = false;
      conexao.aoPerder(() => (perdeu = true));

      transporte.derrubar(9, 'target_closed');
      expect(perdeu).toBe(false);
      expect(conexao.anexada).toBe(true);
    });

    it('a desanexação pedida pela própria extensão não conta como perda', async () => {
      const transporte = criarTransporteFalso();
      const conexao = criarConexaoCdp(transporte);
      await conexao.anexar(5);
      let perdeu = false;
      conexao.aoPerder(() => (perdeu = true));

      await conexao.desanexar();
      transporte.derrubar(5, 'target_closed');
      expect(perdeu).toBe(false);
    });
  });
});
