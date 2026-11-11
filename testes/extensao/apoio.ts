/** Passos comuns dos testes de integração que executam cenários pelo painel. */
import { readFileSync } from 'node:fs';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { Cenario } from '../../extensao/shared/cenario.ts';
import type { EstadoSessao, ResultadoSessao } from '../../extensao/shared/types.ts';
import { expect } from './fixtures.ts';

/** Lê um cenário de `pagina-teste/cenarios/`. */
export function cenarioDaPaginaTeste(nome: string): Cenario {
  return JSON.parse(readFileSync(`pagina-teste/cenarios/${nome}.json`, 'utf8')) as Cenario;
}

const CHAVE_ESTADO = 'sondagem:sessao';

/** Abre uma página qualquer da página de teste e o painel em aba própria, apontado para ela. */
export async function abrirPaginaEPainel(context: BrowserContext, serviceWorker: Worker, idExtensao: string, caminho = '/') {
  const pagina = await context.newPage();
  await pagina.goto(caminho);
  const idAba = await serviceWorker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((aba) => aba.url === url)?.id,
    pagina.url(),
  );
  expect(idAba).toBeDefined();
  const painel = await context.newPage();
  await painel.goto(`chrome-extension://${idExtensao}/index.html?aba=${idAba}#/painel`);
  await expect(painel.getByTestId('analisar')).toBeVisible();
  await pagina.bringToFront();
  return { pagina, painel, idAba: idAba! };
}

export async function estadoGravado(serviceWorker: Worker): Promise<EstadoSessao | undefined> {
  const itens = await serviceWorker.evaluate((chave) => chrome.storage.session.get(chave), CHAVE_ESTADO);
  return itens[CHAVE_ESTADO] as EstadoSessao | undefined;
}

export const scriptsRegistrados = (serviceWorker: Worker): Promise<number> =>
  serviceWorker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length);

/** `true` se o debugger da extensão está anexado à aba: só nesse caso um comando é aceito. */
export const depuradorAnexado = (serviceWorker: Worker, idAba: number): Promise<boolean> =>
  serviceWorker.evaluate(async (tabId) => {
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: '1' });
      return true;
    } catch {
      return false;
    }
  }, idAba);

/** Cola o cenário na tela de cenários e salva; ele fica selecionado. */
export async function salvarCenario(painel: Page, cenario: Cenario): Promise<void> {
  await painel.getByTestId('texto-cenario').fill(JSON.stringify(cenario, null, 2));
  await painel.getByTestId('salvar-cenario').click();
  await expect(painel.getByTestId(`selecionar-cenario-${cenario.nome}`)).toBeChecked();
}

/** "Analisar" → confirmação no modo cenário → executar. */
export async function executar(painel: Page, opcoes: { iteracoes?: number; versaoBuild?: string; desmarcar?: string[] } = {}): Promise<void> {
  await painel.getByTestId('analisar').click();
  await expect(painel.getByTestId('confirmacao-modo')).toHaveText('Cenário');
  if (opcoes.iteracoes !== undefined) await painel.getByTestId('confirmacao-iteracoes').fill(String(opcoes.iteracoes));
  if (opcoes.versaoBuild !== undefined) await painel.getByTestId('confirmacao-versao-build').fill(opcoes.versaoBuild);
  for (const id of opcoes.desmarcar ?? []) await painel.getByTestId(`verificacao-${id}`).uncheck();
  await painel.getByTestId('confirmar').click();
}

export async function resultadoFinal(painel: Page, serviceWorker: Worker, desfecho: string): Promise<ResultadoSessao> {
  await expect(painel.getByTestId('resultado-desfecho')).toHaveText(desfecho, { timeout: 60_000 });
  return (await estadoGravado(serviceWorker))!.resultado!;
}
