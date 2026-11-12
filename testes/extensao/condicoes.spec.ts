import { COMANDOS_DE_CONDICOES } from '../../extensao/background/condicoes.ts';
import {
  abrirPaginaEPainel,
  cenarioDaPaginaTeste,
  depuradorAnexado,
  executar,
  resultadoFinal,
  salvarCenario,
  scriptsRegistrados,
  tempoDeCpu,
  tempoDeRequisicao,
} from './apoio.ts';
import { expect, test } from './fixtures.ts';

const ABRIR_FECHAR = cenarioDaPaginaTeste('abrir-fechar');
const LATENCIA_PADRAO_MS = 150;

test('o chrome.debugger aceita todos os comandos de CDP usados pelas condições de teste', async ({ context, serviceWorker, idExtensao }) => {
  const { idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/limpa');
  // O `chrome.debugger` recusa domínios inteiros a extensões, e o transporte falso dos
  // testes unitários aceita qualquer coisa: só aqui um comando recusado aparece.
  const parametros: Record<string, object | undefined> = {
    'Emulation.setCPUThrottlingRate': { rate: 4 },
    'Network.emulateNetworkConditions': { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750 },
    'Network.setCacheDisabled': { cacheDisabled: true },
    'Network.clearBrowserCache': undefined,
    'Storage.clearDataForOrigin': { origin: 'http://localhost:4300', storageTypes: 'cache_storage' },
  };
  expect(Object.keys(parametros).sort()).toEqual([...COMANDOS_DE_CONDICOES].sort());

  const saida = await serviceWorker.evaluate(
    async ({ tabId, comandos }) => {
      const resultado: { metodo: string; erro: string | null }[] = [];
      await chrome.debugger.attach({ tabId }, '1.3');
      try {
        await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
        for (const [metodo, parametros] of comandos) {
          try {
            await chrome.debugger.sendCommand({ tabId }, metodo, parametros ?? undefined);
            resultado.push({ metodo, erro: null });
          } catch (erro) {
            resultado.push({ metodo, erro: erro instanceof Error ? erro.message : String(erro) });
          }
        }
        // Os de restauração, com os mesmos métodos.
        await chrome.debugger.sendCommand({ tabId }, 'Emulation.setCPUThrottlingRate', { rate: 1 });
        await chrome.debugger.sendCommand({ tabId }, 'Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        await chrome.debugger.sendCommand({ tabId }, 'Network.setCacheDisabled', { cacheDisabled: false });
      } finally {
        await chrome.debugger.detach({ tabId });
      }
      return resultado;
    },
    { tabId: idAba, comandos: Object.entries(parametros) as [string, object | undefined][] },
  );
  expect(saida).toEqual(COMANDOS_DE_CONDICOES.map((metodo) => ({ metodo, erro: null })));
});

test('com o perfil "padrao" o carregamento medido é mais lento do que sem throttling', async ({ context, serviceWorker, idExtensao }) => {
  test.slow();
  const { painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);

  /** TTFB do carregamento da URL inicial, como a extensão o mediu. */
  const carregar = async (throttling: 'nenhum' | 'padrao') => {
    await salvarCenario(painel, { ...ABRIR_FECHAR, execucao: { iteracoes: 1, throttling } });
    await executar(painel, { desmarcar: ['memoria', 'dom-listeners', 'cpu'] });
    const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');
    const documento = resultado.dados.documentos.filter((d) => d.url === ABRIR_FECHAR.url_inicial).at(-1);
    expect(documento?.metricas.TTFB).toBeGreaterThan(0);
    return { resultado, ttfb: documento!.metricas.TTFB!, fcp: documento!.metricas.FCP ?? null };
  };

  const semThrottling = await carregar('nenhum');
  const comThrottling = await carregar('padrao');

  // A latência de 150 ms entra em toda requisição: só o documento já passa disso.
  expect(semThrottling.ttfb).toBeLessThan(LATENCIA_PADRAO_MS);
  expect(comThrottling.ttfb).toBeGreaterThan(LATENCIA_PADRAO_MS);
  expect(comThrottling.ttfb).toBeGreaterThan(semThrottling.ttfb + 100);
  if (semThrottling.fcp !== null && comThrottling.fcp !== null) expect(comThrottling.fcp).toBeGreaterThan(semThrottling.fcp + 100);

  // O resultado registra os números aplicados, não só o nome do perfil.
  expect(comThrottling.resultado.condicoes).toEqual({
    perfil: 'padrao',
    cpu: 4,
    rede: { latenciaMs: 150, downloadKbps: 1600, uploadKbps: 750 },
    cacheDesligado: true,
    cacheLimpo: true,
    storageLimpo: [],
  });
  expect(semThrottling.resultado.condicoes).toMatchObject({ perfil: 'nenhum', cpu: 1, rede: null, cacheDesligado: true, cacheLimpo: true });
  expect(comThrottling.resultado.limpeza).toContainEqual({ recurso: 'condicao-de-teste', quantidade: 3 });
  await expect(painel.getByTestId('condicoes-cpu')).toHaveText('4×');
  await expect(painel.getByTestId('condicoes-latencia')).toHaveText('150 ms');
  await expect(painel.getByTestId('condicoes-cache')).toHaveText('limpo antes da análise; desligado durante');
});

test('perfil de throttling inexistente: a confirmação lista os disponíveis e não executa', async ({ context, serviceWorker, idExtensao }) => {
  const { painel, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, { ...ABRIR_FECHAR, execucao: { throttling: '3g' } });
  await painel.getByTestId('analisar').click();

  await expect(painel.getByTestId('confirmacao-impedimento')).toHaveText('O perfil de throttling "3g" não existe. Perfis disponíveis: "nenhum", "padrao".');
  await expect(painel.getByTestId('confirmar')).toBeDisabled();
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(false);
});

test('depois de execução concluída, cancelada e com erro, a aba fica sem throttling e sem debugger', async ({ context, serviceWorker, idExtensao }) => {
  test.slow();
  const { pagina, painel, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/limpa');
  const cpuAntes = await tempoDeCpu(pagina);
  expect(await tempoDeRequisicao(pagina)).toBeLessThan(LATENCIA_PADRAO_MS);

  const semCondicoes = async (): Promise<void> => {
    expect(await depuradorAnexado(serviceWorker, idAba)).toBe(false);
    expect(await scriptsRegistrados(serviceWorker)).toBe(0);
    // Rede: sem os 150 ms de latência. CPU: longe do fator 4 (a folga cobre o ruído da máquina).
    expect(await tempoDeRequisicao(pagina)).toBeLessThan(LATENCIA_PADRAO_MS);
    expect(await tempoDeCpu(pagina)).toBeLessThan(cpuAntes * 2.5);
  };

  // Concluída.
  await salvarCenario(painel, { ...ABRIR_FECHAR, execucao: { iteracoes: 2, throttling: 'padrao' } });
  await executar(painel, { desmarcar: ['memoria', 'dom-listeners', 'cpu'] });
  const concluida = await resultadoFinal(painel, serviceWorker, 'Concluída');
  expect(concluida.limpeza).toContainEqual({ recurso: 'condicao-de-teste', quantidade: 3 });
  await semCondicoes();

  // Cancelada, com o throttling comprovadamente ligado no momento do cancelamento.
  await salvarCenario(painel, { ...ABRIR_FECHAR, execucao: { iteracoes: 500, throttling: 'padrao' } });
  await executar(painel, { desmarcar: ['memoria', 'dom-listeners', 'cpu'] });
  await expect(painel.getByTestId('execucao-estado')).toHaveText('Executando');
  expect(await tempoDeRequisicao(pagina)).toBeGreaterThan(LATENCIA_PADRAO_MS);
  expect(await tempoDeCpu(pagina)).toBeGreaterThan(cpuAntes * 2.5);
  await painel.getByTestId('cancelar').click();
  const cancelada = await resultadoFinal(painel, serviceWorker, 'Análise cancelada');
  expect(cancelada.limpeza).toContainEqual({ recurso: 'condicao-de-teste', quantidade: 3 });
  await semCondicoes();

  // Com erro: um passo que nunca encontra o elemento.
  await salvarCenario(painel, {
    ...ABRIR_FECHAR,
    execucao: { iteracoes: 2, throttling: 'padrao' },
    aquecimento: [],
    passos: [{ tipo: 'clicar', seletor: '#nao-existe', tempo_limite_ms: 300 }],
  });
  await executar(painel, { desmarcar: ['memoria', 'dom-listeners', 'cpu'] });
  const comErro = await resultadoFinal(painel, serviceWorker, 'Erro na execução');
  expect(comErro.limpeza).toContainEqual({ recurso: 'condicao-de-teste', quantidade: 3 });
  await semCondicoes();
});

test('sessão manual: sem escolha nada muda na aba; com "padrao" escolhido, o throttling vale até parar', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, painel, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/limpa');

  await painel.getByTestId('analisar').click();
  await expect(painel.getByTestId('throttling-manual')).toHaveValue('nenhum');
  await painel.getByTestId('confirmar').click();
  await expect(painel.getByTestId('parar')).toBeVisible();
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(false);
  expect(await tempoDeRequisicao(pagina)).toBeLessThan(LATENCIA_PADRAO_MS);
  await painel.getByTestId('parar').click();
  const semEscolha = await resultadoFinal(painel, serviceWorker, 'Concluída');
  expect(semEscolha.condicoes).toEqual({ perfil: 'nenhum', cpu: 1, rede: null, cacheDesligado: false, cacheLimpo: false, storageLimpo: [] });

  await painel.getByTestId('analisar').click();
  await painel.getByTestId('throttling-manual').selectOption('padrao');
  await expect(painel.getByTestId('confirmacao-aviso-throttling')).toBeVisible();
  await painel.getByTestId('confirmar').click();
  await expect(painel.getByTestId('parar')).toBeVisible();
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(true);
  expect(await tempoDeRequisicao(pagina)).toBeGreaterThan(LATENCIA_PADRAO_MS);
  await painel.getByTestId('parar').click();
  const comEscolha = await resultadoFinal(painel, serviceWorker, 'Concluída');
  expect(comEscolha.condicoes).toMatchObject({ perfil: 'padrao', cpu: 4, cacheDesligado: false, cacheLimpo: false });
  expect(comEscolha.limpeza).toContainEqual({ recurso: 'condicao-de-teste', quantidade: 2 });
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(false);
  expect(await tempoDeRequisicao(pagina)).toBeLessThan(LATENCIA_PADRAO_MS);
});
