import { describe, expect, it } from 'vitest';
import { execucaoDeTeste } from './apoio-registro.ts';
import { LIMITE_REGRESSAO_PADRAO, avaliarRegressao, comparaveisCom, compararExecucoes, limiteDe, normalizarLinhaDeBase } from './comparacao.ts';

const A = execucaoDeTeste('a', { 'duracao-iteracao': 1000, 'tempo-long-tasks': 200, 'pior-interacao': 120 }, { versaoBuild: '1.4.0', inicio: 1000 });
const B = execucaoDeTeste('b', { 'duracao-iteracao': 1100, 'tempo-long-tasks': 150, 'pior-interacao': 120 }, { versaoBuild: '1.5.0', inicio: 9000 });

describe('comparação entre duas execuções', () => {
  it('por métrica: os dois valores, a diferença absoluta e a percentual', () => {
    const comparacao = compararExecucoes(A, B);
    if (!comparacao.ok) throw new Error(comparacao.mensagem);
    expect(comparacao).toMatchObject({
      nomeCenario: 'abrir-fechar',
      a: { id: 'a', versaoBuild: '1.4.0' },
      b: { id: 'b', versaoBuild: '1.5.0' },
      condicoes: [],
      ambiente: [],
    });
    expect(comparacao.metricas).toEqual([
      { id: 'duracao-iteracao', nome: 'Duração da iteração', unidade: 'ms', a: 1000, b: 1100, diferenca: 100, percentual: 10, situacao: 'pior' },
      { id: 'tempo-long-tasks', nome: 'Tempo em long tasks por iteração', unidade: 'ms', a: 200, b: 150, diferenca: -50, percentual: -25, situacao: 'melhor' },
      { id: 'pior-interacao', nome: 'Pior interação por iteração', unidade: 'ms', a: 120, b: 120, diferenca: 0, percentual: 0, situacao: 'igual' },
    ]);
  });

  it('métrica que falta em um dos lados sai como "sem dado", e as outras são comparadas', () => {
    const semProcessamento = execucaoDeTeste('c', { 'duracao-iteracao': 900 }, { selecao: [] });
    const semAmostra = execucaoDeTeste('d', { 'duracao-iteracao': 900, 'tempo-long-tasks': 10, 'pior-interacao': null });
    const comparacao = compararExecucoes(A, semProcessamento);
    if (!comparacao.ok) throw new Error(comparacao.mensagem);
    expect(comparacao.metricas.map((m) => [m.id, m.situacao, m.diferenca])).toEqual([
      ['duracao-iteracao', 'melhor', -100],
      ['tempo-long-tasks', 'sem-dado', null],
      ['pior-interacao', 'sem-dado', null],
    ]);
    const outra = compararExecucoes(A, semAmostra);
    expect(outra.ok && outra.metricas.find((m) => m.id === 'pior-interacao')).toMatchObject({ a: 120, b: null, percentual: null, situacao: 'sem-dado' });
  });

  it('referência zero: há diferença absoluta, mas não percentual', () => {
    const zero = execucaoDeTeste('z', { 'tempo-long-tasks': 0 });
    const comparacao = compararExecucoes(zero, execucaoDeTeste('y', { 'tempo-long-tasks': 80 }));
    expect(comparacao.ok && comparacao.metricas.find((m) => m.id === 'tempo-long-tasks')).toMatchObject({ diferenca: 80, percentual: null, situacao: 'pior' });
  });

  it('perfis de throttling diferentes: as diferenças de condições são listadas', () => {
    const semLimite = execucaoDeTeste('s', { 'duracao-iteracao': 400 }, { condicoes: { ...A.condicoes, perfil: 'nenhum', cpu: 1, rede: null }, chaveCondicoes: 'cpu=1' });
    const comparacao = compararExecucoes(A, semLimite);
    if (!comparacao.ok) throw new Error(comparacao.mensagem);
    expect(comparacao.condicoes).toEqual([
      { campo: 'Perfil de throttling', a: 'padrao', b: 'nenhum' },
      { campo: 'Fator de CPU', a: '4×', b: '1×' },
      { campo: 'Rede', a: 'rede com 150 ms de latência, download de 1600 kbps e upload de 750 kbps', b: 'sem limitação' },
    ]);
  });

  it('iterações, verificações e ambiente diferentes também aparecem', () => {
    const outra = execucaoDeTeste(
      'o',
      { 'duracao-iteracao': 1000 },
      {
        selecao: ['processamento', 'cpu'],
        configuracao: { ...A.configuracao!, iteracoes: 20 },
        ambiente: { ...A.ambiente!, versaoNavegador: '159.0.1.2', janela: { largura: 800, altura: 600 } },
        extensoes: [{ id: 'x', nome: 'Bloqueador' }],
      },
    );
    const comparacao = compararExecucoes(A, outra);
    if (!comparacao.ok) throw new Error(comparacao.mensagem);
    expect(comparacao.condicoes).toEqual([
      { campo: 'Iterações', a: '5', b: '20' },
      { campo: 'Verificações', a: 'processamento', b: 'cpu, processamento' },
    ]);
    expect(comparacao.ambiente).toEqual([
      { campo: 'Versão do navegador', a: '158.0.8127.18', b: '159.0.1.2' },
      { campo: 'Janela', a: '1280×720', b: '800×600' },
      { campo: 'Outras extensões ativas', a: '—', b: 'Bloqueador' },
    ]);
  });

  it('recusa cenários diferentes, explicando o motivo', () => {
    const outro = execucaoDeTeste('x', { 'duracao-iteracao': 1 }, { nomeCenario: 'checkout' });
    const comparacao = compararExecucoes(A, outro);
    expect(comparacao).toMatchObject({ ok: false, motivo: 'cenarios-diferentes' });
    expect(!comparacao.ok && comparacao.mensagem).toContain('"abrir-fechar" e "checkout"');
  });

  it('recusa resultado interrompido, cancelado, com erro ou com falha de sessão', () => {
    for (const estado of ['interrompida', 'cancelada', 'erro', 'em-andamento'] as const) {
      expect(compararExecucoes(A, execucaoDeTeste('p', {}, { estado }))).toMatchObject({ ok: false, motivo: 'resultado-incompleto' });
      expect(compararExecucoes(execucaoDeTeste('p', {}, { estado }), B)).toMatchObject({ ok: false, motivo: 'resultado-incompleto' });
    }
    const expirada = execucaoDeTeste('e', {}, {}, { falhaDeSessao: { url: 'http://localhost:4300/login', iteracao: 3 } });
    expect(compararExecucoes(A, expirada)).toMatchObject({ ok: false, motivo: 'resultado-incompleto' });
  });

  it('recusa sessão manual', () => {
    const manual = execucaoDeTeste('m', {}, { tipo: 'sessao-manual', grupo: 'manual', nomeCenario: null });
    expect(compararExecucoes(manual, manual)).toMatchObject({ ok: false, motivo: 'sessao-manual' });
    expect(compararExecucoes(A, manual)).toMatchObject({ ok: false, motivo: 'sessao-manual' });
  });

  it('comparáveis: as execuções completas do mesmo cenário, menos ela mesma', () => {
    const historico = [
      A,
      B,
      execucaoDeTeste('outro', {}, { nomeCenario: 'checkout' }),
      execucaoDeTeste('parcial', {}, { estado: 'interrompida' }),
      execucaoDeTeste('manual', {}, { tipo: 'sessao-manual', grupo: 'manual', nomeCenario: null }),
    ];
    expect(comparaveisCom(A, historico).map((r) => r.id)).toEqual(['b']);
    expect(comparaveisCom(historico[3]!, historico)).toEqual([]);
    expect(comparaveisCom(historico[4]!, historico)).toEqual([]);
  });
});

