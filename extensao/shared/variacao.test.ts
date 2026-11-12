import { describe, expect, it } from 'vitest';
import type { RegistroExecucao } from './historico.ts';
import type { IdMetricaIteracao } from './types.ts';
import { coeficienteDeVariacao, variacaoEntreExecucoes } from './variacao.ts';

type Medianas = Partial<Record<IdMetricaIteracao, number | null>>;

let proximo = 0;
function execucao(medianas: Medianas, parcial: Partial<RegistroExecucao> = {}): RegistroExecucao {
  const id = `exec-${++proximo}`;
  return {
    id,
    tipo: 'cenario',
    estado: 'concluida',
    grupo: 'cenario:abrir-fechar',
    nomeCenario: 'abrir-fechar',
    chaveCondicoes: 'cpu=4',
    configuracao: { nome: 'abrir-fechar', urlInicial: 'http://localhost:4300/limpa', iteracoes: 5, throttling: 'padrao', versaoBuild: null },
    resumo: {
      cenario: {
        falhaDeSessao: null,
        estatisticas: Object.entries(medianas).map(([metrica, mediana]) => ({ id: metrica, amostras: 5, mediana, p75: mediana, p95: mediana })),
      },
    },
    ...parcial,
  } as unknown as RegistroExecucao;
}

describe('coeficiente de variação', () => {
  it('é o desvio padrão amostral sobre a média, em %', () => {
    // Média 100, desvio padrão amostral 10.
    expect(coeficienteDeVariacao([90, 100, 110])).toBeCloseTo(10);
    expect(coeficienteDeVariacao([100, 100, 100])).toBe(0);
  });

  it('não existe com menos de dois valores nem com média zero', () => {
    expect(coeficienteDeVariacao([])).toBeNull();
    expect(coeficienteDeVariacao([100])).toBeNull();
    expect(coeficienteDeVariacao([0, 0, 0])).toBeNull();
  });
});

describe('variação entre execuções', () => {
  it('três execuções com uma métrica acima do limite: a métrica é sinalizada como instável', () => {
    const variacoes = variacaoEntreExecucoes(
      [
        execucao({ 'duracao-iteracao': 1000, 'pior-interacao': 40 }),
        execucao({ 'duracao-iteracao': 1010, 'pior-interacao': 60 }),
        execucao({ 'duracao-iteracao': 990, 'pior-interacao': 80 }),
      ],
      10,
    );
    expect(variacoes).toHaveLength(1);
    const [grupo] = variacoes;
    expect(grupo).toMatchObject({ nomeCenario: 'abrir-fechar', execucoes: 3, instavel: true });
    const duracao = grupo!.metricas.find((m) => m.id === 'duracao-iteracao')!;
    expect(duracao).toMatchObject({ execucoes: 3, media: 1000, instavel: false });
    expect(duracao.coeficiente).toBeCloseTo(1);
    const interacao = grupo!.metricas.find((m) => m.id === 'pior-interacao')!;
    expect(interacao.instavel).toBe(true);
    expect(interacao.coeficiente).toBeCloseTo(33.33, 1);
  });

  it('dentro do limite nada é sinalizado, e o limite é o configurado', () => {
    const execucoes = [execucao({ 'duracao-iteracao': 100 }), execucao({ 'duracao-iteracao': 110 }), execucao({ 'duracao-iteracao': 90 })];
    expect(variacaoEntreExecucoes(execucoes, 10)[0]).toMatchObject({ instavel: false });
    expect(variacaoEntreExecucoes(execucoes, 5)[0]).toMatchObject({ instavel: true });
  });

  it('só compara execuções do mesmo cenário, nas mesmas condições e com o mesmo número de iterações', () => {
    const variacoes = variacaoEntreExecucoes(
      [
        execucao({ 'duracao-iteracao': 100 }),
        execucao({ 'duracao-iteracao': 100 }),
        execucao({ 'duracao-iteracao': 500 }, { chaveCondicoes: 'cpu=1' }),
        execucao({ 'duracao-iteracao': 900 }, { grupo: 'cenario:outro', nomeCenario: 'outro' }),
        execucao({ 'duracao-iteracao': 300 }, { configuracao: { iteracoes: 20 } as never }),
      ],
      10,
    );
    // Os três últimos ficam sozinhos em seus grupos: não há variação a reportar.
    expect(variacoes).toHaveLength(1);
    expect(variacoes[0]).toMatchObject({ execucoes: 2, instavel: false });
  });

  it('resultado parcial, com falha de sessão ou de sessão manual não entra', () => {
    const variacoes = variacaoEntreExecucoes(
      [
        execucao({ 'duracao-iteracao': 100 }),
        execucao({ 'duracao-iteracao': 100 }),
        execucao({ 'duracao-iteracao': 900 }, { estado: 'interrompida' }),
        execucao({ 'duracao-iteracao': 900 }, { estado: 'erro' }),
        execucao({ 'duracao-iteracao': 900 }, { estado: 'cancelada' }),
        execucao({ 'duracao-iteracao': 900 }, { tipo: 'sessao-manual' }),
      ],
      10,
    );
    expect(variacoes[0]).toMatchObject({ execucoes: 2, instavel: false });
    expect(variacoes[0]!.ids).toHaveLength(2);
  });

  it('métrica sem valor em uma execução fica fora só daquela métrica', () => {
    const [grupo] = variacaoEntreExecucoes(
      [
        execucao({ 'duracao-iteracao': 100, 'pior-interacao': null }),
        execucao({ 'duracao-iteracao': 100, 'pior-interacao': 50 }),
        execucao({ 'duracao-iteracao': 100, 'tempo-long-tasks': 0 }),
      ],
      10,
    );
    expect(grupo!.metricas.find((m) => m.id === 'duracao-iteracao')).toMatchObject({ execucoes: 3, coeficiente: 0 });
    // Um só valor, ou média zero: não dá para calcular, e não é instável.
    expect(grupo!.metricas.find((m) => m.id === 'pior-interacao')).toMatchObject({ execucoes: 1, coeficiente: null, instavel: false });
    expect(grupo!.metricas.find((m) => m.id === 'tempo-long-tasks')).toMatchObject({ execucoes: 1, coeficiente: null, instavel: false });
  });

  it('uma execução só não tem variação', () => {
    expect(variacaoEntreExecucoes([execucao({ 'duracao-iteracao': 100 })], 10)).toEqual([]);
  });
});
