import type { Worker } from '@playwright/test';
import { COMANDOS_DE_MEMORIA } from '../../extensao/background/memoria.ts';
import type { AnaliseMemoria, ResultadoSessao } from '../../extensao/shared/types.ts';
import {
  abrirPaginaEPainel,
  cenarioDaPaginaTeste,
  depuradorAnexado,
  estadoGravado,
  executar,
  resultadoFinal,
  salvarCenario,
} from './apoio.ts';
import { coletarErros, expect, test } from './fixtures.ts';

const VAZAMENTO_LISTENER = cenarioDaPaginaTeste('vazamento-listener');
const VAZAMENTO_DOM = cenarioDaPaginaTeste('vazamento-dom');
const LIMPA = cenarioDaPaginaTeste('limpa-memoria');

/** Tudo o que a extensão tem gravado, como texto. */
async function armazenado(serviceWorker: Worker): Promise<string> {
  return serviceWorker.evaluate(async () => JSON.stringify([await chrome.storage.session.get(null), await chrome.storage.local.get(null)]));
}

const serie = (memoria: AnaliseMemoria, metrica: string) => memoria.series.find((s) => s.metrica === metrica)!;

/** Os construtores que a interface lista: os 20 que mais cresceram. */
const candidatos = (resultado: ResultadoSessao) => resultado.memoria!.comparacao!.construtores.slice(0, 20);

test('o chrome.debugger aceita todos os comandos de CDP usados pela medição de memória', async ({ context, serviceWorker, idExtensao }) => {
  const { idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/limpa');
  // Os testes unitários usam um transporte falso, que aceita qualquer comando. Só aqui
  // aparece um comando que o navegador recusa a extensões (HeapProfiler, Memory...).
  const respostas = await serviceWorker.evaluate(async (tabId) => {
    const alvo = { tabId };
    const saida: { metodo: string; erro: string | null }[] = [];
    const enviar = async (metodo: string, parametros?: object): Promise<Record<string, unknown>> => {
      try {
        const resposta = (await chrome.debugger.sendCommand(alvo, metodo, parametros)) as Record<string, unknown>;
        saida.push({ metodo, erro: null });
        return resposta ?? {};
      } catch (erro) {
        saida.push({ metodo, erro: erro instanceof Error ? erro.message : String(erro) });
        return {};
      }
    };
    await chrome.debugger.attach(alvo, '1.3');
    try {
      const prototipo = (await enviar('Runtime.evaluate', { expression: 'Object.prototype', objectGroup: 'teste' }))['result'] as { objectId?: string };
      const lista = (await enviar('Runtime.queryObjects', { prototypeObjectId: prototipo?.objectId, objectGroup: 'teste' }))['objects'] as { objectId?: string };
      await enviar('Runtime.callFunctionOn', { objectId: lista?.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true });
      await enviar('Runtime.releaseObjectGroup', { objectGroup: 'teste' });
      await enviar('Performance.enable');
      await enviar('Performance.getMetrics');
      await enviar('DOM.enable');
      await enviar('DOM.getDetachedDomNodes');
      await enviar('DOM.disable');
    } finally {
      await chrome.debugger.detach(alvo);
    }
    return saida;
  }, idAba);

  expect(respostas.filter((r) => r.erro !== null)).toEqual([]);
  // A lista conferida aqui é a mesma que o módulo de memória declara usar.
  expect(respostas.map((r) => r.metodo).sort()).toEqual([...COMANDOS_DE_MEMORIA].sort());
});

test('vazamento-listener: 10 iterações geram 10 medições e a classificação "vazamento provável"', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  test.slow();
  const { pagina, painel, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  const erros = coletarErros(painel);
  await salvarCenario(painel, VAZAMENTO_LISTENER);
  await executar(painel);
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  // Uma medição por iteração, cada uma com o número da iteração e as três métricas.
  expect(resultado.cenario).toMatchObject({ iteracoesCompletas: 10, iteracoesIncompletas: 0, falhas: [] });
  expect(resultado.dados.medicoes.map((m) => m.iteracao)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const medicao of resultado.dados.medicoes) {
    expect(medicao.heapUsado).toBeGreaterThan(100_000);
    expect(medicao.nosDom).toBeGreaterThan(0);
    expect(medicao.listeners).toBeGreaterThan(0);
  }

  const memoria = resultado.memoria!;
  expect(memoria.classificacao).toBe('vazamento-provavel');
  expect(serie(memoria, 'heap_usado').pontos).toHaveLength(10);
  // Cada iteração retém um listener e os 10 000 números que ele captura.
  expect(serie(memoria, 'heap_usado').crescimentoMedio).toBeGreaterThan(20_000);
  expect(serie(memoria, 'listeners')).toMatchObject({ crescimentoMedio: 1, classificacao: 'vazamento-provavel' });
  // "DOM e listeners": pelo menos os 10 listeners que as iterações deixaram.
  expect(memoria.domListeners!.listeners!.variacao).toBeGreaterThanOrEqual(10);
  expect(await pagina.evaluate(() => window.estadoTeste.listenersAtivos)).toBe(11);

  // Os listeners retidos (funções) e os dados que cada um captura (arrays) estão entre os que mais cresceram, um por iteração.
  expect(memoria.comparacao).toMatchObject({ de: 'inicio', para: 'fim' });
  expect(candidatos(resultado).find((c) => c.nome === 'Function')).toMatchObject({ contagem: { variacao: 10 } });
  expect(candidatos(resultado).find((c) => c.nome === 'Array')).toMatchObject({ contagem: { variacao: 10 } });

  await expect(painel.getByTestId('memoria-classificacao')).toHaveText('Vazamento provável');
  await expect(painel.getByTestId('memoria-indicio')).toContainText('Isto é um indício, não uma confirmação');
  await expect(painel.getByTestId('memoria-iteracao')).toHaveCount(10);
  await expect(painel.getByTestId('memoria-construtores')).toContainText('Function');
  await expect(painel.getByTestId('limpeza-concluida')).toBeVisible();
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(false);
  expect(erros).toEqual([]);
});

test('vazamento-dom: "vazamento provável", com os elementos retidos entre os que mais cresceram', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  test.slow();
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, VAZAMENTO_DOM);
  await executar(painel);
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');
  const memoria = resultado.memoria!;

  expect(resultado.cenario!.iteracoesCompletas).toBe(10);
  expect(memoria.classificacao).toBe('vazamento-provavel');
  expect(serie(memoria, 'nos_dom').classificacao).toBe('vazamento-provavel');
  expect(await pagina.evaluate(() => window.nosRetidos?.length)).toBe(11);

  // Cada iteração retém um componente com 200 itens: 2000 <li> a mais entre os censos.
  expect(candidatos(resultado)[0]).toEqual({ nome: 'HTMLLIElement', situacao: 'ambos', contagem: { antes: 200, depois: 2200, variacao: 2000 } });
  // "DOM e listeners": cada componente retido tem 404 nós (section, h2, ul, 200 li e os textos).
  expect(memoria.domListeners!.nosDesanexados).toEqual({ antes: 404, depois: 4444, variacao: 4040 });
  // O heap de JavaScript quase não se mexe com nós retidos: quem acusa é a série de nós DOM.
  expect(serie(memoria, 'nos_dom')).toMatchObject({ crescimentoMedio: 404, transicoesCrescentes: 9 });

  await expect(painel.getByTestId('memoria-classificacao')).toHaveText('Vazamento provável');
  await expect(painel.getByTestId('memoria-construtor').first().locator('th, td')).toHaveText(['HTMLLIElement', '200', '2200', '+2000']);
  await expect(painel.getByTestId('memoria-nos-desanexados')).toHaveText('404 → 4444 (+4040)');
  await expect(painel.getByTestId('memoria-indicio')).toContainText('o número de nós DOM subiu em 9 de 9 transições');
});

