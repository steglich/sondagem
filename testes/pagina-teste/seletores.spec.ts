import { expect, test } from '@playwright/test';

const PAGINAS = ['/', '/limpa', '/vazamento-listener', '/vazamento-dom', '/cpu-pesada'];
const INTERATIVOS = 'a[href], button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

for (const caminho of PAGINAS) {
  test(`${caminho}: todo elemento interativo tem data-testid único`, async ({ page }) => {
    await page.goto(caminho);
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
