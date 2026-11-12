import { readFileSync } from 'node:fs';
import type { Download, Page } from '@playwright/test';
import type { ExportacaoJson } from '../../extensao/shared/exportacao.ts';
import { abrirPaginaEPainel, cenarioDaPaginaTeste, executar, historico, resultadoFinal, salvarCenario } from './apoio.ts';
import { coletarErros, expect, test } from './fixtures.ts';

const ABRIR_FECHAR = cenarioDaPaginaTeste('abrir-fechar');

async function texto(download: Download): Promise<string> {
  return readFileSync(await download.path(), 'utf8');
}

async function baixar(pagina: Page, botao: string): Promise<Download> {
  const [download] = await Promise.all([pagina.waitForEvent('download'), pagina.getByTestId(botao).click()]);
  return download;
}

test('o histórico do painel abre o relatório da execução em nova aba, com as seções e os gráficos, sem violar a CSP', async ({ context, serviceWorker, idExtensao }) => {
  test.slow();
  const { painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, { ...ABRIR_FECHAR, execucao: { iteracoes: 3, throttling: 'padrao' } });
  await executar(painel, { versaoBuild: '1.4.2' });
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  const [relatorio] = await Promise.all([context.waitForEvent('page'), painel.getByTestId(`relatorio-execucao-${resultado.id}`).click()]);
  const erros = coletarErros(relatorio);
  await relatorio.waitForLoadState();
  expect(relatorio.url()).toBe(`chrome-extension://${idExtensao}/index.html#/relatorio/${resultado.id}`);

  // Cabeçalho: metadados, estado e condições.
  await expect(relatorio.getByTestId('relatorio-nome')).toHaveText('abrir-fechar');
  await expect(relatorio.getByTestId('relatorio-estado')).toHaveText('Concluída');
  await expect(relatorio.getByTestId('relatorio-build')).toHaveText('1.4.2');
  await expect(relatorio.getByTestId('relatorio-iteracoes')).toHaveText('3 de 3 completas');
  await expect(relatorio.getByTestId('relatorio-condicoes')).toContainText('CPU 4× mais lenta');
  await expect(relatorio.getByTestId('estatistica')).toHaveCount(3);

  // Uma seção para cada verificação que rodou, todas fechadas: nenhum gráfico existe ainda.
  await expect(relatorio.locator('details > summary')).toHaveText(['Processamento', 'Carregamento', 'Memória', 'CPU', 'Erros da página']);
  await expect(relatorio.locator('canvas')).toHaveCount(0);

  await relatorio.getByTestId('secao-memoria').locator('summary').click();
  // Com 3 iterações não há série suficiente para classificar (são precisas 5).
  await expect(relatorio.getByTestId('memoria-classificacao')).toHaveText('Dados insuficientes');
  // Heap, nós DOM e listeners por iteração, desenhados pelo uPlot. Cada gráfico só é criado ao entrar na tela.
  const graficos = relatorio.getByTestId('secao-memoria').getByTestId('grafico');
  await expect(graficos).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await graficos.nth(i).scrollIntoViewIfNeeded();
    await expect(graficos.nth(i).locator('canvas')).toHaveCount(1);
  }
  await expect(relatorio.getByTestId('lista-construtores').getByTestId('linha').first()).toBeVisible();

  await relatorio.getByTestId('abrir-secoes').click();
  await relatorio.getByTestId('secao-processamento').getByTestId('grafico').scrollIntoViewIfNeeded();
  await expect(relatorio.getByTestId('secao-processamento').locator('canvas')).toHaveCount(1);
  await expect(relatorio.getByTestId('cpu-resumo')).toBeVisible();
  await expect(relatorio.getByTestId('lista-funcoes').getByTestId('linha').first()).toBeVisible();
  await expect(relatorio.getByTestId('lista-carregamentos').getByTestId('linha').first()).toBeVisible();

  // A rota de comparação também abre sem erros.
  await relatorio.goto(`chrome-extension://${idExtensao}/index.html#/relatorio/comparar/${resultado.id}/${resultado.id}`);
  await expect(relatorio.getByTestId('comparacao-metrica')).toHaveCount(3);
  expect(erros).toEqual([]);
});

