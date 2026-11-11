import { expect, test } from '@playwright/test';
import { CICLOS, aquecer, ciclosAbrirFechar, contadoresAposGc } from './apoio.ts';

test('o índice lista os cinco casos', async ({ page }) => {
  const resposta = await page.goto('/');
  expect(resposta?.status()).toBe(200);
  for (const caso of ['limpa', 'vazamento-listener', 'vazamento-dom', 'cpu-pesada', 'erros']) {
    await expect(page.getByTestId(`caso-${caso}`)).toHaveAttribute('href', `/${caso}`);
  }
});

test('/limpa: 10 ciclos não aumentam nós nem listeners', async ({ page }) => {
  await page.goto('/limpa');
  const cdp = await page.context().newCDPSession(page);
  await aquecer(page);
  const antes = await contadoresAposGc(cdp);

  await ciclosAbrirFechar(page);

  const depois = await contadoresAposGc(cdp);
  expect(await page.evaluate(() => window.estadoTeste)).toEqual({ ciclos: CICLOS, listenersAtivos: 0 });
  expect(depois.nodes).toBeLessThanOrEqual(antes.nodes);
  expect(depois.jsEventListeners).toBeLessThanOrEqual(antes.jsEventListeners);
});

test('/vazamento-listener: 10 ciclos deixam 10 listeners registrados', async ({ page }) => {
  await page.goto('/vazamento-listener');
  const cdp = await page.context().newCDPSession(page);
  await aquecer(page);
  const antes = await contadoresAposGc(cdp);

  await ciclosAbrirFechar(page);

  const depois = await contadoresAposGc(cdp);
  expect(await page.evaluate(() => window.estadoTeste)).toEqual({ ciclos: CICLOS, listenersAtivos: CICLOS });
  expect(depois.jsEventListeners - antes.jsEventListeners).toBeGreaterThanOrEqual(CICLOS);
});

test('/vazamento-dom: os nós dos 10 ciclos ficam retidos e desanexados', async ({ page }) => {
  await page.goto('/vazamento-dom');
  const cdp = await page.context().newCDPSession(page);
  await aquecer(page);
  const antes = await contadoresAposGc(cdp);

  await ciclosAbrirFechar(page);

  const depois = await contadoresAposGc(cdp);
  const retidos = await page.evaluate(() => ({
    quantidade: window.nosRetidos?.length,
    anexados: window.nosRetidos?.filter((no) => no.isConnected).length,
    itens: window.nosRetidos?.map((no) => no.querySelectorAll('li').length),
  }));
  expect(retidos.quantidade).toBe(CICLOS);
  expect(retidos.anexados).toBe(0);
  expect(retidos.itens?.every((n) => n > 0)).toBe(true);
  expect(depois.nodes).toBeGreaterThan(antes.nodes);
});

test('/cpu-pesada: o clique dura mais de 200 ms', async ({ page }) => {
  await page.goto('/cpu-pesada');
  // Event Timing: a mesma fonte que a extensão usa para interações lentas.
  const duracao = page.evaluate(
    () =>
      new Promise<number>((resolver) => {
        // O cast é porque durationThreshold ainda não está nos tipos do DOM do TypeScript.
        new PerformanceObserver((lista) => {
          const clique = lista.getEntries().find((e) => e.name === 'click');
          if (clique) resolver(clique.duration);
        }).observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
      }),
  );

  await page.getByTestId('acao-pesada').click();

  expect(await duracao).toBeGreaterThan(200);
  await expect(page.getByTestId('resultado-pesado')).not.toHaveText('—');
});