test('limpa-memoria: "sem indício de vazamento"', async ({ context, serviceWorker, idExtensao }) => {
  test.slow();
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, LIMPA);
  await executar(painel);
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');
  const memoria = resultado.memoria!;

  expect(resultado.cenario!.iteracoesCompletas).toBe(10);
  expect(resultado.dados.medicoes).toHaveLength(10);
  expect(memoria.classificacao).toBe('sem-indicio');
  expect(serie(memoria, 'nos_dom').classificacao).toBe('sem-indicio');
  expect(serie(memoria, 'listeners').classificacao).toBe('sem-indicio');
  expect(memoria.domListeners).toMatchObject({ nosDesanexados: { depois: 0, variacao: 0 }, listeners: { variacao: 0 } });
  expect(await pagina.evaluate(() => window.estadoTeste)).toEqual({ ciclos: 11, listenersAtivos: 0 });

  await expect(painel.getByTestId('memoria-classificacao')).toHaveText('Sem indício de vazamento');
});

test('snapshot: fica só o resumo por construtor, e nenhum objeto da página fica preso', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  const erros = coletarErros(painel);
  await salvarCenario(painel, { ...LIMPA, nome: 'snapshot', execucao: { iteracoes: 2 } });
  await executar(painel);
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  expect(resultado.dados.snapshots.map((s) => [s.rotulo, s.iteracao])).toEqual([
    ['inicio', null],
    ['fim', null],
  ]);
  for (const snapshot of resultado.dados.snapshots) {
    expect(snapshot.totalObjetos).toBeGreaterThan(500);
    expect(snapshot.construtores.length).toBeGreaterThan(5);
    expect(snapshot.construtores.length).toBeLessThanOrEqual(500);
    // Do maior para o menor, e a soma fecha com o total.
    const contagens = snapshot.construtores.map((c) => c.contagem);
    expect(contagens).toEqual([...contagens].sort((a, b) => b - a));
    expect(contagens.reduce((a, b) => a + b, 0) + (snapshot.outros?.contagem ?? 0)).toBe(snapshot.totalObjetos);
    expect(snapshot.construtores.map((c) => c.nome)).toEqual(expect.arrayContaining(['Function', 'Object', 'HTMLButtonElement']));
  }
  // A página limpa não ganha objetos entre os dois censos.
  expect(resultado.dados.snapshots[1]!.totalObjetos).toBe(resultado.dados.snapshots[0]!.totalObjetos);

  // Só o resumo fica gravado: contagens, sem nada dos objetos da página.
  const texto = await armazenado(serviceWorker);
  expect(texto).not.toContain('objectId');
  expect(texto).not.toContain('Componente do ciclo');
  expect(texto.length).toBeLessThan(200_000);
  // O censo não deixou nada na página: nenhuma global nova e nenhum nó a mais.
  expect(await pagina.evaluate(() => Object.keys(window).filter((chave) => /sondagem|censo/i.test(chave)))).toEqual([]);
  expect(erros).toEqual([]);
});

