import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { EstadoSessao } from '../../extensao/shared/types.ts';
import { coletarErros, expect, test } from './fixtures.ts';

const CHAVE_ESTADO = 'sondagem:sessao';

/** Abre um caso da página de teste e o painel em aba própria, apontado para ela. */
async function abrirPaginaEPainel(context: BrowserContext, serviceWorker: Worker, idExtensao: string, caminho: string) {
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
  return { pagina, painel };
}

/**
 * Conta quantas vezes o bundle de medição foi carregado na página. Contar os
 * mundos isolados não serve aqui: depois que um content script roda em um frame,
 * o Chrome recria o mundo (vazio) nos documentos seguintes, mesmo sem injetar nada.
 */
async function observarInjecoes(context: BrowserContext, pagina: Page) {
  const cdp = await context.newCDPSession(pagina);
  let injecoes = 0;
  cdp.on('Debugger.scriptParsed', ({ url }) => {
    if (url.startsWith('chrome-extension://') && url.endsWith('/injected.js')) injecoes++;
  });
  await cdp.send('Debugger.enable');
  return () => injecoes;
}

async function estadoGravado(serviceWorker: Worker): Promise<EstadoSessao | undefined> {
  const itens = await serviceWorker.evaluate((chave) => chrome.storage.session.get(chave), CHAVE_ESTADO);
  return itens[CHAVE_ESTADO] as EstadoSessao | undefined;
}

const scriptsRegistrados = (serviceWorker: Worker): Promise<number> =>
  serviceWorker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length);

/** Clica em "Analisar" e confirma, opcionalmente desmarcando verificações. */
async function iniciarSessao(painel: Page, desmarcar: string[] = []): Promise<void> {
  await painel.getByTestId('analisar').click();
  for (const id of desmarcar) await painel.getByTestId(`verificacao-${id}`).uncheck();
  await painel.getByTestId('confirmar').click();
  await expect(painel.getByTestId('parar')).toBeVisible();
}

test('o script só está na página depois do início da sessão', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/cpu-pesada');
  const injecoes = await observarInjecoes(context, pagina);
  const erros = coletarErros(painel);

  // Painel aberto e tela de confirmação exibida: ainda nada na página.
  await painel.getByTestId('analisar').click();
  await expect(painel.getByTestId('confirmacao-url')).toHaveText(pagina.url());
  expect(injecoes()).toBe(0);
  expect(await scriptsRegistrados(serviceWorker)).toBe(0);
  expect((await estadoGravado(serviceWorker))?.fase ?? 'ociosa').toBe('ociosa');

  await painel.getByTestId('confirmar').click();
  await expect(painel.getByTestId('parar')).toBeVisible();

  await expect.poll(injecoes).toBe(1);
  expect(await scriptsRegistrados(serviceWorker)).toBe(1);
  expect(await estadoGravado(serviceWorker)).toMatchObject({
    fase: 'ativa',
    sessao: { tipo: 'sessao-manual', url: pagina.url(), idsScripts: ['sondagem-sessao'] },
  });
  expect(erros).toEqual([]);
});

test('desistir na confirmação não injeta nada', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/limpa');
  const injecoes = await observarInjecoes(context, pagina);

  await painel.getByTestId('analisar').click();
  await painel.getByTestId('desistir').click();
  await expect(painel.getByTestId('analisar')).toBeVisible();

  expect(injecoes()).toBe(0);
  expect(await scriptsRegistrados(serviceWorker)).toBe(0);
});

test('/cpu-pesada: a ação pesada aparece como long task acima de 200 ms e como interação', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/cpu-pesada');
  await iniciarSessao(painel);

  await pagina.getByTestId('acao-pesada').click();
  await expect(pagina.getByTestId('resultado-pesado')).not.toHaveText('—');

  // Durante a sessão o painel mostra só o resumo.
  await expect(painel.getByTestId('status-long-tasks')).not.toHaveText('0');
  await expect(painel.getByTestId('status-interacoes')).not.toHaveText('0');
  await expect(painel.getByTestId('lista-long-tasks')).toHaveCount(0);
  // A web-vitals calcula o INP quando a página fica ociosa, logo depois da interação.
  await expect
    .poll(async () => (await estadoGravado(serviceWorker))?.sessao?.dados.documentos.at(-1)?.metricas.INP ?? 0)
    .toBeGreaterThan(200);

  await painel.getByTestId('parar').click();
  await expect(painel.getByTestId('resultado-tipo')).toHaveText('Sessão manual');
  await expect(painel.getByTestId('resultado-desfecho')).toHaveText('Concluída');

  const resultado = (await estadoGravado(serviceWorker))?.resultado;
  const longas = resultado?.dados.longTasks.filter((tarefa) => tarefa.duracao > 200) ?? [];
  expect(longas.length).toBeGreaterThanOrEqual(1);

  const interacao = resultado?.dados.interacoes.find((i) => i.alvo === 'button[data-testid="acao-pesada"]');
  expect(interacao).toBeDefined();
  expect(interacao!.duracao).toBeGreaterThan(200);
  // A long task acontece no instante do clique: começa dentro da interação.
  expect(longas.some((t) => t.inicio >= interacao!.inicio - 50 && t.inicio <= interacao!.inicio + interacao!.duracao)).toBe(
    true,
  );
  const inp = resultado?.dados.documentos.map((d) => d.metricas.INP).find((valor) => valor !== undefined);
  expect(inp).toBeGreaterThan(200);

  await expect(painel.getByTestId('interacao').first()).toContainText('acao-pesada');
  await expect(painel.getByTestId('metrica-inp')).not.toHaveText('indisponível');
  await expect(painel.getByTestId('limpeza-concluida')).toBeVisible();
});

