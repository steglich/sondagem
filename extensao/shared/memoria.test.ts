import { describe, expect, it } from 'vitest';
import { dadosVazios } from './agregacao.ts';
import {
  LIMITES_PADRAO,
  analisarMemoria,
  classificarExecucao,
  classificarSerie,
  compararSnapshots,
  seriesPorIteracao,
  variacaoDomListeners,
} from './memoria.ts';
import type { MedicaoMemoria, ResumoConstrutor, ResumoSnapshot } from './types.ts';

const KB = 1024;
const MINIMO = LIMITES_PADRAO.crescimentoMinimo.heap_usado;

function resumo(rotulo: string, construtores: ResumoConstrutor[], extras: Partial<ResumoSnapshot> = {}): ResumoSnapshot {
  return { rotulo, instante: 0, totalObjetos: construtores.reduce((total, c) => total + c.contagem, 0), construtores, outros: null, ...extras };
}

const c = (nome: string, contagem: number): ResumoConstrutor => ({ nome, contagem });

/** Uma medição por iteração, com o heap dado. */
function medicoes(heaps: readonly number[], outras: Partial<MedicaoMemoria> = {}): MedicaoMemoria[] {
  return heaps.map((heapUsado, i) => ({ instante: 1000 * i, heapUsado, nosDom: 50, listeners: 10, iteracao: i + 1, ...outras }));
}

const iteracoes = (quantas: number, incompletas: number[] = []) =>
  Array.from({ length: quantas }, (_, i) => ({ numero: i + 1, completa: !incompletas.includes(i + 1) }));

describe('comparação entre censos', () => {
  it('junta por construtor e ordena pela variação de contagem', () => {
    const comparacao = compararSnapshots(
      resumo('inicio', [c('Array', 10), c('Item', 100), c('Cache', 1)]),
      resumo('fim', [c('Array', 12), c('Item', 1100), c('Cache', 1)]),
    );

    expect(comparacao).toMatchObject({ de: 'inicio', para: 'fim' });
    expect(comparacao.construtores).toEqual([
      { nome: 'Item', situacao: 'ambos', contagem: { antes: 100, depois: 1100, variacao: 1000 } },
      { nome: 'Array', situacao: 'ambos', contagem: { antes: 10, depois: 12, variacao: 2 } },
      { nome: 'Cache', situacao: 'ambos', contagem: { antes: 1, depois: 1, variacao: 0 } },
    ]);
  });

  it('construtor novo: conta como zero no início', () => {
    const comparacao = compararSnapshots(resumo('inicio', [c('Base', 1)]), resumo('fim', [c('Base', 1), c('HTMLLIElement', 2000)]));
    expect(comparacao.construtores[0]).toEqual({ nome: 'HTMLLIElement', situacao: 'novo', contagem: { antes: 0, depois: 2000, variacao: 2000 } });
  });

  it('construtor removido: variação negativa, no fim da lista', () => {
    const comparacao = compararSnapshots(resumo('inicio', [c('Base', 1), c('Temporario', 5)]), resumo('fim', [c('Base', 2)]));
    expect(comparacao.construtores.map((x) => x.nome)).toEqual(['Base', 'Temporario']);
    expect(comparacao.construtores[1]).toEqual({ nome: 'Temporario', situacao: 'removido', contagem: { antes: 5, depois: 0, variacao: -5 } });
  });

  it('sem variação: empate resolvido pelo nome', () => {
    const comparacao = compararSnapshots(resumo('inicio', [c('B', 3), c('A', 3)]), resumo('fim', [c('A', 3), c('B', 3)]));
    expect(comparacao.construtores.map((x) => [x.nome, x.contagem.variacao])).toEqual([
      ['A', 0],
      ['B', 0],
    ]);
  });

  it('"outros" não entra na comparação', () => {
    const comparacao = compararSnapshots(resumo('inicio', [c('A', 1)], { outros: c('(outros)', 900) }), resumo('fim', [c('A', 1)], { outros: c('(outros)', 5000) }));
    expect(comparacao.construtores.map((x) => x.nome)).toEqual(['A']);
  });
});