describe('linha de base', () => {
  it('o limite padrão é 10% para toda métrica sem limite próprio', () => {
    expect(LIMITE_REGRESSAO_PADRAO).toBe(10);
    expect(limiteDe({ limites: { 'pior-interacao': 20 } }, 'pior-interacao')).toBe(20);
    expect(limiteDe({ limites: { 'pior-interacao': 20 } }, 'duracao-iteracao')).toBe(10);
  });

  it('normaliza o que foi salvo: sem execução não há linha de base, e limite inválido cai no padrão', () => {
    expect(normalizarLinhaDeBase(undefined)).toBeNull();
    expect(normalizarLinhaDeBase({ limites: {} })).toBeNull();
    expect(normalizarLinhaDeBase({ id: 'a', limites: { 'pior-interacao': 20, 'duracao-iteracao': -1, outra: 5 } })).toEqual({ id: 'a', limites: { 'pior-interacao': 20 } });
    expect(normalizarLinhaDeBase({ id: 'a' })).toEqual({ id: 'a', limites: {} });
  });

  it('acima do limite: interação de 120 ms para 180 ms com limite de 20% é regressão', () => {
    const base = execucaoDeTeste('base', { 'duracao-iteracao': 1000, 'pior-interacao': 120 });
    const nova = execucaoDeTeste('nova', { 'duracao-iteracao': 1000, 'pior-interacao': 180 });
    const avaliacao = avaliarRegressao(base, nova, { limites: { 'pior-interacao': 20 } });
    if (!avaliacao.ok) throw new Error(avaliacao.mensagem);
    expect(avaliacao.regressao).toBe(true);
    expect(avaliacao.metricas.find((m) => m.id === 'pior-interacao')).toMatchObject({ a: 120, b: 180, percentual: 50, limite: 20, resultado: 'regressao' });
    expect(avaliacao.metricas.find((m) => m.id === 'duracao-iteracao')).toMatchObject({ limite: 10, resultado: 'dentro-do-limite' });
  });

  it('dentro do limite em todas as métricas: sem regressão (inclusive exatamente no limite e quando melhorou)', () => {
    const base = execucaoDeTeste('base', { 'duracao-iteracao': 1000, 'tempo-long-tasks': 200, 'pior-interacao': 120 });
    const nova = execucaoDeTeste('nova', { 'duracao-iteracao': 1100, 'tempo-long-tasks': 50, 'pior-interacao': 125 });
    const avaliacao = avaliarRegressao(base, nova, { limites: {} });
    if (!avaliacao.ok) throw new Error(avaliacao.mensagem);
    expect(avaliacao.regressao).toBe(false);
    expect(avaliacao.metricas.map((m) => m.resultado)).toEqual(['dentro-do-limite', 'dentro-do-limite', 'dentro-do-limite']);
  });

  it('métrica ausente na linha de base ou na nova execução não é avaliada nem conta como regressão', () => {
    const base = execucaoDeTeste('base', { 'duracao-iteracao': 1000, 'pior-interacao': 120 });
    const nova = execucaoDeTeste('nova', { 'duracao-iteracao': 1000, 'tempo-long-tasks': 900, 'pior-interacao': null });
    const avaliacao = avaliarRegressao(base, nova, { limites: {} });
    if (!avaliacao.ok) throw new Error(avaliacao.mensagem);
    expect(avaliacao.regressao).toBe(false);
    expect(avaliacao.metricas.map((m) => [m.id, m.resultado])).toEqual([
      ['duracao-iteracao', 'dentro-do-limite'],
      ['tempo-long-tasks', 'sem-dado'],
      ['pior-interacao', 'sem-dado'],
    ]);
  });

  it('linha de base zero: qualquer aumento é regressão', () => {
    const base = execucaoDeTeste('base', { 'tempo-long-tasks': 0 });
    const avaliacao = avaliarRegressao(base, execucaoDeTeste('nova', { 'tempo-long-tasks': 60 }), { limites: {} });
    expect(avaliacao.ok && avaliacao.metricas.find((m) => m.id === 'tempo-long-tasks')?.resultado).toBe('regressao');
    const igual = avaliarRegressao(base, execucaoDeTeste('nova', { 'tempo-long-tasks': 0 }), { limites: {} });
    expect(igual.ok && igual.regressao).toBe(false);
  });

  it('execução parcial ou sessão manual não é avaliada contra a linha de base', () => {
    const base = execucaoDeTeste('base', { 'duracao-iteracao': 1000 });
    expect(avaliarRegressao(base, execucaoDeTeste('nova', {}, { estado: 'erro' }), { limites: {} })).toMatchObject({ ok: false, motivo: 'resultado-incompleto' });
  });

  it('informa as condições diferentes da linha de base', () => {
    const base = execucaoDeTeste('base', { 'duracao-iteracao': 1000 });
    const nova = execucaoDeTeste('nova', { 'duracao-iteracao': 1000 }, { condicoes: { ...base.condicoes, cpu: 6 } });
    const avaliacao = avaliarRegressao(base, nova, { limites: {} });
    expect(avaliacao.ok && avaliacao.condicoes).toEqual([{ campo: 'Fator de CPU', a: '4×', b: '6×' }]);
  });
});