test('só com "Carregamento": nenhum censo, nenhuma coleta forçada, e os passos de ação rodam', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, { ...LIMPA, nome: 'sem-memoria', execucao: { iteracoes: 3 } });
  await painel.getByTestId('analisar').click();
  for (const id of ['processamento', 'erros-pagina', 'memoria', 'dom-listeners']) await painel.getByTestId(`verificacao-${id}`).uncheck();
  // O aviso aparece e não impede a execução.
  await expect(painel.getByTestId('confirmacao-aviso-memoria')).toContainText('um vazamento não será confirmado');
  await expect(painel.getByTestId('confirmar')).toBeEnabled();
  await painel.getByTestId('confirmar').click();
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  expect(resultado.selecao).toEqual(['carregamento']);
  expect(resultado.dados.snapshots).toEqual([]);
  expect(resultado.dados.medicoes).toEqual([]);
  expect(resultado.memoria).toBeNull();
  // 4 passos de ação por iteração, mais os 2 do aquecimento.
  expect(resultado.cenario).toMatchObject({ iteracoesCompletas: 3, passosExecutados: 14 });
  expect(await pagina.evaluate(() => window.estadoTeste.ciclos)).toBe(4);
  await expect(painel.getByTestId('memoria-classificacao')).toHaveCount(0);
});

test('3 iterações: "dados insuficientes"', async ({ context, serviceWorker, idExtensao }) => {
  const { painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, VAZAMENTO_LISTENER);
  await executar(painel, { iteracoes: 3 });
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  expect(resultado.memoria!.classificacao).toBe('dados-insuficientes');
  await expect(painel.getByTestId('memoria-classificacao')).toHaveText('Dados insuficientes');
});

test('sessão manual com "Memória": medição a cada 5 segundos e snapshot a pedido, sem classificação', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  test.slow();
  const { pagina, painel, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/vazamento-dom');
  await painel.getByTestId('analisar').click();
  await expect(painel.getByTestId('confirmacao-modo')).toHaveText('Sessão manual');
  await painel.getByTestId('verificacao-memoria').check();
  await painel.getByTestId('confirmar').click();
  await expect(painel.getByTestId('tirar-snapshot')).toBeVisible();
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(true);

  // A primeira medição sai ao iniciar; as seguintes, de 5 em 5 segundos.
  const medicoes = async (): Promise<number> => (await estadoGravado(serviceWorker))?.sessao?.dados.medicoes.length ?? 0;
  await expect.poll(medicoes).toBe(1);
  await expect(painel.getByTestId('status-heap')).toContainText('MB');
  const inicio = Date.now();
  await expect.poll(medicoes, { timeout: 15_000 }).toBe(2);
  expect(Date.now() - inicio).toBeGreaterThan(3000);

  await painel.getByTestId('tirar-snapshot').click();
  await expect(painel.getByTestId('status-snapshots')).toHaveText('1', { timeout: 30_000 });
  await pagina.getByTestId('abrir-componente').click();
  await pagina.getByTestId('fechar-componente').click();
  await painel.getByTestId('tirar-snapshot').click();
  await expect(painel.getByTestId('status-snapshots')).toHaveText('2', { timeout: 30_000 });

  await painel.getByTestId('parar').click();
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  expect(resultado.tipo).toBe('sessao-manual');
  expect(resultado.dados.snapshots.map((s) => s.rotulo)).toEqual(['manual-1', 'manual-2']);
  expect(resultado.dados.medicoes.length).toBeGreaterThanOrEqual(2);
  expect(resultado.dados.medicoes[0]).not.toHaveProperty('iteracao');
  // Sem classificação, mas com a comparação entre os dois censos pedidos.
  expect(resultado.memoria).toMatchObject({ classificacao: null, series: [] });
  expect(resultado.memoria!.comparacao!.construtores[0]).toMatchObject({ nome: 'HTMLLIElement', contagem: { variacao: 200 } });
  await expect(painel.getByTestId('memoria-classificacao')).toHaveCount(0);
  await expect(painel.getByTestId('memoria-sem-classificacao')).toBeVisible();
  await expect(painel.getByTestId('memoria-snapshot')).toHaveCount(2);
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(false);
});