describe('série por iteração', () => {
  it('traz o valor de cada iteração e o crescimento médio por iteração', () => {
    const series = seriesPorIteracao(
      [
        { instante: 1, heapUsado: 1000 * KB, nosDom: 100, listeners: 10, iteracao: 1 },
        { instante: 2, heapUsado: 1100 * KB, nosDom: 300, listeners: 11, iteracao: 2 },
        { instante: 3, heapUsado: 1150 * KB, nosDom: 500, listeners: 12, iteracao: 3 },
      ],
      iteracoes(3),
    );
    expect(series.map((s) => s.metrica)).toEqual(['heap_usado', 'nos_dom', 'listeners']);
    expect(series[0]).toMatchObject({
      pontos: [
        { iteracao: 1, valor: 1000 * KB },
        { iteracao: 2, valor: 1100 * KB },
        { iteracao: 3, valor: 1150 * KB },
      ],
      crescimentoMedio: 75 * KB,
      transicoesCrescentes: 2,
    });
    expect(series[1]).toMatchObject({ crescimentoMedio: 200, transicoesCrescentes: 2 });
    expect(series[2]).toMatchObject({ crescimentoMedio: 1 });
  });

  it('usa a última medição da iteração e ignora o que foi medido fora das iterações', () => {
    const series = seriesPorIteracao(
      [
        { instante: 0, heapUsado: 1, nosDom: null, listeners: null, iteracao: null },
        { instante: 1, heapUsado: 500, nosDom: null, listeners: null, iteracao: 1 },
        { instante: 2, heapUsado: 700, nosDom: null, listeners: null, iteracao: 1 },
        { instante: 3, heapUsado: 900, nosDom: null, listeners: null, iteracao: 2 },
      ],
      iteracoes(2),
    );
    expect(series[0]!.pontos).toEqual([
      { iteracao: 1, valor: 700 },
      { iteracao: 2, valor: 900 },
    ]);
    // Métrica que nenhum passo pediu: série vazia, sem crescimento.
    expect(series[1]).toMatchObject({ pontos: [], crescimentoMedio: null, classificacao: 'dados-insuficientes' });
  });

  it('iteração incompleta fica fora da série', () => {
    const series = seriesPorIteracao(medicoes([100, 200, 300, 400]), iteracoes(4, [2]));
    expect(series[0]!.pontos.map((p) => p.iteracao)).toEqual([1, 3, 4]);
    expect(series[0]!.crescimentoMedio).toBe(150);
  });

  it('um ponto só não tem crescimento médio', () => {
    expect(seriesPorIteracao(medicoes([100]), iteracoes(1))[0]).toMatchObject({ crescimentoMedio: null, transicoesCrescentes: 0 });
  });
});

