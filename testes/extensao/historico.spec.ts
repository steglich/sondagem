import { abrirPaginaEPainel, cenarioDaPaginaTeste, depuradorAnexado, executar, historico, resultadoFinal, salvarCenario, scriptsRegistrados } from './apoio.ts';
import { expect, test } from './fixtures.ts';

const ABRIR_FECHAR = cenarioDaPaginaTeste('abrir-fechar');

test('o resultado fica no histórico com os metadados, pode ser aberto de novo e removido', async ({ context, serviceWorker, idExtensao }) => {
  const { painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, { ...ABRIR_FECHAR, execucao: { iteracoes: 2, throttling: 'padrao' } });
  await executar(painel, { versaoBuild: '1.4.2' });
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  const [guardada] = await historico(serviceWorker);
  expect(guardada!.registro).toMatchObject({
    id: resultado.id,
    tipo: 'cenario',
    estado: 'concluida',
    nomeCenario: 'abrir-fechar',
    url: ABRIR_FECHAR.url_inicial,
    versaoBuild: '1.4.2',
    condicoes: { perfil: 'padrao', cpu: 4 },
    configuracao: { iteracoes: 2, throttling: 'padrao' },
    andamento: null,
    truncado: [],
  });
  expect(guardada!.registro.navegador?.versao).toMatch(/^\d+\./);
  expect(guardada!.registro.ambiente?.versaoNavegador).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  expect(guardada!.registro.definicao?.nome).toBe('abrir-fechar');
  expect(guardada!.registro.tamanho).toBeGreaterThan(0);
  // Só resumos: o censo por construtor e o tempo por função, nunca o snapshot ou o perfil brutos.
  expect(guardada!.dados.snapshots.map((s) => s.rotulo)).toEqual(['inicio', 'fim']);
  const texto = JSON.stringify(guardada);
  for (const bruto of ['"nodes"', '"edges"', '"timeDeltas"', '"cpuProfile"', '"samples"']) expect(texto).not.toContain(bruto);
  // O `chrome.storage.session` guarda só o id do resultado.
  const sessao = await serviceWorker.evaluate(() => chrome.storage.session.get('sondagem:sessao'));
  expect(sessao['sondagem:sessao']).toEqual({ fase: 'ociosa', sessao: null, resultado: null, idResultado: resultado.id });

  // O painel reaberto mostra o mesmo resultado, vindo do histórico.
  await painel.reload();
  await expect(painel.getByTestId('resultado-desfecho')).toHaveText('Concluída');
  await expect(painel.getByTestId('execucao-nome')).toHaveText('abrir-fechar');
  await expect(painel.getByTestId('execucao-estado')).toHaveText('Concluída');
  await expect(painel.getByTestId('historico-uso')).toContainText('1 análise guardada');

  await painel.getByTestId(`remover-execucao-${resultado.id}`).click();
  await expect(painel.getByTestId('historico-vazio')).toBeVisible();
  expect(await historico(serviceWorker)).toEqual([]);
});

test('retenção de 2 por cenário: a terceira execução remove a mais antiga', async ({ context, serviceWorker, idExtensao }) => {
  test.slow();
  const { painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await painel.getByTestId('config-maximo-por-cenario').fill('2');
  await painel.getByTestId('salvar-config').click();
  await expect(painel.getByTestId('config-salva')).toBeVisible();
  await salvarCenario(painel, { ...ABRIR_FECHAR, execucao: { iteracoes: 1 } });

  const ids: string[] = [];
  for (let execucao = 0; execucao < 3; execucao++) {
    await executar(painel, { desmarcar: ['memoria', 'dom-listeners', 'cpu'] });
    ids.push((await resultadoFinal(painel, serviceWorker, 'Concluída')).id);
    await expect(painel.getByTestId(`abrir-execucao-${ids.at(-1)}`)).toBeVisible();
  }
  expect((await historico(serviceWorker)).map((g) => g.registro.id)).toEqual([ids[2], ids[1]]);
  await expect(painel.getByTestId('execucao')).toHaveCount(2);
});

test('service worker encerrado durante a execução: ao voltar, limpa e guarda um resultado interrompido com os dados já coletados', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  test.slow();
  const { painel, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, { ...ABRIR_FECHAR, execucao: { iteracoes: 500 } });
  await executar(painel, { desmarcar: ['memoria', 'dom-listeners', 'cpu'] });

  // Espera a iteração 3 começar: as duas primeiras já foram gravadas no histórico.
  await expect.poll(async () => (await historico(serviceWorker))[0]?.registro.andamento?.iteracoes.filter((i) => i.fim !== null).length ?? 0).toBeGreaterThanOrEqual(2);
  const [antes] = await historico(serviceWorker);
  expect(antes!.registro).toMatchObject({ estado: 'em-andamento', resumo: null });
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(true);

  // Encerra o service worker da extensão, como o navegador faz ao suspendê-la. A marca
  // em memória prova que o que responde depois é outro service worker, que começou do zero.
  await serviceWorker.evaluate(() => void ((globalThis as { marca?: string }).marca = 'antes'));
  const cdp = await context.newCDPSession(painel);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  // Reabrir o painel acorda a extensão, que só consulta o estado.
  await painel.reload();
  const acordado = serviceWorker;
  await expect.poll(() => acordado.evaluate(() => (globalThis as { marca?: string }).marca ?? null)).toBeNull();

  await expect(painel.getByTestId('resultado-desfecho')).toHaveText('Interrompida', { timeout: 30_000 });
  // A limpeza foi feita: debugger solto, script removido, sessão encerrada.
  expect(await depuradorAnexado(acordado, idAba)).toBe(false);
  expect(await scriptsRegistrados(acordado)).toBe(0);
  const sessao = await acordado.evaluate(() => chrome.storage.session.get('sondagem:sessao'));
  expect(sessao['sondagem:sessao']).toMatchObject({ fase: 'ociosa', sessao: null, idResultado: antes!.registro.id });

  const guardadas = await historico(acordado);
  expect(guardadas).toHaveLength(1);
  const { registro } = guardadas[0]!;
  expect(registro).toMatchObject({ id: antes!.registro.id, estado: 'interrompida', andamento: null, resumo: { desfecho: 'interrompida', cenario: { estadoFinal: 'erro' } } });
  // As iterações anteriores à suspensão ficaram, completas; a que estava em curso, não.
  expect(registro.resumo!.cenario!.iteracoesCompletas).toBeGreaterThanOrEqual(2);
  expect(registro.resumo!.cenario!.iteracoesCompletas).toBeLessThan(500);
  expect(registro.resumo!.cenario!.falhas.at(-1)?.motivo).toBe('A extensão foi suspensa durante a execução.');
  // No histórico aparece como interrompida e parcial.
  await expect(painel.getByTestId('execucao-estado')).toHaveText('Interrompida');
  await expect(painel.getByTestId('execucao-parcial')).toBeVisible();
});
