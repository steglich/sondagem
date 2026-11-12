/**
 * Responsividade do relatório com um resultado grande. Fica no projeto `medicao`
 * (em série, depois dos outros): com a suíte em paralelo, a carga dos outros testes
 * alonga as tarefas da página e o limite deixaria de dizer algo sobre o relatório.
 */
import { dadosVazios } from '../../extensao/shared/agregacao.ts';
import { iteracoes } from '../../extensao/shared/apoio-registro.ts';
import { SEM_CONDICOES } from '../../extensao/shared/condicoes.ts';
import { LIMITE_FUNCOES_CPU } from '../../extensao/shared/cpu.ts';
import { registroFinal } from '../../extensao/shared/historico.ts';
import { LIMITE_CONSTRUTORES, analisarMemoria } from '../../extensao/shared/memoria.ts';
import { resumirValores } from '../../extensao/shared/stats.ts';
import type { DadosColetados, ResultadoSessao, ResumoSnapshot } from '../../extensao/shared/types.ts';
import { expect, test } from '../extensao/fixtures.ts';

const ITERACOES = 20;
const LONG_TASKS = 10_000;
const LIMITE_MS = 200;

/** Resultado sintético: 10.000 long tasks, milhares de interações e erros, censos e perfil de CPU no tamanho máximo. */
function resultadoGrande(): ResultadoSessao {
  const feitas = iteracoes(ITERACOES, 10_000);
  const censo = (rotulo: string, fator: number, instante: number): ResumoSnapshot => ({
    rotulo,
    instante,
    iteracao: null,
    totalObjetos: LIMITE_CONSTRUTORES * 100 * fator,
    construtores: Array.from({ length: LIMITE_CONSTRUTORES }, (_, i) => ({ nome: `Construtor${i}`, contagem: (LIMITE_CONSTRUTORES - i) * fator + (i % 17) })),
    outros: { nome: '(outros)', contagem: 1234 * fator },
  });
  const dados: DadosColetados = {
    ...dadosVazios(),
    longTasks: Array.from({ length: LONG_TASKS }, (_, i) => ({ inicio: 10_000 + i * 2, duracao: 50 + (i % 40), iteracao: (i % ITERACOES) + 1 })),
    interacoes: Array.from({ length: 5000 }, (_, i) => ({
      id: i,
      documento: 'doc',
      inicio: 10_000 + i * 4,
      duracao: 30 + (i % 90),
      tipo: i % 2 ? 'click' : 'keydown',
      alvo: `button[data-testid="acao-${i}"]`,
      iteracao: (i % ITERACOES) + 1,
    })),
    errosPagina: Array.from({ length: 2000 }, (_, i) => ({
      tipo: 'excecao' as const,
      mensagem: `Error: falha ${i}`,
      arquivo: 'http://localhost:4300/erros.ts',
      linha: i,
      coluna: 1,
      instante: 10_000 + i * 10,
      iteracao: (i % ITERACOES) + 1,
    })),
    documentos: [{ id: 'doc', url: 'http://localhost:4300/limpa', inicio: 9000, metricas: { TTFB: 12, FCP: 80, LCP: 120, CLS: 0 } }],
    medicoes: feitas.map((iteracao, i) => ({ instante: iteracao.fim!, heapUsado: 2_000_000 + i * 50_000, nosDom: 900 + i * 40, listeners: 20 + i, iteracao: iteracao.numero })),
    snapshots: [censo('inicio', 1, 9500), censo('fim', 3, 31_000)],
    cpu: {
      estado: 'concluida',
      ativo: true,
      falha: null,
      incompleto: false,
      limiteAtingido: false,
      resumo: {
        tempoAmostrado: 20_000,
        tempoAtivo: 9000,
        amostras: 120_000,
        categorias: { ocioso: 11_000, coletaDeLixo: 300, programa: 500, extensoes: 40 },
        funcoes: Array.from({ length: LIMITE_FUNCOES_CPU }, (_, i) => ({
          nome: `funcao${i}`,
          arquivo: 'http://localhost:4300/aplicacao.ts',
          linha: i + 1,
          coluna: 1,
          tempoProprio: 400 - i,
          tempoTotal: 800 - i,
          percentual: (400 - i) / 90,
        })),
        outras: { quantidade: 900, tempoProprio: 300, percentual: 3.3 },
      },
    },
  };
  const selecao: ResultadoSessao['selecao'] = ['processamento', 'carregamento', 'erros-pagina', 'memoria', 'dom-listeners', 'cpu'];
  return {
    id: 'sintetico-grande',
    tipo: 'cenario',
    desfecho: 'concluida',
    url: 'http://localhost:4300/limpa',
    selecao,
    inicio: 9000,
    fim: 31_500,
    dados,
    limpeza: [],
    paginaRespondeu: true,
    conexaoPerdida: null,
    cenario: {
      configuracao: { nome: 'sintetico', urlInicial: 'http://localhost:4300/limpa', iteracoes: ITERACOES, throttling: null, versaoBuild: '9.9.9' },
      estadoFinal: 'concluida',
      ambiente: null,
      iteracoes: feitas,
      iteracoesCompletas: ITERACOES,
      iteracoesIncompletas: 0,
      passosExecutados: ITERACOES * 3,
      falhas: [],
      falhaDeSessao: null,
      estatisticas: [
        { id: 'duracao-iteracao', ...resumirValores(feitas.map(() => 1000)) },
        { id: 'tempo-long-tasks', ...resumirValores(feitas.map((_, i) => 34_000 + i)) },
        { id: 'pior-interacao', ...resumirValores(feitas.map(() => 119)) },
      ],
    },
    memoria: analisarMemoria(dados, selecao, feitas),
    condicoes: SEM_CONDICOES,
    extensoes: [],
    navegador: null,
    truncado: [],
  };
}