describe('classificação', () => {
  it('série crescente acima do mínimo: vazamento provável', () => {
    const serie = Array.from({ length: 10 }, (_, i) => 1000 * KB + i * 40 * KB);
    expect(classificarSerie(serie, MINIMO)).toBe('vazamento-provavel');
  });

  it('crescente com uma queda: ainda vazamento provável (8 de 9 transições)', () => {
    const serie = [1000, 1040, 1080, 1120, 1100, 1160, 1200, 1240, 1280, 1320].map((v) => v * KB);
    expect(classificarSerie(serie, MINIMO)).toBe('vazamento-provavel');
  });

  it('série estável com ruído: sem indício', () => {
    const serie = [1000, 1012, 995, 1008, 1001, 1015, 998, 1004, 1010, 1003].map((v) => v * KB);
    expect(classificarSerie(serie, MINIMO)).toBe('sem-indicio');
  });

  it('degrau único (cache preenchido uma vez): sem indício, mesmo com crescimento total grande', () => {
    const serie = [1000, 1000, 1000, 3000, 3000, 3000, 3000, 3000, 3000, 3000].map((v) => v * KB);
    expect(classificarSerie(serie, MINIMO)).toBe('sem-indicio');
  });

  it('sempre crescente, mas abaixo do crescimento mínimo: sem indício', () => {
    const serie = Array.from({ length: 10 }, (_, i) => 1000 * KB + i * 2 * KB);
    expect(classificarSerie(serie, MINIMO)).toBe('sem-indicio');
  });

  it('menos de 5 iterações: dados insuficientes, por mais que cresça', () => {
    expect(classificarSerie([1000 * KB, 2000 * KB, 3000 * KB], MINIMO)).toBe('dados-insuficientes');
    expect(classificarSerie([1, 2, 3, 4].map((v) => v * 1000 * KB), MINIMO)).toBe('dados-insuficientes');
    expect(classificarSerie([], MINIMO)).toBe('dados-insuficientes');
    expect(classificarSerie([1, 2, 3, 4, 5].map((v) => v * 1000 * KB), MINIMO)).toBe('vazamento-provavel');
  });

  it('os limites são configuráveis', () => {
    const serie = [1000, 1080, 1040, 1120, 1080, 1160].map((v) => v * KB);
    expect(classificarSerie(serie, MINIMO)).toBe('sem-indicio');
    expect(classificarSerie(serie, MINIMO, { iteracoesMinimas: 5, proporcaoCrescente: 0.6 })).toBe('vazamento-provavel');
    expect(classificarSerie(serie, 500 * KB, { iteracoesMinimas: 5, proporcaoCrescente: 0.6 })).toBe('sem-indicio');
    expect(classificarSerie(serie, MINIMO, { iteracoesMinimas: 7, proporcaoCrescente: 0.6 })).toBe('dados-insuficientes');
  });

  it('nós DOM e listeners são classificados pela mesma regra, com o mínimo de cada um', () => {
    const series = seriesPorIteracao(
      Array.from({ length: 10 }, (_, i) => ({ instante: i, heapUsado: 1000 * KB, nosDom: 100 + i * 200, listeners: 10 + i, iteracao: i + 1 })),
      iteracoes(10),
    );
    expect(series.map((s) => [s.metrica, s.classificacao])).toEqual([
      ['heap_usado', 'sem-indicio'],
      ['nos_dom', 'vazamento-provavel'],
      ['listeners', 'vazamento-provavel'],
    ]);
  });
});

describe('classificação da execução', () => {
  const s = (...classificacoes: ('vazamento-provavel' | 'sem-indicio' | 'dados-insuficientes')[]) => classificacoes.map((classificacao) => ({ classificacao }));

  it('basta uma série crescer de forma consistente', () => {
    expect(classificarExecucao(s('sem-indicio', 'vazamento-provavel', 'sem-indicio'))).toBe('vazamento-provavel');
    expect(classificarExecucao(s('vazamento-provavel', 'dados-insuficientes', 'dados-insuficientes'))).toBe('vazamento-provavel');
  });

  it('nenhuma cresceu: sem indício, mesmo que alguma métrica não tenha sido medida', () => {
    expect(classificarExecucao(s('sem-indicio', 'sem-indicio', 'sem-indicio'))).toBe('sem-indicio');
    expect(classificarExecucao(s('sem-indicio', 'dados-insuficientes', 'dados-insuficientes'))).toBe('sem-indicio');
  });

  it('nenhuma série com pontos suficientes: dados insuficientes', () => {
    expect(classificarExecucao(s('dados-insuficientes', 'dados-insuficientes', 'dados-insuficientes'))).toBe('dados-insuficientes');
    expect(classificarExecucao([])).toBe('dados-insuficientes');
  });

  it('nós DOM retidos com o heap de JavaScript quase parado: vazamento provável', () => {
    // Como no caso de DOM da página de teste: 4 KB de heap e 404 nós a mais por iteração.
    const medidas = Array.from({ length: 10 }, (_, i) => ({ instante: i, heapUsado: 1300 * KB + i * 4 * KB, nosDom: 846 + i * 404, listeners: 13, iteracao: i + 1 }));
    const analise = analisarMemoria({ ...dadosVazios(), medicoes: medidas }, ['memoria'], iteracoes(10))!;
    expect(analise.series.map((x) => x.classificacao)).toEqual(['sem-indicio', 'vazamento-provavel', 'sem-indicio']);
    expect(analise.classificacao).toBe('vazamento-provavel');
  });
});

