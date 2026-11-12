import type { BrowserContext, Page } from '@playwright/test';
import { CHAVE_PREFERENCIA, COOKIE_SESSAO } from '../../pagina-teste/sessao.ts';
import { abrirPaginaEPainel, cenarioDaPaginaTeste, depuradorAnexado, executar, historico, resultadoFinal, salvarCenario } from './apoio.ts';
import { expect, test } from './fixtures.ts';

const PROTEGIDA = 'http://localhost:4300/protegida';

/** Entra pelo login simulado, como um usuário: cookie de sessão e preferência no `localStorage`. */
async function entrar(pagina: Page, usuario = 'maria'): Promise<void> {
  await pagina.goto('/login');
  await pagina.getByTestId('campo-usuario').fill(usuario);
  await pagina.getByTestId('campo-senha').fill('qualquer');
  await pagina.getByTestId('entrar').click();
  await expect(pagina).toHaveURL(PROTEGIDA);
}

const cookieDeSessao = async (context: BrowserContext) => (await context.cookies()).find((cookie) => cookie.name === COOKIE_SESSAO)?.value;
const preferencia = (pagina: Page) => pagina.evaluate((chave) => localStorage.getItem(chave), CHAVE_PREFERENCIA);

test('depois de uma execução completa em aplicação autenticada, o cookie e o localStorage permanecem', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, painel, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await entrar(pagina);
  await pagina.evaluate(() => {
    sessionStorage.setItem('rascunho', 'texto em edição');
    localStorage.setItem('tema', 'escuro');
  });
  // Um Cache Storage da origem, que a limpeza padrão tem de apagar (e só ele).
  await pagina.evaluate(async () => void (await (await caches.open('recursos')).put('/estilo.css', new Response('x'))));

  await salvarCenario(painel, cenarioDaPaginaTeste('sessao-preservada'));
  await executar(painel);
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  expect(resultado.cenario).toMatchObject({ iteracoesCompletas: 3, falhaDeSessao: null });
  expect(resultado.condicoes).toMatchObject({ cacheLimpo: true, cacheDesligado: true, storageLimpo: [] });
  // A limpeza de cache aconteceu...
  expect(await pagina.evaluate(() => caches.keys())).toEqual([]);
  // ...e a sessão ficou intacta: cookie, localStorage e sessionStorage.
  expect(await cookieDeSessao(context)).toBe('ativa');
  expect(await preferencia(pagina)).toBe('maria');
  expect(await pagina.evaluate(() => [localStorage.getItem('tema'), sessionStorage.getItem('rascunho')])).toEqual(['escuro', 'texto em edição']);
  // O usuário continua logado: recarregar a página protegida não leva ao login.
  await pagina.reload();
  await expect(pagina).toHaveURL(PROTEGIDA);
  await expect(pagina.getByTestId('usuario-logado')).toHaveText('maria');
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(false);

  // Nada da sessão da aplicação foi parar no armazenamento da extensão.
  const guardado = JSON.stringify([
    await historico(serviceWorker),
    await serviceWorker.evaluate(async () => [await chrome.storage.local.get(null), await chrome.storage.session.get(null)]),
  ]);
  for (const proibido of [COOKIE_SESSAO, CHAVE_PREFERENCIA, 'maria', 'texto em edição']) expect(guardado).not.toContain(proibido);
});

test('cenário com `limpar_storage`: exibe o aviso, exige a confirmação e apaga só os tipos confirmados', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await entrar(pagina);
  await pagina.evaluate(() => sessionStorage.setItem('rascunho', 'texto em edição'));
  await salvarCenario(painel, cenarioDaPaginaTeste('limpar-storage'));

  await painel.getByTestId('analisar').click();
  await expect(painel.getByTestId('confirmacao-tipos-storage')).toHaveText('localStorage');
  await expect(painel.getByTestId('confirmacao-aviso-storage')).toContainText('http://localhost:4300');
  await expect(painel.getByTestId('confirmar')).toBeDisabled();
  // Recusar: a execução não começa e nada é apagado.
  await painel.getByTestId('desistir').click();
  await expect(painel.getByTestId('analisar')).toBeVisible();
  expect(await preferencia(pagina)).toBe('maria');
  expect(await historico(serviceWorker)).toEqual([]);

  await executar(painel, { confirmarLimpeza: true });
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  expect(resultado.condicoes.storageLimpo).toEqual(['local_storage']);
  await expect(painel.getByTestId('condicoes-storage')).toHaveText('localStorage');
  // Só o localStorage saiu: o cookie e o sessionStorage ficaram, e o usuário continua logado.
  expect(await pagina.evaluate(() => localStorage.length)).toBe(0);
  expect(await cookieDeSessao(context)).toBe('ativa');
  expect(await pagina.evaluate(() => sessionStorage.getItem('rascunho'))).toBe('texto em edição');
  await expect(pagina).toHaveURL(PROTEGIDA);
  await expect(pagina.getByTestId('usuario-logado')).toHaveText('(sem preferência salva)');
});

