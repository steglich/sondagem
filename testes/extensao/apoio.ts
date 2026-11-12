/** Passos comuns dos testes de integração que executam cenários pelo painel. */
import { readFileSync } from 'node:fs';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { Cenario } from '../../extensao/shared/cenario.ts';
import { type ExecucaoGuardada, resultadoDoRegistro } from '../../extensao/shared/historico.ts';
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

/** Lê do IndexedDB da extensão, pelo service worker, o registro e os detalhes de cada execução. */
export function historico(serviceWorker: Worker): Promise<ExecucaoGuardada[]> {
  return serviceWorker.evaluate(async () => {
    const banco = await new Promise<IDBDatabase>((resolver, rejeitar) => {
      const pedido = indexedDB.open('sondagem');
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => rejeitar(pedido.error);
    });
    try {
      // Antes da primeira análise o banco ainda não tem os stores.
      if (!banco.objectStoreNames.contains('execucoes')) return [];
      const transacao = banco.transaction(['execucoes', 'detalhes'], 'readonly');
      const todos = <T>(store: string): Promise<T[]> =>
        new Promise((resolver, rejeitar) => {
          const pedido = transacao.objectStore(store).getAll();
          pedido.onsuccess = () => resolver(pedido.result as T[]);
          pedido.onerror = () => rejeitar(pedido.error);
        });
      const [registros, detalhes] = await Promise.all([todos<{ id: string; inicio: number }>('execucoes'), todos<{ id: string; dados: unknown }>('detalhes')]);
      return registros
        .sort((a, b) => b.inicio - a.inicio)
        .map((registro) => ({ registro, dados: detalhes.find((d) => d.id === registro.id)?.dados })) as never;
    } finally {
      banco.close();
    }
  });
}

/**
 * Estado da sessão em `chrome.storage.session`, com o último resultado, que mora
 * no histórico (IndexedDB) e é achado pelo `idResultado`.
 */
export async function estadoGravado(serviceWorker: Worker): Promise<EstadoSessao | undefined> {
  const itens = await serviceWorker.evaluate((chave) => chrome.storage.session.get(chave), CHAVE_ESTADO);
  const estado = itens[CHAVE_ESTADO] as EstadoSessao | undefined;
  if (!estado?.idResultado) return estado;
  const guardada = (await historico(serviceWorker)).find((g) => g.registro.id === estado.idResultado);
  return { ...estado, resultado: guardada ? resultadoDoRegistro(guardada) : null };
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

interface OpcoesExecucao {
  iteracoes?: number;
  versaoBuild?: string;
  desmarcar?: string[];
  /** Marca a confirmação específica da limpeza de storage (cenário com `limpar_storage`). */
  confirmarLimpeza?: boolean;
}

/** "Analisar" → confirmação no modo cenário → executar. */
export async function executar(painel: Page, opcoes: OpcoesExecucao = {}): Promise<void> {
  await painel.getByTestId('analisar').click();
  await expect(painel.getByTestId('confirmacao-modo')).toHaveText('Cenário');
  if (opcoes.iteracoes !== undefined) await painel.getByTestId('confirmacao-iteracoes').fill(String(opcoes.iteracoes));
  if (opcoes.versaoBuild !== undefined) await painel.getByTestId('confirmacao-versao-build').fill(opcoes.versaoBuild);
  for (const id of opcoes.desmarcar ?? []) await painel.getByTestId(`verificacao-${id}`).uncheck();
  if (opcoes.confirmarLimpeza) await painel.getByTestId('confirmar-limpeza-storage').check();
  await painel.getByTestId('confirmar').click();
}

/** Tempo, em ms, de uma requisição feita pela página à própria origem, sem cache. Com throttling de rede, passa da latência. */
export const tempoDeRequisicao = (pagina: Page): Promise<number> =>
  pagina.evaluate(async () => {
    const inicio = performance.now();
    await (await fetch(`/estilo.css?sem-cache=${Math.random()}`, { cache: 'no-store' })).text();
    return performance.now() - inicio;
  });

/** Tempo, em ms, de um laço fixo na página. Com throttling de CPU 4×, fica perto de 4 vezes maior. */
export const tempoDeCpu = (pagina: Page): Promise<number> =>
  pagina.evaluate(() => {
    const medir = (): number => {
      const inicio = performance.now();
      let soma = 0;
      for (let i = 0; i < 30_000_000; i++) soma += i % 7;
      return soma > 0 ? performance.now() - inicio : 0;
    };
    // A melhor de três: tira o ruído de uma coleta de lixo ou de outra aba.
    return Math.min(medir(), medir(), medir());
  });

export async function resultadoFinal(painel: Page, serviceWorker: Worker, desfecho: string): Promise<ResultadoSessao> {
  await expect(painel.getByTestId('resultado-desfecho')).toHaveText(desfecho, { timeout: 60_000 });
  return (await estadoGravado(serviceWorker))!.resultado!;
}