describe('nós desanexados e listeners', () => {
  it('reporta a variação entre os contadores de início e de fim', () => {
    const variacao = variacaoDomListeners({
      contadoresDom: { inicio: { nosDom: 850, listeners: 16, nosDesanexados: 203 }, fim: { nosDom: 4486, listeners: 26, nosDesanexados: 2233 } },
    });
    expect(variacao).toEqual({
      nosDesanexados: { antes: 203, depois: 2233, variacao: 2030 },
      listeners: { antes: 16, depois: 26, variacao: 10 },
    });
  });

  it('sem a leitura de fim, nada é reportado', () => {
    expect(variacaoDomListeners({ contadoresDom: { inicio: { nosDom: 1, listeners: 2, nosDesanexados: 0 }, fim: null } })).toEqual({
      nosDesanexados: null,
      listeners: null,
    });
  });

  it('navegador que não informa os nós desanexados: só os listeners', () => {
    const variacao = variacaoDomListeners({
      contadoresDom: { inicio: { nosDom: 1, listeners: 2, nosDesanexados: null }, fim: { nosDom: 1, listeners: 5, nosDesanexados: null } },
    });
    expect(variacao).toEqual({ nosDesanexados: null, listeners: { antes: 2, depois: 5, variacao: 3 } });
  });
});

describe('análise completa', () => {
  const dados = () => ({
    ...dadosVazios(),
    medicoes: medicoes(Array.from({ length: 6 }, (_, i) => 1000 * KB + i * 100 * KB)),
    snapshots: [resumo('inicio', [c('A', 1)]), resumo('fim', [c('A', 5)])],
    contadoresDom: { inicio: { nosDom: 10, listeners: 3, nosDesanexados: 1 }, fim: { nosDom: 10, listeners: 9, nosDesanexados: 7 } },
  });

  it('nenhuma das duas verificações marcada: sem análise', () => {
    expect(analisarMemoria(dados(), ['processamento', 'carregamento'], iteracoes(6))).toBeNull();
  });

  it('com "Memória": classificação pela série de heap, comparação, e nada de DOM e listeners', () => {
    const analise = analisarMemoria(dados(), ['memoria'], iteracoes(6))!;
    expect(analise.classificacao).toBe('vazamento-provavel');
    expect(analise.series).toHaveLength(3);
    expect(analise.comparacao?.construtores[0]).toMatchObject({ nome: 'A', contagem: { variacao: 4 } });
    expect(analise.domListeners).toBeNull();
  });

  it('só com "DOM e listeners": a variação é reportada, sem série nem classificação', () => {
    const analise = analisarMemoria(dados(), ['dom-listeners'], iteracoes(6))!;
    expect(analise).toMatchObject({
      classificacao: null,
      series: [],
      domListeners: { nosDesanexados: { variacao: 6 }, listeners: { antes: 3, depois: 9, variacao: 6 } },
    });
  });

  it('3 iterações completas: dados insuficientes', () => {
    const tres = { ...dados(), medicoes: medicoes([1000 * KB, 2000 * KB, 3000 * KB]) };
    expect(analisarMemoria(tres, ['memoria'], iteracoes(3))!.classificacao).toBe('dados-insuficientes');
    // 6 iterações rodaram, mas só 3 chegaram ao fim.
    expect(analisarMemoria(dados(), ['memoria'], iteracoes(6, [2, 4, 6]))!.classificacao).toBe('dados-insuficientes');
  });

  it('sessão manual: sem iterações, não há série nem classificação', () => {
    const analise = analisarMemoria(dados(), ['memoria', 'dom-listeners'], null)!;
    expect(analise).toMatchObject({ classificacao: null, series: [], comparacao: { de: 'inicio', para: 'fim' } });
    expect(analise.domListeners).not.toBeNull();
  });
});
