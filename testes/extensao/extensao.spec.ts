import { coletarErros, expect, test } from './fixtures.ts';

test('o service worker registra e configura a abertura do side panel pelo ícone', async ({ serviceWorker }) => {
  expect(new URL(serviceWorker.url()).pathname).toBe('/service-worker.js');

  const estado = await serviceWorker.evaluate(async () => ({
    comportamento: await chrome.sidePanel.getPanelBehavior(),
    permissoes: chrome.runtime.getManifest().permissions,
  }));
  expect(estado.comportamento.openPanelOnActionClick).toBe(true);
  expect(estado.permissoes).toEqual(['sidePanel', 'storage', 'scripting', 'tabs', 'debugger', 'management']);
});

test('o painel renderiza pela URL direta, sem erros de console nem violações de CSP', async ({ context, idExtensao }) => {
  const painel = await context.newPage();
  const erros = coletarErros(painel);

  await painel.goto(`chrome-extension://${idExtensao}/index.html#/painel`);

  await expect(painel.getByRole('heading', { name: 'Sondagem' })).toBeVisible();
  await expect(painel.getByTestId('abrir-relatorio')).toBeVisible();
  expect(erros).toEqual([]);
});

test('o botão do painel abre o relatório em nova aba, sem erros', async ({ context, idExtensao }) => {
  const painel = await context.newPage();
  await painel.goto(`chrome-extension://${idExtensao}/index.html#/painel`);

  const [relatorio] = await Promise.all([context.waitForEvent('page'), painel.getByTestId('abrir-relatorio').click()]);
  const erros = coletarErros(relatorio);
  await relatorio.waitForLoadState();

  expect(relatorio.url()).toBe(`chrome-extension://${idExtensao}/index.html#/relatorio`);
  await expect(relatorio.getByRole('heading', { name: 'Relatório' })).toBeVisible();
  expect(erros).toEqual([]);
});

test('nenhuma página comum recebe script da extensão', async ({ context }) => {
  const pagina = await context.newPage();
  const cdp = await context.newCDPSession(pagina);
  const contextos: { origin: string; tipo: string | undefined; nome: string }[] = [];
  cdp.on('Runtime.executionContextCreated', ({ context: c }) => {
    contextos.push({ origin: c.origin, tipo: c.auxData?.['type'], nome: c.name });
  });
  await cdp.send('Runtime.enable');

  await pagina.goto('/limpa');
  await pagina.waitForLoadState('networkidle');

  // Content scripts rodam em "isolated worlds" com o nome da extensão. Os mundos
  // utilitários do próprio Playwright são ignorados.
  const daExtensao = contextos.filter(
    (c) =>
      !c.nome.startsWith('__playwright') &&
      (c.tipo === 'isolated' || c.nome === 'Sondagem' || c.origin.startsWith('chrome-extension://')),
  );
  expect(daExtensao).toEqual([]);

  const recursosDaExtensao = await pagina.evaluate(() =>
    [
      ...performance.getEntriesByType('resource').map((r) => r.name),
      ...Array.from(document.scripts, (s) => s.src),
    ].filter((url) => url.startsWith('chrome-extension://')),
  );
  expect(recursosDaExtensao).toEqual([]);
});
