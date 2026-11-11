import type { CDPSession, Page } from '@playwright/test';

export const CICLOS = 10;

export interface ContadoresDom {
  nodes: number;
  jsEventListeners: number;
}

/** Força uma coleta de lixo e lê os contadores de nós e listeners do renderer. */
export async function contadoresAposGc(cdp: CDPSession): Promise<ContadoresDom> {
  await cdp.send('HeapProfiler.collectGarbage');
  const { nodes, jsEventListeners } = await cdp.send('Memory.getDOMCounters');
  return { nodes, jsEventListeners };
}

/**
 * A primeira interação do Playwright com cada elemento cria alguns nós e listeners
 * próprios dele (custo fixo, não cresce com os ciclos). Passar o mouse pelos botões
 * antes da linha de base tira esse ruído sem alterar o estado da página.
 */
export async function aquecer(pagina: Page): Promise<void> {
  await pagina.getByTestId('abrir-componente').hover();
  await pagina.getByTestId('fechar-componente').hover();
}

export async function ciclosAbrirFechar(pagina: Page, ciclos = CICLOS): Promise<void> {
  for (let i = 0; i < ciclos; i++) {
    await pagina.getByTestId('abrir-componente').click();
    await pagina.getByTestId('fechar-componente').click();
  }
}
