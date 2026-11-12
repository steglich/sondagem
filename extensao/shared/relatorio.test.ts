import { describe, expect, it } from 'vitest';
import { execucaoDeTeste, iteracoes } from './apoio-registro.ts';
import { formatoDesconhecido, medicoesPorIteracao, pontoDeParada, secoesDoRelatorio } from './relatorio.ts';
import type { SerieMemoria } from './types.ts';

describe('seções do relatório', () => {
  it('uma seção para cada verificação que rodou', () => {
    const todas = execucaoDeTeste('a', {}, { selecao: ['processamento', 'carregamento', 'erros-pagina', 'memoria', 'dom-listeners', 'cpu'] });
    todas.resumo!.memoria = { classificacao: 'sem-indicio', series: [], comparacao: null, domListeners: null };
    expect(secoesDoRelatorio(todas)).toEqual(['processamento', 'carregamento', 'memoria', 'cpu', 'erros']);
  });

  it('verificação que não rodou não tem seção', () => {
    expect(secoesDoRelatorio(execucaoDeTeste('a', {}, { selecao: ['processamento', 'erros-pagina'] }))).toEqual(['processamento', 'erros']);
    expect(secoesDoRelatorio(execucaoDeTeste('a', {}, { selecao: [] }))).toEqual([]);
  });

  it('"DOM e listeners" sozinha abre a seção de memória', () => {
    const registro = execucaoDeTeste('a', {}, { selecao: ['dom-listeners'] });
    registro.resumo!.memoria = { classificacao: null, series: [], comparacao: null, domListeners: { nosDesanexados: null, listeners: null } };
    expect(secoesDoRelatorio(registro)).toEqual(['memoria']);
  });

  it('execução cancelada ou ainda em andamento não tem seções: não há medições', () => {
    expect(secoesDoRelatorio(execucaoDeTeste('a', {}, { estado: 'cancelada', selecao: ['processamento', 'cpu'] }))).toEqual([]);
    expect(secoesDoRelatorio(execucaoDeTeste('a', {}, { estado: 'em-andamento', resumo: null }))).toEqual([]);
  });

  it('reconhece o registro gravado em um formato mais novo', () => {
    expect(formatoDesconhecido({})).toBe(false);
    expect(formatoDesconhecido({ versaoFormato: 1 })).toBe(false);
    expect(formatoDesconhecido({ versaoFormato: 2 })).toBe(true);
  });
});

describe('ponto de parada', () => {
  it('execução concluída não tem ponto de parada', () => {
    expect(pontoDeParada(execucaoDeTeste('a'))).toBeNull();
  });

  it('interrompida na iteração 8: informa a iteração, o total e o motivo', () => {
    const feitas = iteracoes(8);
    feitas[7] = { ...feitas[7]!, completa: false };
    const registro = execucaoDeTeste(
      'a',
      {},
      { estado: 'interrompida', configuracao: { nome: 'abrir-fechar', urlInicial: 'http://localhost:4300/', iteracoes: 20, throttling: null, versaoBuild: null } },
      {
        iteracoes: feitas,
        iteracoesCompletas: 7,
        iteracoesIncompletas: 1,
        falhas: [{ caminho: '', tipoPasso: '', iteracao: 8, motivo: 'A extensão foi suspensa durante a execução.', acao: 'interrompeu' }],
      },
    );
    expect(pontoDeParada(registro)).toEqual({ iteracao: 8, totalIteracoes: 20, iteracoesCompletas: 7, motivo: 'A extensão foi suspensa durante a execução.' });
  });

  it('erro em um passo: a iteração e o motivo vêm da falha que interrompeu, não das puladas', () => {
    const registro = execucaoDeTeste(
      'a',
      {},
      { estado: 'erro' },
      {
        iteracoes: iteracoes(3).map((i) => (i.numero === 3 ? { ...i, completa: false } : i)),
        iteracoesCompletas: 2,
        falhas: [
          { caminho: '/passos/0', tipoPasso: 'clicar', iteracao: 1, motivo: 'pulado', acao: 'pulou' },
          { caminho: '/passos/1', tipoPasso: 'esperar', iteracao: 3, motivo: 'Tempo limite de 5000 ms.', acao: 'interrompeu' },
        ],
      },
    );
    expect(pontoDeParada(registro)).toMatchObject({ iteracao: 3, iteracoesCompletas: 2, motivo: 'Tempo limite de 5000 ms.' });
  });

  it('cancelada: a iteração em curso, sem falha', () => {
    const registro = execucaoDeTeste('a', {}, { estado: 'cancelada' }, { iteracoes: iteracoes(2).map((i) => (i.numero === 2 ? { ...i, completa: false } : i)), iteracoesCompletas: 1 });
    expect(pontoDeParada(registro)).toMatchObject({ iteracao: 2, motivo: 'Cancelada pelo usuário.' });
  });

  it('falha de sessão: mesmo "concluída", informa a iteração e a URL de login', () => {
    const registro = execucaoDeTeste('a', {}, {}, { falhaDeSessao: { url: 'http://localhost:4300/login', iteracao: 3 } });
    expect(pontoDeParada(registro)).toMatchObject({ iteracao: 3, motivo: 'A aplicação pediu o login (http://localhost:4300/login).' });
  });

  it('sessão manual interrompida: sem iteração, com o motivo da desconexão', () => {
    const registro = execucaoDeTeste('a', {}, { tipo: 'sessao-manual', grupo: 'manual', nomeCenario: null, estado: 'interrompida' });
    registro.resumo!.conexaoPerdida = 'canceled_by_user';
    expect(pontoDeParada(registro)).toEqual({ iteracao: null, totalIteracoes: null, iteracoesCompletas: 0, motivo: 'O debugger foi desanexado (canceled_by_user).' });
  });
});

