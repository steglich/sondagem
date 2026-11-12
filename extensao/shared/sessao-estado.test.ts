import { describe, expect, it } from 'vitest';
import { aplicarLote } from './agregacao.ts';
import { comecarParada, concluir, estadoInicial, iniciar, visaoDe } from './sessao-estado.ts';
import type { EstadoSessao } from './types.ts';

const inicio = {
  idAba: 5,
  url: 'http://localhost:4300/cpu-pesada',
  selecao: ['processamento' as const],
  inicio: 1000,
  idsScripts: ['sondagem-sessao'],
};
const fim = { desfecho: 'concluida' as const, fim: 9000, limpeza: [], paginaRespondeu: true };

function ativa(): EstadoSessao {
  const transicao = iniciar(estadoInicial(), inicio);
  if (!transicao.ok) throw new Error('deveria iniciar');
  return transicao.estado;
}

describe('máquina de estados da sessão', () => {
  it('começa ociosa e sem resultado', () => {
    expect(estadoInicial()).toEqual({ fase: 'ociosa', sessao: null, resultado: null, idResultado: null });
  });

  it('inicia uma sessão manual a partir de ociosa', () => {
    const estado = ativa();
    expect(estado.fase).toBe('ativa');
    expect(estado.sessao).toMatchObject({ tipo: 'sessao-manual', idAba: 5, selecao: ['processamento'] });
  });

  it('recusa novo início com sessão ativa', () => {
    const estado = ativa();
    expect(iniciar(estado, { ...inicio, idAba: 6 })).toEqual({ ok: false, motivo: 'sessao-ativa' });
    expect(estado.sessao?.idAba).toBe(5);
  });

  it('recusa novo início enquanto a sessão está parando', () => {
    const parando = comecarParada(ativa());
    if (!parando.ok) throw new Error('deveria parar');
    expect(parando.estado.fase).toBe('parando');
    expect(iniciar(parando.estado, inicio)).toEqual({ ok: false, motivo: 'sessao-ativa' });
  });

  it('recusa parar ou concluir sem sessão', () => {
    expect(comecarParada(estadoInicial())).toEqual({ ok: false, motivo: 'sem-sessao' });
    expect(concluir(estadoInicial(), fim)).toEqual({ ok: false, motivo: 'sem-sessao' });
  });

  it('concluir volta a ociosa com o resultado marcado como sessão manual e libera novo início', () => {
    const estado = ativa();
    aplicarLote(estado.sessao!.dados, {
      documento: { id: 'd', url: inicio.url, inicio: 1000 },
      longTasks: [{ inicio: 1200, duracao: 300 }],
      interacoes: [],
      metricas: {},
    });

    const transicao = concluir(estado, fim);
    if (!transicao.ok) throw new Error('deveria concluir');
    expect(transicao.estado.fase).toBe('ociosa');
    expect(transicao.estado.resultado).toMatchObject({ tipo: 'sessao-manual', desfecho: 'concluida', fim: 9000 });
    expect(transicao.estado.resultado?.dados.longTasks).toHaveLength(1);
    expect(iniciar(transicao.estado, inicio).ok).toBe(true);
  });

  it('sessão interrompida preserva os dados; cancelada descarta', () => {
    const lote = {
      documento: { id: 'd', url: inicio.url, inicio: 1000 },
      longTasks: [{ inicio: 1200, duracao: 300 }],
      interacoes: [],
      metricas: {},
    };
    const interrompida = ativa();
    aplicarLote(interrompida.sessao!.dados, lote);
    const a = concluir(interrompida, { ...fim, desfecho: 'interrompida', paginaRespondeu: false });
    expect(a.ok && a.estado.resultado?.dados.longTasks).toHaveLength(1);

    const cancelada = ativa();
    aplicarLote(cancelada.sessao!.dados, lote);
    const b = concluir(cancelada, { ...fim, desfecho: 'cancelada' });
    expect(b.ok && b.estado.resultado?.dados.longTasks).toEqual([]);
  });
});

describe('perfil de CPU no resultado', () => {
  const coleta = { estado: 'concluida', ativo: true, resumo: null, falha: null, incompleto: false, limiteAtingido: false } as const;

  it('marca no resultado que o perfil de CPU estava ativo', () => {
    const estado = ativa();
    estado.sessao!.dados.cpu = { ...coleta };
    const transicao = concluir(estado, fim);
    expect(transicao.ok && transicao.estado.resultado?.dados.cpu).toMatchObject({ estado: 'concluida', ativo: true });
  });

  it('sem a verificação "CPU" o resultado não tem dados de CPU', () => {
    const transicao = concluir(ativa(), fim);
    expect(transicao.ok && transicao.estado.resultado?.dados.cpu).toBeNull();
  });

  it('análise que acaba com o perfil aberto: fica registrado que ele não foi lido', () => {
    const estado = ativa();
    estado.sessao!.dados.cpu = { ...coleta, estado: 'coletando' };
    const transicao = concluir(estado, { ...fim, desfecho: 'interrompida' });
    expect(transicao.ok && transicao.estado.resultado?.dados.cpu).toMatchObject({
      estado: 'falhou',
      ativo: true,
      falha: 'O perfil de CPU não foi lido: a análise terminou antes de o navegador entregar os dados.',
    });
  });

  it('cancelada: os dados de CPU são descartados com as outras medições', () => {
    const estado = ativa();
    estado.sessao!.dados.cpu = { ...coleta };
    const transicao = concluir(estado, { ...fim, desfecho: 'cancelada' });
    expect(transicao.ok && transicao.estado.resultado?.dados.cpu).toBeNull();
  });
});

describe('visaoDe', () => {
  it('durante a análise leva só o status resumido, sem registros detalhados', () => {
    const estado = ativa();
    aplicarLote(estado.sessao!.dados, {
      documento: { id: 'd', url: inicio.url, inicio: 1000 },
      longTasks: [{ inicio: 1200, duracao: 300 }],
      interacoes: [],
      metricas: {},
    });
    expect(visaoDe(estado)).toEqual({
      fase: 'ativa',
      alvo: { idAba: 5, url: inicio.url },
      selecao: ['processamento'],
      inicio: 1000,
      status: { longTasks: 1, interacoes: 0, piorLongTask: 300, carregamentos: 1, errosPagina: 0, heapUsado: null, snapshots: 0, cpu: null },
      execucao: null,
      resultado: null,
    });
  });

  it('ociosa leva o último resultado', () => {
    const transicao = concluir(ativa(), fim);
    if (!transicao.ok) throw new Error('deveria concluir');
    const visao = visaoDe(transicao.estado);
    expect(visao.fase).toBe('ociosa');
    expect(visao.resultado?.desfecho).toBe('concluida');
    expect(visao.status).toBeNull();
  });
});