test('durante a sessão o script acompanha recargas; depois de "Parar", uma recarga não o recebe', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/cpu-pesada');
  const injecoes = await observarInjecoes(context, pagina);
  await iniciarSessao(painel);
  await expect.poll(injecoes).toBe(1);
  await expect(painel.getByTestId('status-carregamentos')).toHaveText('1');

  await pagina.reload();
  await expect.poll(injecoes).toBe(2);
  await expect(painel.getByTestId('status-carregamentos')).toHaveText('2');

  await painel.getByTestId('parar').click();
  await expect(painel.getByTestId('limpeza-concluida')).toBeVisible();
  expect(await scriptsRegistrados(serviceWorker)).toBe(0);

  await pagina.reload();
  await pagina.waitForLoadState('networkidle');
  expect(injecoes()).toBe(2);
});

test('só com "Carregamento": métricas do carregamento, sem long tasks nem interações', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/cpu-pesada');
  await iniciarSessao(painel, ['processamento']);

  await pagina.reload();
  await pagina.getByTestId('acao-pesada').click();
  await expect(pagina.getByTestId('resultado-pesado')).not.toHaveText('—');
  await expect
    .poll(async () => (await estadoGravado(serviceWorker))?.sessao?.dados.documentos.at(-1)?.metricas.LCP)
    .toBeGreaterThan(0);

  await painel.getByTestId('parar').click();
  await expect(painel.getByTestId('resultado-desfecho')).toHaveText('Concluída');

  const resultado = (await estadoGravado(serviceWorker))?.resultado;
  expect(resultado?.selecao).toEqual(['carregamento']);
  expect(resultado?.dados.longTasks).toEqual([]);
  expect(resultado?.dados.interacoes).toEqual([]);
  const recarga = resultado?.dados.documentos.at(-1)?.metricas;
  expect(recarga?.LCP).toBeGreaterThan(0);
  expect(recarga?.FCP).toBeGreaterThan(0);
  expect(recarga?.TTFB).toBeGreaterThanOrEqual(0);
  expect(recarga?.CLS).toBeGreaterThanOrEqual(0);
  expect(recarga?.INP).toBeUndefined();

  await expect(painel.getByTestId('lista-long-tasks')).toHaveCount(0);
  await expect(painel.getByTestId('metrica-lcp').last()).not.toHaveText('indisponível');

  // A seleção usada volta marcada na próxima confirmação.
  await painel.getByTestId('analisar').click();
  await expect(painel.getByTestId('verificacao-processamento')).not.toBeChecked();
  await expect(painel.getByTestId('verificacao-carregamento')).toBeChecked();
});

test('fechar a aba durante a sessão produz resultado "interrompida" com os dados recebidos', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/cpu-pesada');
  await iniciarSessao(painel);

  await pagina.getByTestId('acao-pesada').click();
  await expect(painel.getByTestId('status-long-tasks')).not.toHaveText('0');

  await pagina.close();

  await expect(painel.getByTestId('resultado-desfecho')).toHaveText('Interrompida');
  await expect(painel.getByTestId('resultado-interrompida')).toBeVisible();
  await expect(painel.getByTestId('long-task').first()).toBeVisible();

  const estado = await estadoGravado(serviceWorker);
  expect(estado).toMatchObject({ fase: 'ociosa', sessao: null, resultado: { desfecho: 'interrompida' } });
  expect(estado?.resultado?.dados.longTasks.some((tarefa) => tarefa.duracao > 200)).toBe(true);
  expect(await scriptsRegistrados(serviceWorker)).toBe(0);
});

test('cancelar remove tudo e indica que a análise foi cancelada', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/cpu-pesada');
  const injecoes = await observarInjecoes(context, pagina);
  await iniciarSessao(painel);

  await painel.getByTestId('cancelar').click();
  await expect(painel.getByTestId('resultado-desfecho')).toHaveText('Análise cancelada');
  await expect(painel.getByTestId('item-limpeza').first()).toBeVisible();
  expect(await scriptsRegistrados(serviceWorker)).toBe(0);

  await pagina.reload();
  await pagina.waitForLoadState('networkidle');
  expect(injecoes()).toBe(1);
});

