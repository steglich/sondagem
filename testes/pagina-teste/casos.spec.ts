import { expect, test } from '@playwright/test';
import { CHAVE_PREFERENCIA, COOKIE_SESSAO } from '../../pagina-teste/sessao.ts';
import { CICLOS, aquecer, ciclosAbrirFechar, contadoresAposGc } from './apoio.ts';

test('o índice lista os casos', async ({ page }) => {
  const resposta = await page.goto('/');
  expect(resposta?.status()).toBe(200);
  for (const caso of ['limpa', 'vazamento-listener', 'vazamento-dom', 'cpu-pesada', 'erros', 'login', 'protegida']) {
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

test('/protegida: sem o cookie de sessão, o servidor redireciona para o login', async ({ page }) => {
  await page.goto('/protegida?expira=3');
  expect(page.url()).toBe('http://localhost:4300/login?voltar=%2Fprotegida%3Fexpira%3D3');
  await expect(page.getByTestId('motivo-login')).toHaveText('Você precisa entrar para ver a página protegida.');
});

test('/login: entrar grava o cookie de sessão e a preferência, e volta para a página pedida', async ({ page, context }) => {
  await page.goto('/protegida');
  await page.getByTestId('campo-usuario').fill('maria');
  await page.getByTestId('campo-senha').fill('qualquer');
  await page.getByTestId('entrar').click();

  await expect(page).toHaveURL('http://localhost:4300/protegida');
  await expect(page.getByTestId('usuario-logado')).toHaveText('maria');
  expect((await context.cookies()).find((cookie) => cookie.name === COOKIE_SESSAO)).toMatchObject({ value: 'ativa', expires: -1 });
  expect(await page.evaluate((chave) => localStorage.getItem(chave), CHAVE_PREFERENCIA)).toBe('maria');
  // O valor de `voltar` só aceita caminhos da própria página de teste.
  await page.goto('/login?voltar=https://exemplo.invalid/');
  await page.getByTestId('entrar').click();
  await expect(page).toHaveURL('http://localhost:4300/protegida');
});

test('/protegida: "Sair" e a expiração por ciclos apagam o cookie e levam ao login', async ({ page, context }) => {
  await context.addCookies([{ name: COOKIE_SESSAO, value: 'ativa', url: 'http://localhost:4300' }]);
  await page.goto('/protegida?expira=2');
  await ciclosAbrirFechar(page, 1);
  await expect(page).toHaveURL('http://localhost:4300/protegida?expira=2');
  expect(await page.evaluate(() => window.estadoTeste.ciclos)).toBe(1);

  await ciclosAbrirFechar(page, 1);
  await expect(page).toHaveURL(/\/login\?voltar=/);
  expect((await context.cookies()).some((cookie) => cookie.name === COOKIE_SESSAO)).toBe(false);

  await context.addCookies([{ name: COOKIE_SESSAO, value: 'ativa', url: 'http://localhost:4300' }]);
  await page.goto('/protegida');
  await page.getByTestId('sair').click();
  await expect(page).toHaveURL(/\/login\?voltar=%2Fprotegida$/);
});