test('sessão expirada no meio da execução: para com falha de sessão, sem estatísticas', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, painel, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await entrar(pagina);
  await salvarCenario(painel, cenarioDaPaginaTeste('sessao-expira'));

  await executar(painel);
  const resultado = await resultadoFinal(painel, serviceWorker, 'Erro na execução');

  expect(resultado.cenario).toMatchObject({
    estadoFinal: 'erro',
    falhaDeSessao: { url: 'http://localhost:4300/login?voltar=%2Fprotegida%3Fexpira%3D3', iteracao: 3 },
    iteracoesCompletas: 2,
    estatisticas: [],
  });
  expect(resultado.cenario!.falhas).toHaveLength(1);
  expect(resultado.cenario!.falhas[0]).toMatchObject({ iteracao: 3, falhaDeSessao: true, acao: 'interrompeu' });
  await expect(painel.getByTestId('resultado-falha-sessao')).toContainText('Falha de sessão na iteração 3');
  await expect(painel.getByTestId('estatisticas')).toHaveCount(0);
  await expect(painel.getByTestId('execucao-estado').first()).toHaveText('Falha de sessão');
  await expect(painel.getByTestId('execucao-parcial').first()).toBeVisible();

  // A extensão parou onde a aplicação a deixou: na tela de login, sem tentar autenticar.
  expect(new URL(pagina.url()).pathname).toBe('/login');
  expect(await pagina.getByTestId('campo-usuario').inputValue()).toBe('');
  expect(await cookieDeSessao(context)).toBeUndefined();
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(false);
});

test('sessão já expirada ao iniciar, sem login declarado: falha de sessão antes de qualquer passo', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, cenarioDaPaginaTeste('sessao-preservada'));

  await executar(painel);
  const resultado = await resultadoFinal(painel, serviceWorker, 'Erro na execução');
  expect(resultado.cenario).toMatchObject({ falhaDeSessao: { iteracao: null }, passosExecutados: 0, iteracoes: [] });
  expect(new URL(pagina.url()).pathname).toBe('/login');
  expect(await pagina.getByTestId('campo-usuario').inputValue()).toBe('');
});

test('login declarado: autentica na preparação, executa, e o que foi digitado não fica guardado', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  const cenario = cenarioDaPaginaTeste('login-declarado');
  await salvarCenario(painel, cenario);

  // Sem `sessao.url_login` haveria o aviso; com ele declarado, não.
  await painel.getByTestId('analisar').click();
  await expect(painel.getByTestId('confirmacao-aviso-sessao')).toHaveCount(0);
  await painel.getByTestId('desistir').click();

  await executar(painel);
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  expect(resultado.cenario).toMatchObject({ iteracoesCompletas: 2, falhaDeSessao: null });
  await expect(pagina).toHaveURL(PROTEGIDA);
  await expect(pagina.getByTestId('usuario-logado')).toHaveText('usuario-de-teste');
  expect(await cookieDeSessao(context)).toBe('ativa');

  // No histórico e no estado da sessão, os textos dos passos de login estão mascarados.
  const guardadas = await historico(serviceWorker);
  expect(guardadas).toHaveLength(1);
  expect(guardadas[0]!.registro.definicao?.sessao?.passos_login?.slice(0, 2)).toEqual([
    { tipo: 'digitar', seletor: "[data-testid='campo-usuario']", texto: '***' },
    { tipo: 'digitar', seletor: "[data-testid='campo-senha']", texto: '***' },
  ]);
  const sessao = await serviceWorker.evaluate(() => chrome.storage.session.get(null));
  for (const digitado of ['usuario-de-teste', 'senha-de-teste-nao-gravar']) {
    expect(JSON.stringify(guardadas)).not.toContain(digitado);
    expect(JSON.stringify(sessao)).not.toContain(digitado);
  }
});

test('cada tipo de `limpar_storage` apaga só o próprio tipo', async ({ context, serviceWorker, idExtensao }) => {
  test.slow();
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/limpa');
  const base = cenarioDaPaginaTeste('abrir-fechar');

  /** Põe um dado de cada tipo na origem. */
  const semear = () =>
    pagina.evaluate(async () => {
      document.cookie = 'marcador=1; path=/';
      localStorage.setItem('marcador', '1');
      sessionStorage.setItem('marcador', '1');
      await new Promise<void>((resolver, rejeitar) => {
        const pedido = indexedDB.open('marcador', 1);
        pedido.onupgradeneeded = () => pedido.result.createObjectStore('itens');
        pedido.onsuccess = () => {
          pedido.result.close();
          resolver();
        };
        pedido.onerror = () => rejeitar(pedido.error);
      });
    });
  /** Quais tipos ainda têm o dado. */
  const presentes = () =>
    pagina.evaluate(async () => ({
      cookies: document.cookie.includes('marcador=1'),
      local_storage: localStorage.getItem('marcador') === '1',
      session_storage: sessionStorage.getItem('marcador') === '1',
      indexeddb: (await indexedDB.databases()).some((banco) => banco.name === 'marcador'),
    }));

  for (const tipo of ['cookies', 'local_storage', 'session_storage', 'indexeddb'] as const) {
    await semear();
    expect(await presentes()).toEqual({ cookies: true, local_storage: true, session_storage: true, indexeddb: true });
    await salvarCenario(painel, { ...base, nome: `limpar-${tipo}`, execucao: { iteracoes: 1 }, limpar_storage: [tipo] });
    await executar(painel, { confirmarLimpeza: true, desmarcar: ['memoria', 'dom-listeners', 'cpu'] });
    const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');
    expect(resultado.condicoes.storageLimpo).toEqual([tipo]);
    expect(await presentes(), `limpar_storage: ["${tipo}"]`).toEqual({
      cookies: tipo !== 'cookies',
      local_storage: tipo !== 'local_storage',
      session_storage: tipo !== 'session_storage',
      indexeddb: tipo !== 'indexeddb',
    });
  }
});