test('recarregar a página ou reabrir o painel não inicia sessão', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/cpu-pesada');
  const injecoes = await observarInjecoes(context, pagina);

  await pagina.reload();
  await pagina.waitForLoadState('networkidle');
  await painel.reload();
  await expect(painel.getByTestId('analisar')).toBeVisible();
  const outroPainel = await context.newPage();
  await outroPainel.goto(painel.url());
  await expect(outroPainel.getByTestId('analisar')).toBeVisible();

  expect(injecoes()).toBe(0);
  expect(await scriptsRegistrados(serviceWorker)).toBe(0);
  expect((await estadoGravado(serviceWorker))?.fase ?? 'ociosa').toBe('ociosa');

  // O mesmo vale depois de uma análise concluída.
  await painel.bringToFront();
  await iniciarSessao(painel);
  await painel.getByTestId('parar').click();
  await expect(painel.getByTestId('limpeza-concluida')).toBeVisible();

  await pagina.reload();
  await pagina.waitForLoadState('networkidle');
  await painel.reload();
  await expect(painel.getByTestId('analisar')).toBeVisible();
  await expect(painel.getByTestId('resultado-tipo')).toHaveText('Sessão manual');

  // Só a injeção da própria sessão; a recarga depois dela não trouxe o script.
  expect(injecoes()).toBe(1);
  expect((await estadoGravado(serviceWorker))?.fase).toBe('ociosa');
});

test('a sessão manual não dispara cliques, teclas nem navegação na página', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/cpu-pesada');

  // Conta, na própria página, qualquer evento de entrada e mudança no DOM.
  await pagina.evaluate(() => {
    const registro = { eventos: 0, mutacoes: 0 };
    for (const tipo of ['click', 'pointerdown', 'keydown', 'input', 'submit', 'scroll']) {
      addEventListener(tipo, () => registro.eventos++, true);
    }
    new MutationObserver((lista) => (registro.mutacoes += lista.length)).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    (window as unknown as { registroTeste: typeof registro }).registroTeste = registro;
  });
  const globaisAntes = await pagina.evaluate(() => Object.getOwnPropertyNames(window).sort());
  let navegacoes = 0;
  pagina.on('framenavigated', () => navegacoes++);

  await iniciarSessao(painel);
  await pagina.waitForTimeout(2500);
  await painel.getByTestId('parar').click();
  await expect(painel.getByTestId('limpeza-concluida')).toBeVisible();

  expect(await pagina.evaluate(() => (window as unknown as { registroTeste: unknown }).registroTeste)).toEqual({
    eventos: 0,
    mutacoes: 0,
  });
  expect(navegacoes).toBe(0);
  expect(await pagina.getByTestId('resultado-pesado').textContent()).toBe('—');
  // O objeto global da página não ganhou propriedades.
  expect(await pagina.evaluate(() => Object.getOwnPropertyNames(window).sort())).toEqual(globaisAntes);
});

test('após "Parar", nenhum observador ou porta permanece', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/cpu-pesada');
  await iniciarSessao(painel);
  await pagina.getByTestId('acao-pesada').click();
  await expect(painel.getByTestId('status-long-tasks')).not.toHaveText('0');

  await painel.getByTestId('parar').click();
  await expect(painel.getByTestId('limpeza-concluida')).toBeVisible();

  // A limpeza relata observadores, listeners, temporizadores, porta e script removidos.
  const depoisDeParar = await estadoGravado(serviceWorker);
  const removidos = Object.fromEntries(depoisDeParar!.resultado!.limpeza.map((item) => [item.recurso, item.quantidade]));
  expect(depoisDeParar?.resultado?.paginaRespondeu).toBe(true);
  expect(removidos['script-registrado']).toBe(1);
  expect(removidos['porta']).toBe(1);
  expect(removidos['observador']).toBeGreaterThanOrEqual(2);
  expect(removidos['listener']).toBeGreaterThanOrEqual(1);
  expect(removidos['temporizador']).toBeGreaterThanOrEqual(1);
  await expect(painel.getByTestId('item-limpeza')).toHaveCount(5);

  // Nova ação pesada na mesma página, sem recarregar: se sobrasse observador ou
  // porta, um lote chegaria ao service worker em até um segundo.
  await pagina.bringToFront();
  const antes = await pagina.getByTestId('resultado-pesado').textContent();
  await pagina.getByTestId('acao-pesada').click();
  await expect(pagina.getByTestId('resultado-pesado')).not.toHaveText(antes ?? '');
  await pagina.waitForTimeout(2500);

  expect(await estadoGravado(serviceWorker)).toEqual(depoisDeParar);
  expect(await scriptsRegistrados(serviceWorker)).toBe(0);
});

test('não inicia em página que não pode ser analisada', async ({ context, idExtensao }) => {
  // Sem o parâmetro `aba`, o painel aberto em aba própria tem a si mesmo como aba ativa.
  const painel = await context.newPage();
  await painel.goto(`chrome-extension://${idExtensao}/index.html#/painel`);
  await painel.getByTestId('analisar').click();

  await expect(painel.getByTestId('confirmar')).toBeDisabled();
  await expect(painel.getByTestId('confirmacao-impedimento')).toContainText('não podem ser analisadas');
});
