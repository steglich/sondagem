import { expect, test } from '@playwright/test';
import { COOKIE_SESSAO } from '../../pagina-teste/sessao.ts';

const PAGINAS = ['/', '/limpa', '/vazamento-listener', '/vazamento-dom', '/cpu-pesada', '/erros', '/login', '/protegida'];
const INTERATIVOS = 'a[href], button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

for (const caminho of PAGINAS) {
  test(`${caminho}: todo elemento interativo tem data-testid único`, async ({ page, context }) => {
    // A página protegida só abre com o cookie do login simulado.
    if (caminho === '/protegida') await context.addCookies([{ name: COOKIE_SESSAO, value: 'ativa', url: 'http://localhost:4300' }]);
    await page.goto(caminho);
    expect(new URL(page.url()).pathname).toBe(caminho);
    const elementos = await page.locator(INTERATIVOS).evaluateAll((lista) =>
      lista.map((el) => ({ tag: el.tagName.toLowerCase(), testid: el.getAttribute('data-testid') })),
    );
    expect(elementos.length).toBeGreaterThan(0);
    expect(elementos.filter((e) => !e.testid)).toEqual([]);

    for (const { testid } of elementos) {
      await expect(page.locator(`[data-testid="${testid}"]`)).toHaveCount(1);
    }
  });
}