test('relatório de um resultado com 10.000 long tasks e censos no tamanho máximo: nenhuma tarefa do relatório passa de 200 ms na abertura e na rolagem', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  test.slow();
  const guardada = registroFinal(resultadoGrande(), null, Infinity);
  expect(guardada.registro.truncado).toEqual([]);
  expect(guardada.dados.longTasks).toHaveLength(LONG_TASKS);
  expect(guardada.registro.resumo!.memoria!.comparacao!.construtores).toHaveLength(LIMITE_CONSTRUTORES);

  // Grava direto no IndexedDB da extensão, com o mesmo esquema do repositório.
  await serviceWorker.evaluate(async ({ registro, dados }: { registro: { id: string }; dados: unknown }) => {
    const banco = await new Promise<IDBDatabase>((resolver, rejeitar) => {
      const pedido = indexedDB.open('sondagem', 1);
      pedido.onupgradeneeded = () => {
        const execucoes = pedido.result.createObjectStore('execucoes', { keyPath: 'id' });
        execucoes.createIndex('grupo', 'grupo');
        execucoes.createIndex('inicio', 'inicio');
        pedido.result.createObjectStore('detalhes', { keyPath: 'id' });
      };
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => rejeitar(pedido.error);
    });
    await new Promise<void>((resolver, rejeitar) => {
      const transacao = banco.transaction(['execucoes', 'detalhes'], 'readwrite');
      transacao.objectStore('execucoes').put(registro);
      transacao.objectStore('detalhes').put({ id: registro.id, dados });
      transacao.oncomplete = () => resolver();
      transacao.onerror = () => rejeitar(transacao.error);
    });
    banco.close();
  }, { registro: guardada.registro, dados: guardada.dados } as unknown as { registro: { id: string }; dados: unknown });

  const relatorio = await context.newPage();
  // Observa as long tasks do próprio relatório desde antes de a página carregar.
  await relatorio.addInitScript(() => {
    const tarefas: number[] = [];
    (globalThis as { tarefasLongas?: number[] }).tarefasLongas = tarefas;
    new PerformanceObserver((lista) => tarefas.push(...lista.getEntries().map((e) => e.duration))).observe({ type: 'longtask', buffered: true });
  });
  const tarefasLongas = (): Promise<number[]> => relatorio.evaluate(() => (globalThis as { tarefasLongas?: number[] }).tarefasLongas ?? []);
  const semTravar = async (momento: string): Promise<void> => {
    // Dá tempo de o observador entregar as tarefas que acabaram de terminar.
    await relatorio.waitForTimeout(300);
    const tarefas = await tarefasLongas();
    expect(Math.max(0, ...tarefas), `${momento}: long tasks do relatório ${JSON.stringify(tarefas.map(Math.round))}`).toBeLessThanOrEqual(LIMITE_MS);
  };

  // Abertura: cabeçalho e estatísticas, sem os detalhes.
  await relatorio.goto(`chrome-extension://${idExtensao}/index.html#/relatorio/sintetico-grande`);
  await expect(relatorio.getByTestId('relatorio-estado')).toHaveText('Concluída');
  await expect(relatorio.getByTestId('estatistica')).toHaveCount(3);
  expect(await relatorio.evaluate(() => (globalThis as { tarefasLongas?: number[] }).tarefasLongas !== undefined)).toBe(true);
  await semTravar('abertura');

  // Todas as seções de uma vez: é o pior caso (lê os detalhes e monta gráficos e listas juntos).
  await relatorio.getByTestId('abrir-secoes').click();
  await expect(relatorio.getByTestId('lista-long-tasks').getByTestId('lista-total')).toHaveText('10000 itens');
  await expect(relatorio.getByTestId('lista-construtores').getByTestId('lista-total')).toHaveText(`${LIMITE_CONSTRUTORES} itens`);
  await expect(relatorio.getByTestId('lista-funcoes').getByTestId('lista-total')).toHaveText(`${LIMITE_FUNCOES_CPU} itens`);
  await expect(relatorio.getByTestId('lista-erros').getByTestId('lista-total')).toHaveText('2000 itens');
  // Quatro gráficos (processamento, heap, nós DOM e listeners); cada um só é desenhado ao entrar na tela.
  const graficos = relatorio.getByTestId('grafico');
  await expect(graficos).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await graficos.nth(i).scrollIntoViewIfNeeded();
    await expect(graficos.nth(i).locator('canvas')).toHaveCount(1);
  }
  // As 10.000 long tasks não viram 10.000 linhas no DOM.
  expect(await relatorio.getByTestId('lista-long-tasks').getByTestId('linha').count()).toBeLessThan(100);
  await semTravar('abertura das seções');

  // Rolagem das listas virtuais, do começo ao fim, e da página.
  for (const lista of ['lista-long-tasks', 'lista-interacoes', 'lista-construtores', 'lista-funcoes', 'lista-erros']) {
    const area = relatorio.getByTestId(lista).locator('cdk-virtual-scroll-viewport');
    await area.scrollIntoViewIfNeeded();
    for (const fracao of [0.1, 0.35, 0.6, 0.85, 1]) {
      await area.evaluate((elemento, f) => elemento.scrollTo({ top: elemento.scrollHeight * f }), fracao);
      await relatorio.waitForTimeout(50);
    }
    await area.hover();
    for (let passo = 0; passo < 10; passo++) await relatorio.mouse.wheel(0, -600);
  }
  // No fim da lista, a última long task está na tela.
  await relatorio.getByTestId('lista-long-tasks').locator('cdk-virtual-scroll-viewport').evaluate((e) => e.scrollTo({ top: e.scrollHeight }));
  await expect(relatorio.getByTestId('lista-long-tasks').getByTestId('linha').last()).toContainText('21.00 s');
  for (let passo = 0; passo < 15; passo++) await relatorio.mouse.wheel(0, 500);
  await semTravar('rolagem');

  // Cliques: fechar e reabrir uma seção continua respondendo.
  await relatorio.getByTestId('secao-processamento').locator('summary').click();
  await expect(relatorio.getByTestId('lista-long-tasks')).toHaveCount(0);
  await relatorio.getByTestId('secao-processamento').locator('summary').click();
  await expect(relatorio.getByTestId('lista-long-tasks').getByTestId('linha').first()).toBeVisible();
  await semTravar('fechar e reabrir a seção');

  // Contraprova do instrumento: um bloqueio de propósito tem de aparecer no observador.
  // (Dentro de um temporizador: o código avaliado direto pelo depurador não conta como tarefa da página.)
  await relatorio.evaluate(
    () =>
      new Promise<void>((resolver) =>
        setTimeout(() => {
          const fim = performance.now() + 120;
          while (performance.now() < fim);
          resolver();
        }, 0),
      ),
  );
  await expect.poll(async () => Math.max(0, ...(await tarefasLongas()))).toBeGreaterThanOrEqual(100);
});