describe('medições por iteração', () => {
  const serie = (metrica: SerieMemoria['metrica'], valores: number[]): SerieMemoria => ({
    metrica,
    pontos: valores.map((valor, i) => ({ iteracao: i + 1, valor })),
    crescimentoMedio: null,
    transicoesCrescentes: 0,
    classificacao: 'dados-insuficientes',
  });

  it('uma linha por iteração, com o tempo de long tasks, a pior interação e os erros de cada uma', () => {
    const registro = execucaoDeTeste('a', {}, { selecao: ['processamento', 'erros-pagina'] }, { iteracoes: iteracoes(3) });
    const { colunas, linhas } = medicoesPorIteracao(registro, {
      longTasks: [
        { inicio: 1100, duracao: 60, iteracao: 1 },
        { inicio: 1300, duracao: 90, iteracao: 1 },
        { inicio: 2100, duracao: 500, iteracao: 2, causadaPelaMedicao: true },
        { inicio: 500, duracao: 70, iteracao: null },
      ],
      interacoes: [
        { id: 1, documento: 'd', inicio: 1100, duracao: 40, tipo: 'click', alvo: 'button', iteracao: 1 },
        { id: 2, documento: 'd', inicio: 1200, duracao: 88, tipo: 'click', alvo: 'button', iteracao: 1 },
      ],
      errosPagina: [{ tipo: 'excecao', mensagem: 'x', arquivo: null, linha: null, coluna: null, instante: 3100, iteracao: 3 }],
    });
    expect(colunas).toEqual(['duracao', 'tempoLongTasks', 'longTasks', 'piorInteracao', 'interacoes', 'erros']);
    expect(linhas.map((l) => [l.iteracao, l.valores.duracao, l.valores.tempoLongTasks, l.valores.longTasks, l.valores.piorInteracao, l.valores.interacoes, l.valores.erros])).toEqual([
      [1, 1000, 150, 2, 88, 2, 0],
      // A long task causada pela medição não conta, e a iteração sem interação fica sem "pior interação".
      [2, 1000, 0, 0, null, 0, 0],
      [3, 1000, 0, 0, null, 0, 1],
    ]);
  });

  it('memória por iteração vem das séries do resumo; iteração sem ponto fica sem dado', () => {
    const registro = execucaoDeTeste('a', {}, { selecao: ['memoria'] }, { iteracoes: iteracoes(3) });
    registro.resumo!.memoria = {
      classificacao: 'sem-indicio',
      series: [serie('heap_usado', [1000, 2000]), serie('nos_dom', [10, 20, 30]), serie('listeners', [])],
      comparacao: null,
      domListeners: null,
    };
    const { colunas, linhas } = medicoesPorIteracao(registro, { longTasks: [], interacoes: [], errosPagina: [] });
    expect(colunas).toEqual(['duracao', 'heapUsado', 'nosDom']);
    expect(linhas.map((l) => [l.valores.heapUsado, l.valores.nosDom, l.valores.listeners])).toEqual([
      [1000, 10, null],
      [2000, 20, null],
      [null, 30, null],
    ]);
    // A verificação que não rodou não tem valor.
    expect(linhas[0]!.valores.tempoLongTasks).toBeNull();
  });

  it('lista truncada: a coluna continua, sem valores (não se inventa zero)', () => {
    const registro = execucaoDeTeste('a', {}, { selecao: ['processamento'], truncado: ['longTasks'] }, { iteracoes: iteracoes(1) });
    const { linhas } = medicoesPorIteracao(registro, { longTasks: [], interacoes: [], errosPagina: [] });
    expect(linhas[0]!.valores).toMatchObject({ tempoLongTasks: null, longTasks: null, interacoes: 0 });
  });

  it('iteração incompleta aparece marcada, e sessão manual não tem linhas', () => {
    const registro = execucaoDeTeste('a', {}, {}, { iteracoes: iteracoes(2).map((i) => (i.numero === 2 ? { ...i, completa: false } : i)) });
    expect(medicoesPorIteracao(registro, { longTasks: [], interacoes: [], errosPagina: [] }).linhas.map((l) => l.completa)).toEqual([true, false]);
    const manual = execucaoDeTeste('m', {}, { tipo: 'sessao-manual', grupo: 'manual', nomeCenario: null });
    expect(medicoesPorIteracao(manual, { longTasks: [], interacoes: [], errosPagina: [] }).linhas).toEqual([]);
  });
});
