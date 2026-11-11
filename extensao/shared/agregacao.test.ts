import { describe, expect, it } from 'vitest';
import {
  aplicarLote,
  dadosVazios,
  estatisticasDaExecucao,
  inpDaAnalise,
  marcarLongTasksDaMedicao,
  metricasDeCarregamento,
  resumir,
} from './agregacao.ts';
import type { Lote } from './types.ts';

const documento = { id: 'doc-1', url: 'http://localhost:4300/cpu-pesada', inicio: 1000 };

function lote(parcial: Partial<Lote> = {}): Lote {
  return { documento, longTasks: [], interacoes: [], metricas: {}, ...parcial };
}

describe('aplicarLote', () => {
  it('acumula long tasks e registra o documento', () => {
    const dados = dadosVazios();
    aplicarLote(dados, lote({ longTasks: [{ inicio: 1100, duracao: 300 }] }));
    aplicarLote(dados, lote({ longTasks: [{ inicio: 2100, duracao: 80 }] }));

    expect(dados.longTasks).toHaveLength(2);
    expect(dados.documentos).toEqual([{ ...documento, metricas: {} }]);
  });

  it('une a mesma interação recebida em dois lotes, ficando com a mais demorada', () => {
    const dados = dadosVazios();
    const base = { id: 7, documento: 'doc-1', inicio: 1100, alvo: 'button' };
    aplicarLote(dados, lote({ interacoes: [{ ...base, tipo: 'pointerdown', duracao: 48 }] }));
    aplicarLote(dados, lote({ interacoes: [{ ...base, tipo: 'click', duracao: 320 }] }));
    aplicarLote(dados, lote({ interacoes: [{ ...base, tipo: 'pointerup', duracao: 56 }] }));

    expect(dados.interacoes).toEqual([{ ...base, tipo: 'click', duracao: 320 }]);
  });

  it('ao unir lotes, o alvo conhecido não se perde para um registro sem alvo', () => {
    const base = { id: 7, documento: 'doc-1', inicio: 1100 };
    const semAlvo = '(elemento removido)';

    const depois = dadosVazios();
    aplicarLote(depois, lote({ interacoes: [{ ...base, tipo: 'pointerdown', duracao: 304, alvo: semAlvo }] }));
    aplicarLote(depois, lote({ interacoes: [{ ...base, tipo: 'click', duracao: 304, alvo: 'button' }] }));
    expect(depois.interacoes).toEqual([{ ...base, tipo: 'pointerdown', duracao: 304, alvo: 'button' }]);

    const antes = dadosVazios();
    aplicarLote(antes, lote({ interacoes: [{ ...base, tipo: 'pointerdown', duracao: 48, alvo: 'button' }] }));
    aplicarLote(antes, lote({ interacoes: [{ ...base, tipo: 'click', duracao: 320, alvo: semAlvo }] }));
    expect(antes.interacoes).toEqual([{ ...base, tipo: 'click', duracao: 320, alvo: 'button' }]);
  });

  it('mantém as métricas por documento e atualiza só as que mudaram', () => {
    const dados = dadosVazios();
    aplicarLote(dados, lote({ metricas: { FCP: 120, LCP: 150 } }));
    aplicarLote(dados, lote({ metricas: { LCP: 400 } }));
    aplicarLote(dados, lote({ documento: { ...documento, id: 'doc-2' }, metricas: { FCP: 90 } }));

    expect(dados.documentos.map((d) => d.metricas)).toEqual([{ FCP: 120, LCP: 400 }, { FCP: 90 }]);
  });
});

describe('resumir', () => {
  it('conta os registros e aponta a pior long task', () => {
    const dados = dadosVazios();
    expect(resumir(dados)).toEqual({ longTasks: 0, interacoes: 0, piorLongTask: null, carregamentos: 0, errosPagina: 0, heapUsado: null, snapshots: 0 });

    aplicarLote(dados, lote({ longTasks: [{ inicio: 1, duracao: 60 }, { inicio: 2, duracao: 310 }] }));
    expect(resumir(dados)).toEqual({ longTasks: 2, interacoes: 0, piorLongTask: 310, carregamentos: 1, errosPagina: 0, heapUsado: null, snapshots: 0 });
  });
});

describe('métricas', () => {
  it('métrica ausente aparece como indisponível (null), e zero continua sendo zero', () => {
    expect(metricasDeCarregamento({ FCP: 120, CLS: 0 })).toEqual({ lcp: null, cls: 0, fcp: 120, ttfb: null });
  });

  it('o INP da análise é o pior entre os documentos, ou indisponível', () => {
    const dados = dadosVazios();
    expect(inpDaAnalise(dados)).toBeNull();
    aplicarLote(dados, lote({ metricas: { INP: 80 } }));
    aplicarLote(dados, lote({ documento: { ...documento, id: 'doc-2' }, metricas: { INP: 320 } }));
    expect(inpDaAnalise(dados)).toBe(320);
  });
});

describe('long tasks causadas pela medição', () => {
  const doc = { id: 'doc-1', url: 'http://localhost:4300/limpa', inicio: 0 };
  const iteracao = [{ numero: 1, inicio: 0, fim: 10_000, completa: true, passosExecutados: 3 }];

  it('a long task que coincide com a pausa de um snapshot é marcada e não entra nas estatísticas', () => {
    const dados = dadosVazios();
    dados.pausasDeMedicao.push({ inicio: 5000, fim: 6000 });
    aplicarLote(
      dados,
      {
        documento: doc,
        longTasks: [
          { inicio: 1000, duracao: 80 },
          { inicio: 4990, duracao: 1100 },
          { inicio: 5900, duracao: 200 },
          { inicio: 6000, duracao: 70 },
        ],
        interacoes: [],
        metricas: {},
      },
      { aquecimento: null, iteracoes: iteracao },
    );

    expect(dados.longTasks.map((t) => t.causadaPelaMedicao ?? false)).toEqual([false, true, true, false]);
    expect(estatisticasDaExecucao(dados, iteracao, ['processamento'])[1]).toMatchObject({ id: 'tempo-long-tasks', mediana: 150 });
  });

  it('pausa ainda aberta cobre tudo o que vem depois do início dela', () => {
    const dados = dadosVazios();
    dados.pausasDeMedicao.push({ inicio: 5000, fim: null });
    aplicarLote(dados, { documento: doc, longTasks: [{ inicio: 100, duracao: 60 }, { inicio: 7000, duracao: 60 }], interacoes: [], metricas: {} });
    expect(dados.longTasks.map((t) => t.causadaPelaMedicao ?? false)).toEqual([false, true]);
  });

  it('long task que chegou antes de a pausa ser registrada é marcada depois', () => {
    const dados = dadosVazios();
    aplicarLote(dados, { documento: doc, longTasks: [{ inicio: 5100, duracao: 300 }, { inicio: 9000, duracao: 60 }], interacoes: [], metricas: {} });
    dados.pausasDeMedicao.push({ inicio: 5000, fim: 5500 });
    marcarLongTasksDaMedicao(dados);
    expect(dados.longTasks.map((t) => t.causadaPelaMedicao ?? false)).toEqual([true, false]);
  });
});