test('exportação: o JSON e o CSV são baixados, e um cenário com login não expõe o que foi digitado', async ({ context, serviceWorker, idExtensao }) => {
  test.slow();
  const { painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  const cenario = cenarioDaPaginaTeste('login-declarado');
  await salvarCenario(painel, cenario);
  await executar(painel, { versaoBuild: '1.5.0' });
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');
  const [guardada] = await historico(serviceWorker);

  const relatorio = await context.newPage();
  const erros = coletarErros(relatorio);
  await relatorio.goto(`chrome-extension://${idExtensao}/index.html#/relatorio/${resultado.id}`);
  await expect(relatorio.getByTestId('relatorio-estado')).toHaveText('Concluída');

  const json = await baixar(relatorio, 'exportar-json');
  expect(json.suggestedFilename()).toMatch(/^sondagem_login-declarado_1\.5\.0_\d{4}-\d{2}-\d{2}_\d{4}\.json$/);
  const conteudo = await texto(json);
  const exportado = JSON.parse(conteudo) as ExportacaoJson;
  expect(exportado.versao_exportacao).toBe(1);
  // Tudo o que está guardado da execução: o registro e os detalhes, como no histórico.
  expect(exportado.execucao).toEqual(guardada!.registro);
  expect(exportado.detalhes).toEqual(guardada!.dados);
  expect(exportado.execucao).toMatchObject({ nomeCenario: 'login-declarado', versaoBuild: '1.5.0', estado: 'concluida' });
  expect(exportado.execucao.resumo?.cenario?.estatisticas.length).toBeGreaterThan(0);

  const csv = await baixar(relatorio, 'exportar-csv');
  expect(csv.suggestedFilename()).toMatch(/^sondagem_login-declarado_1\.5\.0_\d{4}-\d{2}-\d{2}_\d{4}\.csv$/);
  const planilha = await texto(csv);
  expect(planilha.charCodeAt(0)).toBe(0xfeff);
  const linhas = planilha.slice(1).trimEnd().split('\r\n');
  // Cabeçalho mais uma linha por iteração.
  expect(linhas).toHaveLength(1 + 2);
  expect(linhas[0]).toMatch(/^Iteração,Completa,Duração da iteração \(ms\),/);
  expect(linhas[1]).toMatch(/^1,sim,\d+(\.\d+)?,/);
  expect(linhas[2]).toMatch(/^2,sim,\d+(\.\d+)?,/);

  // O que foi digitado no login não está em nenhum dos arquivos; o cenário exportado vem mascarado.
  for (const digitado of ['usuario-de-teste', 'senha-de-teste-nao-gravar']) {
    expect(conteudo).not.toContain(digitado);
    expect(planilha).not.toContain(digitado);
  }
  expect(exportado.execucao.definicao?.sessao?.passos_login?.[1]).toEqual({ tipo: 'digitar', seletor: "[data-testid='campo-senha']", texto: '***' });
  expect(conteudo).not.toMatch(/"cookie"/i);
  expect(erros).toEqual([]);
});

test('duas versões do build: a comparação mostra as duas versões e as diferenças por métrica, e pode ser exportada', async ({ context, serviceWorker, idExtensao }) => {
  test.slow();
  const { painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, { ...ABRIR_FECHAR, execucao: { iteracoes: 3, throttling: 'padrao' } });
  const ids: string[] = [];
  for (const versaoBuild of ['1.4.0', '1.5.0']) {
    await executar(painel, { versaoBuild, desmarcar: ['memoria', 'dom-listeners', 'cpu'] });
    ids.push((await resultadoFinal(painel, serviceWorker, 'Concluída')).id);
    await expect(painel.getByTestId(`relatorio-execucao-${ids.at(-1)}`)).toBeVisible();
  }
  const guardadas = await historico(serviceWorker);
  const mediana = (id: string, metrica: string): number =>
    guardadas.find((g) => g.registro.id === id)!.registro.resumo!.cenario!.estatisticas.find((e) => e.id === metrica)!.mediana!;

  // Do relatório da execução mais nova, escolhe a outra e compara.
  const relatorio = await context.newPage();
  const erros = coletarErros(relatorio);
  await relatorio.goto(`chrome-extension://${idExtensao}/index.html#/relatorio/${ids[1]}`);
  await expect(relatorio.getByTestId('relatorio-build')).toHaveText('1.5.0');
  await expect(relatorio.getByTestId('comparar-com').locator('option')).toHaveCount(1);
  await relatorio.getByTestId('comparar').click();
  await expect(relatorio).toHaveURL(`chrome-extension://${idExtensao}/index.html#/relatorio/comparar/${ids[0]}/${ids[1]}`);

  await expect(relatorio.getByTestId('comparacao-cenario')).toHaveText('abrir-fechar');
  await expect(relatorio.getByTestId('build-a')).toHaveText('1.4.0');
  await expect(relatorio.getByTestId('build-b')).toHaveText('1.5.0');
  // Mesmas condições e mesmo ambiente: sem avisos.
  await expect(relatorio.getByTestId('aviso-condicoes')).toHaveCount(0);

  const duracao = relatorio.locator('[data-testid="comparacao-metrica"][data-metrica="duracao-iteracao"]');
  const a = mediana(ids[0]!, 'duracao-iteracao');
  const b = mediana(ids[1]!, 'duracao-iteracao');
  await expect(duracao.getByTestId('valor-a')).toHaveText(`${a.toFixed(1)} ms`);
  await expect(duracao.getByTestId('valor-b')).toHaveText(`${b.toFixed(1)} ms`);
  await expect(duracao.getByTestId('diferenca')).toHaveText(`${b - a > 0 ? '+' : ''}${(b - a).toFixed(1)} ms`);
  const percentual = ((b - a) / a) * 100;
  await expect(duracao.getByTestId('diferenca-percentual')).toHaveText(`${percentual > 0 ? '+' : ''}${percentual.toFixed(1)}%`);
  await expect(relatorio.getByTestId('comparacao-metrica')).toHaveCount(3);

  const csv = await baixar(relatorio, 'exportar-comparacao');
  expect(csv.suggestedFilename()).toMatch(/^sondagem_comparacao_abrir-fechar_1\.4\.0_vs_1\.5\.0_.*\.csv$/);
  const linhas = (await texto(csv)).slice(1).trimEnd().split('\r\n');
  expect(linhas[0]).toBe('Métrica,Unidade,A (build 1.4.0),B (build 1.5.0),Diferença,Diferença (%)');
  expect(linhas).toHaveLength(1 + 3);
  expect(linhas[1]).toMatch(/^Duração da iteração,ms,\d/);

  // A linha de base marcada no relatório aparece no resumo do painel da próxima execução.
  await relatorio.goto(`chrome-extension://${idExtensao}/index.html#/relatorio/${ids[0]}`);
  await relatorio.getByTestId('marcar-linha-de-base').click();
  await expect(relatorio.getByTestId('linha-de-base-atual')).toBeVisible();
  const linhasDeBase = await serviceWorker.evaluate(() => chrome.storage.local.get('sondagem:linhas-de-base'));
  expect(linhasDeBase['sondagem:linhas-de-base']).toEqual({ 'abrir-fechar': { id: ids[0], limites: {} } });
  await painel.reload();
  await expect(painel.getByTestId('regressao-avaliacao')).toBeVisible();
  await expect(painel.getByTestId('regressao-metrica')).toHaveCount(3);
  expect(erros).toEqual([]);
});
