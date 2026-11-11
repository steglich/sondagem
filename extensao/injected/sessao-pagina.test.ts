import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lote, MensagemDaPagina, MensagemParaPagina } from '../shared/types.ts';
import type { Instalacao } from './instalacao.ts';
import { type PortaPagina, iniciarNaPagina } from './sessao-pagina.ts';

interface PortaSimulada extends PortaPagina {
  enviadas: MensagemDaPagina[];
  desconectada: boolean;
  receber(mensagem: MensagemParaPagina): void;
  cair(): void;
}

function criarPorta(): PortaSimulada {
  const aoReceber: ((m: MensagemParaPagina) => void)[] = [];
  const aoCair: (() => void)[] = [];
  const porta: PortaSimulada = {
    enviadas: [],
    desconectada: false,
    postMessage: (mensagem) => void porta.enviadas.push(mensagem),
    disconnect: () => void (porta.desconectada = true),
    onMessage: { addListener: (ouvinte) => void aoReceber.push(ouvinte) },
    onDisconnect: { addListener: (ouvinte) => void aoCair.push(ouvinte) },
    receber: (mensagem) => aoReceber.forEach((ouvinte) => ouvinte(mensagem)),
    cair: () => aoCair.forEach((ouvinte) => ouvinte()),
  };
  return porta;
}

const loteVazio = (): Lote => ({
  documento: { id: 'd', url: 'http://x/', inicio: 0 },
  longTasks: [],
  interacoes: [],
  metricas: {},
});

function montar() {
  const portas: PortaSimulada[] = [];
  const instalacao: Instalacao = {
    drenar: vi.fn(loteVazio),
    desinstalar: vi.fn(() => ({ observadores: 3, listeners: 4 })),
  };
  const instalar = vi.fn(() => instalacao);
  const saidas: (() => void)[] = [];
  iniciarNaPagina({
    aoSair: (ouvinte) => void saidas.push(ouvinte),
    conectar: () => {
      const porta = criarPorta();
      portas.push(porta);
      return porta;
    },
    instalar,
  });
  return { portas, instalacao, instalar, sair: () => saidas.forEach((ouvinte) => ouvinte()) };
}

describe('ciclo de vida do código injetado', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('não instala nada antes de receber a configuração', () => {
    const { portas, instalar } = montar();
    vi.advanceTimersByTime(5000);
    expect(instalar).not.toHaveBeenCalled();
    expect(portas[0]?.enviadas).toEqual([]);
  });

  it('se o service worker recusa a porta, termina sem instalar nem tentar de novo', () => {
    const { portas, instalar } = montar();
    portas[0]!.cair();
    vi.advanceTimersByTime(5000);
    expect(instalar).not.toHaveBeenCalled();
    expect(portas).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('configurada, instala a seleção recebida e envia um lote por segundo', () => {
    const { portas, instalar } = montar();
    portas[0]!.receber({ tipo: 'configurar', selecao: ['carregamento'] });
    expect(instalar).toHaveBeenCalledWith(['carregamento']);

    vi.advanceTimersByTime(3000);
    expect(portas[0]!.enviadas.map((m) => m.tipo)).toEqual(['lote', 'lote', 'lote']);
  });

  it('quando o documento está saindo, envia na hora o que estava acumulado', () => {
    const { portas, sair } = montar();
    portas[0]!.receber({ tipo: 'configurar', selecao: ['processamento'] });
    vi.advanceTimersByTime(300);
    sair();
    expect(portas[0]!.enviadas.map((m) => m.tipo)).toEqual(['lote']);

    // Depois de encerrada, a saída do documento não envia mais nada.
    portas[0]!.receber({ tipo: 'encerrar' });
    sair();
    expect(portas[0]!.enviadas.map((m) => m.tipo)).toEqual(['lote', 'encerrado']);
  });

  it('ao encerrar, desliga tudo e responde com o último lote e as contagens', () => {
    const { portas, instalacao } = montar();
    const porta = portas[0]!;
    porta.receber({ tipo: 'configurar', selecao: ['processamento'] });
    porta.receber({ tipo: 'encerrar' });

    expect(porta.enviadas).toEqual([
      { tipo: 'encerrado', lote: loteVazio(), desconectados: { observadores: 3, listeners: 4, temporizadores: 1 } },
    ]);
    expect(instalacao.desinstalar).toHaveBeenCalledTimes(1);
    expect(porta.desconectada).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(5000);
    expect(porta.enviadas).toHaveLength(1);
  });

  it('se a porta cai com a sessão configurada, reconecta sem reinstalar os observadores', () => {
    const { portas, instalar } = montar();
    portas[0]!.receber({ tipo: 'configurar', selecao: ['processamento'] });
    portas[0]!.cair();

    expect(portas).toHaveLength(2);
    portas[1]!.receber({ tipo: 'configurar', selecao: ['processamento'] });
    expect(instalar).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(portas[1]!.enviadas.map((m) => m.tipo)).toEqual(['lote']);
    expect(portas[0]!.enviadas).toEqual([]);
  });

  it('se a reconexão é recusada (sessão já encerrada), desliga tudo', () => {
    const { portas, instalacao } = montar();
    portas[0]!.receber({ tipo: 'configurar', selecao: ['processamento'] });
    portas[0]!.cair();
    portas[1]!.cair();

    expect(instalacao.desinstalar).toHaveBeenCalledTimes(1);
    expect(portas).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('se a extensão foi recarregada e a conexão lança, termina em silêncio', () => {
    const instalar = vi.fn();
    expect(() =>
      iniciarNaPagina({
        conectar: () => {
          throw new Error('Extension context invalidated.');
        },
        instalar,
      }),
    ).not.toThrow();
    expect(instalar).not.toHaveBeenCalled();
  });
});
