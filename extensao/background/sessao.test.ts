import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoSessao, Lote, MensagemDaPagina, MensagemParaPagina, VisaoSessao } from '../shared/types.ts';
import { criarTransporteFalso } from './apoio-teste.ts';
import { criarConexaoCdp } from './cdp.ts';
import { type AmbienteSessao, ESPERA_ENCERRAMENTO_MS, type PortaDaPagina, criarOrquestrador } from './sessao.ts';

const URL_TESTE = 'http://localhost:4300/cpu-pesada';

function criarAmbiente(gravado?: EstadoSessao) {
  const abas = new Map<number, string>([
    [5, URL_TESTE],
    [6, 'chrome://extensions'],
  ]);
  const scripts = new Set<string>();
  const publicadas: VisaoSessao[] = [];
  const injetadas: number[] = [];
  let estadoGravado = gravado;
  const transporte = criarTransporteFalso();
  const periodicas = new Set<() => void>();
  const ambiente: AmbienteSessao = {
    lerEstado: async () => structuredClone(estadoGravado),
    gravarEstado: async (estado) => void (estadoGravado = structuredClone(estado)),
    urlDaAba: async (id) => abas.get(id) ?? null,
    registrarScript: async (id) => void scripts.add(id),
    removerScripts: async (ids) => {
      const alvo = ids ?? [...scripts];
      const removidos = alvo.filter((id) => scripts.delete(id));
      return removidos.length;
    },
    injetar: async (idAba) => void injetadas.push(idAba),
    publicar: (visao) => void publicadas.push(structuredClone(visao)),
    agora: () => Date.now(),
    criarCdp: () => criarConexaoCdp(transporte),
    soltarDepurador: async (idAba) => transporte.anexadas.delete(idAba),
    repetir: (acao) => {
      periodicas.add(acao);
      return () => void periodicas.delete(acao);
    },
  };
  return { ambiente, abas, scripts, publicadas, injetadas, transporte, gravado: () => estadoGravado };
}

interface PortaSimulada extends PortaDaPagina {
  recebidas: MensagemParaPagina[];
  desconectada: boolean;
  /** Mensagem vinda da página. */
  daPagina(mensagem: MensagemDaPagina): void;
  /** Queda da porta pelo lado da página. */
  cair(): void;
  /** Responde automaticamente ao pedido de encerramento, como o código injetado. */
  responderEncerramento: boolean;
}

function criarPorta(idAba = 5, idQuadro = 0): PortaSimulada {
  const ouvintes: ((m: MensagemDaPagina) => void)[] = [];
  const quedas: (() => void)[] = [];
  const porta: PortaSimulada = {
    idAba,
    idQuadro,
    recebidas: [],
    desconectada: false,
    responderEncerramento: true,
    enviar(mensagem) {
      porta.recebidas.push(mensagem);
      if (mensagem.tipo === 'encerrar' && porta.responderEncerramento) {
        // Como o código injetado: responde e fecha a própria porta em seguida.
        queueMicrotask(() => {
          porta.daPagina({
            tipo: 'encerrado',
            lote: lote({ longTasks: [{ inicio: 9, duracao: 70 }] }),
            desconectados: { observadores: 3, listeners: 4, temporizadores: 1 },
          });
          porta.cair();
        });
      }
    },
    desconectar: () => void (porta.desconectada = true),
    aoReceber: (ouvinte) => void ouvintes.push(ouvinte),
    aoDesconectar: (ouvinte) => void quedas.push(ouvinte),
    daPagina: (mensagem) => ouvintes.forEach((ouvinte) => ouvinte(mensagem)),
    cair: () => quedas.forEach((ouvinte) => ouvinte()),
  };
  return porta;
}

function lote(parcial: Partial<Lote> = {}): Lote {
  return {
    documento: { id: 'doc-1', url: URL_TESTE, inicio: 0 },
    longTasks: [],
    interacoes: [],
    metricas: {},
    ...parcial,
  };
}

/** Deixa a fila de operações do orquestrador esvaziar. */
const assentar = (): Promise<void> => vi.advanceTimersByTimeAsync(0).then(() => undefined);

