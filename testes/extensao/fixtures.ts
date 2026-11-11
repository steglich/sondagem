import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type BrowserContext, type Page, type Worker, test as base, chromium } from '@playwright/test';

const PASTA_EXTENSAO = resolve('dist/extensao');

interface Fixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  idExtensao: string;
}

/** Contexto persistente do Chromium com a extensão de dist/extensao/ carregada. */
export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!existsSync(join(PASTA_EXTENSAO, 'manifest.json'))) {
      throw new Error('dist/extensao/ não existe. Rode `npm run build` antes dos testes de integração.');
    }
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${PASTA_EXTENSAO}`, `--load-extension=${PASTA_EXTENSAO}`],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    const [existente] = context.serviceWorkers();
    await use(existente ?? (await context.waitForEvent('serviceworker')));
  },
  idExtensao: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

export const expect = test.expect;

/** Coleta erros de console (inclusive violações de CSP) e exceções não tratadas da página. */
export function coletarErros(pagina: Page): string[] {
  const erros: string[] = [];
  pagina.on('console', (mensagem) => {
    if (mensagem.type() === 'error') erros.push(mensagem.text());
  });
  pagina.on('pageerror', (erro) => erros.push(erro.message));
  return erros;
}