async function sessaoAtiva(gravado?: EstadoSessao) {
  const contexto = criarAmbiente(gravado);
  const orquestrador = criarOrquestrador(contexto.ambiente);
  await orquestrador.recuperar();
  const resposta = await orquestrador.comando({ tipo: 'iniciar', idAba: 5, selecao: ['processamento'] });
  const porta = criarPorta();
  orquestrador.portaConectada(porta);
  await assentar();
  return { ...contexto, orquestrador, resposta, porta };
}

describe('orquestração da sessão', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe('início', () => {
    it('registra o script, grava o estado, injeta na aba e configura a porta com a seleção', async () => {
      const { resposta, scripts, injetadas, gravado, porta } = await sessaoAtiva();

      expect(resposta).toMatchObject({ ok: true, visao: { fase: 'ativa', alvo: { idAba: 5, url: URL_TESTE } } });
      expect([...scripts]).toEqual(['sondagem-sessao']);
      expect(injetadas).toEqual([5]);
      expect(gravado()).toMatchObject({ fase: 'ativa', sessao: { tipo: 'sessao-manual', idAba: 5 } });
      expect(porta.recebidas).toEqual([{ tipo: 'configurar', selecao: ['processamento'] }]);
    });

    it('sem comando de início, nada é registrado nem injetado', async () => {
      const { ambiente, scripts, injetadas } = criarAmbiente();
      const orquestrador = criarOrquestrador(ambiente);
      await orquestrador.recuperar();
      const resposta = await orquestrador.comando({ tipo: 'obter-visao' });

      expect(resposta.visao.fase).toBe('ociosa');
      expect(scripts.size).toBe(0);
      expect(injetadas).toEqual([]);
    });

    it('recusa novo início com sessão ativa, sem tocar na sessão em curso', async () => {
      const { orquestrador, injetadas } = await sessaoAtiva();
      const segunda = await orquestrador.comando({ tipo: 'iniciar', idAba: 5, selecao: ['carregamento'] });

      expect(segunda).toMatchObject({ ok: false, motivo: 'sessao-ativa', visao: { selecao: ['processamento'] } });
      expect(injetadas).toEqual([5]);
    });

    it('recusa URL não suportada e seleção vazia, sem registrar nada', async () => {
      const { ambiente, scripts, injetadas } = criarAmbiente();
      const orquestrador = criarOrquestrador(ambiente);
      await orquestrador.recuperar();

      expect(await orquestrador.comando({ tipo: 'iniciar', idAba: 6, selecao: ['processamento'] })).toMatchObject({
        ok: false,
        motivo: 'url-nao-suportada',
      });
      expect(await orquestrador.comando({ tipo: 'iniciar', idAba: 5, selecao: [] })).toMatchObject({
        ok: false,
        motivo: 'sem-verificacao',
      });
      expect(scripts.size).toBe(0);
      expect(injetadas).toEqual([]);
    });

    it('se a injeção falha, desfaz o registro e volta a ociosa', async () => {
      const { ambiente, scripts, gravado } = criarAmbiente();
      ambiente.injetar = async () => {
        throw new Error('Cannot access contents of the page.');
      };
      const orquestrador = criarOrquestrador(ambiente);
      await orquestrador.recuperar();
      const resposta = await orquestrador.comando({ tipo: 'iniciar', idAba: 5, selecao: ['processamento'] });

      expect(resposta).toMatchObject({ ok: false, motivo: 'erro', visao: { fase: 'ociosa' } });
      expect(scripts.size).toBe(0);
      expect(gravado()?.fase).toBe('ociosa');
    });

    it('recusa portas de outra aba, de subquadros ou sem sessão', async () => {
      const { orquestrador } = await sessaoAtiva();
      const outraAba = criarPorta(9);
      const subquadro = criarPorta(5, 3);
      orquestrador.portaConectada(outraAba);
      orquestrador.portaConectada(subquadro);
      await assentar();

      expect(outraAba).toMatchObject({ desconectada: true, recebidas: [] });
      expect(subquadro).toMatchObject({ desconectada: true, recebidas: [] });
    });
  });

  describe('agregação e status', () => {
    it('agrega os lotes e publica o status no máximo uma vez por segundo', async () => {
      const { porta, publicadas, gravado } = await sessaoAtiva();
      publicadas.length = 0;
      await vi.advanceTimersByTimeAsync(1000);

      // 50 lotes em um segundo (um a cada 20 ms).
      for (let i = 0; i < 50; i++) {
        porta.daPagina({ tipo: 'lote', lote: lote({ longTasks: [{ inicio: i, duracao: 60 + i }] }) });
        await vi.advanceTimersByTimeAsync(20);
      }
      await vi.advanceTimersByTimeAsync(1000);

      expect(publicadas.length).toBeLessThanOrEqual(2);
      expect(publicadas.at(-1)?.status).toEqual({
        longTasks: 50,
        interacoes: 0,
        piorLongTask: 109,
        carregamentos: 1,
        errosPagina: 0,
        heapUsado: null,
        snapshots: 0,
      });
      expect(gravado()?.sessao?.dados.longTasks).toHaveLength(50);
    });

    it('durante a análise a interface não recebe registros detalhados', async () => {
      const { porta, publicadas } = await sessaoAtiva();
      porta.daPagina({ tipo: 'lote', lote: lote({ longTasks: [{ inicio: 1, duracao: 300 }] }) });
      await vi.advanceTimersByTimeAsync(1000);

      expect(publicadas.every((visao) => visao.resultado === null)).toBe(true);
      expect(JSON.stringify(publicadas)).not.toContain('"duracao"');
    });
  });

  describe('parada', () => {
    it('pede o encerramento, junta o último lote, remove o script, fecha a porta e lista o que removeu', async () => {
      const { orquestrador, porta, scripts, gravado } = await sessaoAtiva();
      porta.daPagina({ tipo: 'lote', lote: lote({ longTasks: [{ inicio: 1, duracao: 300 }] }) });
      await assentar();

      const resposta = await orquestrador.comando({ tipo: 'parar' });

      expect(porta.recebidas.at(-1)).toEqual({ tipo: 'encerrar' });
      expect(scripts.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(resposta.visao).toMatchObject({ fase: 'ociosa', resultado: { tipo: 'sessao-manual', desfecho: 'concluida' } });
      expect(resposta.visao.resultado?.dados.longTasks.map((t) => t.duracao)).toEqual([300, 70]);
      expect(resposta.visao.resultado?.limpeza).toEqual([
        { recurso: 'script-registrado', quantidade: 1 },
        { recurso: 'observador', quantidade: 3 },
        { recurso: 'listener', quantidade: 4 },
        { recurso: 'porta', quantidade: 1 },
        { recurso: 'temporizador', quantidade: 2 },
      ]);
      expect(gravado()).toMatchObject({ fase: 'ociosa', sessao: null });
    });

    it('depois de parar, lotes e portas novas são ignorados', async () => {
      const { orquestrador, porta, gravado } = await sessaoAtiva();
      await orquestrador.comando({ tipo: 'parar' });
      const antes = structuredClone(gravado());

      porta.daPagina({ tipo: 'lote', lote: lote({ longTasks: [{ inicio: 5, duracao: 500 }] }) });
      const tardia = criarPorta();
      orquestrador.portaConectada(tardia);
      await assentar();

      expect(gravado()).toEqual(antes);
      expect(tardia).toMatchObject({ desconectada: true, recebidas: [] });
    });

    it('cancelar faz a mesma limpeza e descarta as medições', async () => {
      const { orquestrador, porta, scripts } = await sessaoAtiva();
      porta.daPagina({ tipo: 'lote', lote: lote({ longTasks: [{ inicio: 1, duracao: 300 }] }) });
      await assentar();

      const { visao } = await orquestrador.comando({ tipo: 'cancelar' });

      expect(visao.resultado).toMatchObject({ desfecho: 'cancelada', dados: { longTasks: [] } });
      expect(visao.resultado?.limpeza.map((item) => item.recurso)).toContain('observador');
      expect(scripts.size).toBe(0);
    });

    it('se a página não responde, a parada termina pelo tempo limite e ainda limpa o resto', async () => {
      const { orquestrador, porta, scripts } = await sessaoAtiva();
      porta.responderEncerramento = false;

      const pendente = orquestrador.comando({ tipo: 'parar' });
      await vi.advanceTimersByTimeAsync(ESPERA_ENCERRAMENTO_MS);
      const { visao } = await pendente;

      expect(visao.resultado).toMatchObject({ desfecho: 'concluida', paginaRespondeu: false });
      expect(scripts.size).toBe(0);
      expect(porta.desconectada).toBe(true);
    });

    it('parar sem sessão é recusado', async () => {
      const { ambiente } = criarAmbiente();
      const orquestrador = criarOrquestrador(ambiente);
      await orquestrador.recuperar();
      expect(await orquestrador.comando({ tipo: 'parar' })).toMatchObject({ ok: false, motivo: 'sem-sessao' });
    });
  });

  describe('recuperação', () => {
    it('aba fechada durante a sessão: limpa, marca como interrompida e preserva os dados', async () => {
      const { orquestrador, porta, abas, scripts, publicadas } = await sessaoAtiva();
      porta.daPagina({ tipo: 'lote', lote: lote({ longTasks: [{ inicio: 1, duracao: 300 }] }) });
      await assentar();

      abas.delete(5);
      porta.cair();
      await orquestrador.abaRemovida(5);

      const { visao } = await orquestrador.comando({ tipo: 'obter-visao' });
      expect(visao).toMatchObject({ fase: 'ociosa', resultado: { desfecho: 'interrompida', paginaRespondeu: false } });
      expect(visao.resultado?.dados.longTasks).toEqual([{ inicio: 1, duracao: 300 }]);
      expect(scripts.size).toBe(0);
      expect(publicadas.at(-1)?.resultado?.desfecho).toBe('interrompida');
    });

    it('fechar outra aba não afeta a sessão', async () => {
      const { orquestrador } = await sessaoAtiva();
      await orquestrador.abaRemovida(77);
      expect((await orquestrador.comando({ tipo: 'obter-visao' })).visao.fase).toBe('ativa');
    });

    it('ao acordar com sessão gravada e a aba já fechada, encerra como interrompida com os dados gravados', async () => {
      const anterior = await sessaoAtiva();
      anterior.porta.daPagina({ tipo: 'lote', lote: lote({ longTasks: [{ inicio: 1, duracao: 300 }] }) });
      await assentar();

      // Service worker novo, com o que ficou em storage.session e o script ainda registrado.
      const novo = criarAmbiente(anterior.gravado());
      novo.scripts.add('sondagem-sessao');
      novo.abas.delete(5);
      const orquestrador = criarOrquestrador(novo.ambiente);
      await orquestrador.recuperar();

      const { visao } = await orquestrador.comando({ tipo: 'obter-visao' });
      expect(visao.resultado).toMatchObject({ desfecho: 'interrompida' });
      expect(visao.resultado?.dados.longTasks).toHaveLength(1);
      expect(visao.resultado?.limpeza).toEqual([{ recurso: 'script-registrado', quantidade: 1 }]);
      expect(novo.scripts.size).toBe(0);
    });

    it('ao acordar com a aba ainda aberta, a sessão continua e a página reconecta', async () => {
      const anterior = await sessaoAtiva();
      const novo = criarAmbiente(anterior.gravado());
      const orquestrador = criarOrquestrador(novo.ambiente);
      await orquestrador.recuperar();

      const porta = criarPorta();
      orquestrador.portaConectada(porta);
      await assentar();

      expect((await orquestrador.comando({ tipo: 'obter-visao' })).visao.fase).toBe('ativa');
      expect(porta.recebidas).toEqual([{ tipo: 'configurar', selecao: ['processamento'] }]);
    });

    it('ao acordar sem sessão, remove qualquer script que tenha sobrado', async () => {
      const { ambiente, scripts } = criarAmbiente();
      scripts.add('sondagem-sessao');
      await criarOrquestrador(ambiente).recuperar();
      expect(scripts.size).toBe(0);
    });
  });
});
