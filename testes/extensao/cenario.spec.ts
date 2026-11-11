import {
  abrirPaginaEPainel,
  cenarioDaPaginaTeste,
  depuradorAnexado,
  estadoGravado,
  executar,
  resultadoFinal,
  salvarCenario,
  scriptsRegistrados,
} from './apoio.ts';
import { CHAVE_IGNORAR_DEPURADOR, coletarErros, expect, test } from './fixtures.ts';

const ABRIR_FECHAR = cenarioDaPaginaTeste('abrir-fechar');

test('cenário abrir-fechar: 3 execuções com o mesmo número de iterações completas e de passos', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  test.slow();
  const { pagina, painel, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  const erros = coletarErros(painel);
  await salvarCenario(painel, ABRIR_FECHAR);

  const execucoes: { completas: number; incompletas: number; passos: number; passosPorIteracao: number[] }[] = [];
  for (let execucao = 0; execucao < 3; execucao++) {
    await executar(painel);
    const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');
    const cenario = resultado.cenario!;
    execucoes.push({
      completas: cenario.iteracoesCompletas,
      incompletas: cenario.iteracoesIncompletas,
      passos: cenario.passosExecutados,
      passosPorIteracao: cenario.iteracoes.map((i) => i.passosExecutados),
    });

    // Carga nova a cada execução: 1 ciclo de aquecimento + 5 iterações, nada retido.
    expect(pagina.url()).toBe(ABRIR_FECHAR.url_inicial);
    expect(await pagina.evaluate(() => window.estadoTeste)).toEqual({ ciclos: 6, listenersAtivos: 0 });
    // Ao terminar, o debugger e o script de medição saíram.
    expect(await depuradorAnexado(serviceWorker, idAba)).toBe(false);
    expect(await scriptsRegistrados(serviceWorker)).toBe(0);
  }

  // Por iteração: 4 passos de ação e 3 de memória. Fora delas: 2 do aquecimento e 3 de memória antes e depois.
  expect(execucoes[0]).toEqual({ completas: 5, incompletas: 0, passos: 43, passosPorIteracao: [7, 7, 7, 7, 7] });
  expect(execucoes[1]).toEqual(execucoes[0]);
  expect(execucoes[2]).toEqual(execucoes[0]);

  await expect(painel.getByTestId('cenario-iteracoes')).toHaveText('5 de 5');
  await expect(painel.getByTestId('estatistica')).toHaveCount(3);
  await expect(painel.getByTestId('limpeza-concluida')).toBeVisible();
  expect(erros).toEqual([]);
});

test('o resultado registra a configuração efetiva e o ambiente', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, { ...ABRIR_FECHAR, execucao: { iteracoes: 20, throttling: 'padrao' } });

  await executar(painel, { iteracoes: 2, versaoBuild: '1.4.2', desmarcar: ['carregamento'] });
  await expect(painel.getByTestId('execucao-cenario')).toHaveText('abrir-fechar');
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  expect(resultado).toMatchObject({
    tipo: 'cenario',
    url: ABRIR_FECHAR.url_inicial,
    selecao: ['processamento', 'erros-pagina', 'memoria', 'dom-listeners'],
    cenario: {
      // O valor da confirmação (2) vale mais do que o do cenário (20).
      configuracao: { nome: 'abrir-fechar', urlInicial: ABRIR_FECHAR.url_inicial, iteracoes: 2, throttling: 'padrao', versaoBuild: '1.4.2' },
      estadoFinal: 'concluida',
      iteracoesCompletas: 2,
    },
  });
  expect(resultado.inicio).toBeGreaterThan(Date.now() - 60_000);

  const naPagina = await pagina.evaluate(() => ({
    userAgent: navigator.userAgent,
    janela: { largura: innerWidth, altura: innerHeight },
    dpr: devicePixelRatio,
  }));
  const ambiente = resultado.cenario!.ambiente!;
  expect(ambiente).toMatchObject(naPagina);
  // Versão completa do navegador, não só a principal que aparece no user agent.
  expect(ambiente.versaoNavegador).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  expect(naPagina.userAgent).toContain(`/${ambiente.versaoNavegador.split('.')[0]}.`);

  await expect(painel.getByTestId('cenario-versao-build')).toHaveText('1.4.2');
  await expect(painel.getByTestId('ambiente-versao')).toHaveText(ambiente.versaoNavegador);
  await expect(painel.getByTestId('ambiente-janela')).toHaveText(`${naPagina.janela.largura} × ${naPagina.janela.altura}`);
});

test('navegar, clicar, digitar e rolar agem na página como um usuário', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  // Registra, em cada documento, se os cliques chegam como eventos confiáveis.
  await pagina.addInitScript(() => {
    const cliques: boolean[] = [];
    addEventListener('click', (evento) => cliques.push(evento.isTrusted), true);
    (window as unknown as { cliquesConfiaveis: boolean[] }).cliquesConfiaveis = cliques;
  });
  await salvarCenario(painel, {
    versao_esquema: 1,
    nome: 'acoes',
    url_inicial: 'http://localhost:4300/cpu-pesada',
    passos: [
      { tipo: 'navegar', url: '/limpa' },
      { tipo: 'clicar', seletor: "[data-testid='abrir-componente']" },
      { tipo: 'esperar', seletor: '#area .componente' },
      { tipo: 'digitar', seletor: "[data-testid='campo-anotacao']", texto: 'primeira ' },
      { tipo: 'digitar', seletor: "[data-testid='campo-anotacao']", texto: 'segunda' },
      { tipo: 'rolar', y: 600 },
      { tipo: 'esperar', ms: 300 },
    ],
  });

  await executar(painel);
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  expect(resultado.cenario).toMatchObject({ passosExecutados: 7, falhas: [], iteracoesCompletas: 0 });
  expect(pagina.url()).toBe('http://localhost:4300/limpa');
  await expect(pagina.locator('#area .componente')).toBeVisible();
  await expect(pagina.getByTestId('campo-anotacao')).toHaveValue('primeira segunda');
  expect(await pagina.evaluate(() => scrollY)).toBeGreaterThan(0);
  expect(await pagina.evaluate(() => (window as unknown as { cliquesConfiaveis: boolean[] }).cliquesConfiaveis)).toEqual([true]);
  // Os dois documentos (URL inicial e o do passo navegar) foram observados.
  expect(resultado.dados.documentos.map((d) => new URL(d.url).pathname)).toEqual(['/cpu-pesada', '/limpa']);
});

test('um clique do cenário conta como interação, na iteração em que ocorreu', async ({ context, serviceWorker, idExtensao }) => {
  const { painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, {
    versao_esquema: 1,
    nome: 'cpu',
    url_inicial: 'http://localhost:4300/cpu-pesada',
    passos: [
      {
        tipo: 'repetir',
        vezes: 'iteracoes',
        passos: [
          { tipo: 'clicar', seletor: "[data-testid='acao-pesada']" },
          { tipo: 'aguardar_inatividade', ms: 300 },
        ],
      },
    ],
  });

  await executar(painel, { iteracoes: 3 });
  await expect(painel.getByTestId('execucao-progresso')).toContainText('de 3');
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  const longas = resultado.dados.longTasks.filter((t) => t.duracao > 200);
  expect(longas.map((t) => t.iteracao)).toEqual([1, 2, 3]);
  const interacoes = resultado.dados.interacoes.filter((i) => i.alvo === 'button[data-testid="acao-pesada"]');
  expect(interacoes.map((i) => i.iteracao)).toEqual([1, 2, 3]);
  expect(interacoes.every((i) => i.duracao > 200)).toBe(true);

  const tempo = resultado.cenario!.estatisticas.find((e) => e.id === 'tempo-long-tasks')!;
  expect(tempo.amostras).toBe(3);
  expect(tempo.mediana).toBeGreaterThan(200);
  expect(resultado.cenario!.estatisticas.find((e) => e.id === 'pior-interacao')?.p95).toBeGreaterThan(200);
  await expect(painel.locator('[data-metrica="tempo-long-tasks"]')).toContainText('ms');
});

test('/erros: a exceção e a promise rejeitada aparecem no resultado, e a execução conclui', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  const { pagina, painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, {
    versao_esquema: 1,
    nome: 'erros',
    url_inicial: 'http://localhost:4300/erros',
    passos: [
      {
        tipo: 'repetir',
        vezes: 'iteracoes',
        passos: [
          { tipo: 'clicar', seletor: "[data-testid='lancar-excecao']" },
          { tipo: 'clicar', seletor: "[data-testid='rejeitar-promise']" },
          { tipo: 'esperar', ms: 100 },
        ],
      },
    ],
  });

  await executar(painel, { iteracoes: 2 });
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  expect(await pagina.evaluate(() => window.errosProduzidos)).toEqual({ excecoes: 2, rejeicoes: 2 });
  expect(resultado.cenario).toMatchObject({ estadoFinal: 'concluida', iteracoesCompletas: 2, falhas: [] });
  expect(resultado.dados.errosPagina.map((e) => [e.tipo, e.mensagem, e.iteracao])).toEqual([
    ['excecao', 'Error: Exceção de teste 1', 1],
    ['rejeicao', 'Error: Rejeição de teste 1', 1],
    ['excecao', 'Error: Exceção de teste 2', 2],
    ['rejeicao', 'Error: Rejeição de teste 2', 2],
  ]);
  for (const erro of resultado.dados.errosPagina) {
    expect(erro.arquivo).toBe('http://localhost:4300/erros.ts');
    expect(erro.linha).toBeGreaterThan(0);
    expect(erro.instante).toBeGreaterThan(resultado.inicio);
  }

  await expect(painel.getByTestId('erros-pagina-destaque')).toContainText('A página teve 4 erros');
  await expect(painel.getByTestId('erro-pagina')).toHaveCount(4);
  await expect(painel.getByTestId('erro-pagina').first()).toContainText('iteração 1');
});

test('/erros sem "Erros da página": nada é registrado e a seção não aparece', async ({ context, serviceWorker, idExtensao }) => {
  const { painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, {
    versao_esquema: 1,
    nome: 'erros',
    url_inicial: 'http://localhost:4300/erros',
    passos: [{ tipo: 'clicar', seletor: "[data-testid='lancar-excecao']" }],
  });

  await executar(painel, { desmarcar: ['erros-pagina'] });
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  expect(resultado.dados.errosPagina).toEqual([]);
  await expect(painel.getByTestId('erros-pagina-destaque')).toHaveCount(0);
  await expect(painel.getByTestId('sem-erros-pagina')).toHaveCount(0);
});

test('sessão manual com "Erros da página": anexa o debugger, registra o erro e desanexa ao parar', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  const { pagina, painel, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/erros');
  await painel.getByTestId('analisar').click();
  await painel.getByTestId('verificacao-erros-pagina').check();
  await expect(painel.getByTestId('confirmacao-aviso-debugger')).toBeVisible();
  await painel.getByTestId('confirmar').click();
  await expect(painel.getByTestId('parar')).toBeVisible();
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(true);

  await pagina.getByTestId('rejeitar-promise').click();
  await expect(painel.getByTestId('status-erros-pagina')).toHaveText('1');

  await painel.getByTestId('parar').click();
  await expect(painel.getByTestId('resultado-desfecho')).toHaveText('Concluída');
  await expect(painel.getByTestId('erro-pagina')).toContainText('Promise rejeitada: Error: Rejeição de teste 1');
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(false);
  await expect(painel.getByTestId('item-limpeza').filter({ hasText: 'Debugger' })).toHaveCount(1);
});

test('passo que falha: a execução para com o passo e o motivo, e o debugger sai', async ({ context, serviceWorker, idExtensao }) => {
  const { painel, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, {
    versao_esquema: 1,
    nome: 'falha',
    url_inicial: 'http://localhost:4300/limpa',
    passos: [
      { tipo: 'clicar', seletor: "[data-testid='abrir-componente']" },
      { tipo: 'clicar', seletor: "[data-testid='nao-existe']", tempo_limite_ms: 500 },
      { tipo: 'clicar', seletor: "[data-testid='fechar-componente']" },
    ],
  });

  await executar(painel);
  const resultado = await resultadoFinal(painel, serviceWorker, 'Erro na execução');

  expect(resultado.cenario?.falhas).toEqual([
    {
      caminho: '/passos/1',
      tipoPasso: 'clicar',
      iteracao: null,
      acao: 'interrompeu',
      motivo: 'Tempo limite de 500 ms: nenhum elemento corresponde a "[data-testid=\'nao-existe\']".',
    },
  ]);
  expect(resultado.cenario?.passosExecutados).toBe(1);
  await expect(painel.getByTestId('falha-passo')).toContainText('/passos/1');
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(false);
  expect(await scriptsRegistrados(serviceWorker)).toBe(0);
});

test('cancelar durante a execução desanexa o debugger e remove os observadores', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, painel, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, {
    ...ABRIR_FECHAR,
    passos: [
      {
        tipo: 'repetir',
        vezes: 'iteracoes',
        passos: [
          { tipo: 'clicar', seletor: "[data-testid='abrir-componente']" },
          { tipo: 'clicar', seletor: "[data-testid='fechar-componente']" },
          { tipo: 'esperar', ms: 400 },
        ],
      },
    ],
  });

  await executar(painel, { iteracoes: 50 });
  await expect(painel.getByTestId('execucao-progresso')).toHaveText(/iteração [2-9] de 50/);
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(true);
  expect(await scriptsRegistrados(serviceWorker)).toBe(1);

  await painel.getByTestId('cancelar').click();
  await expect(painel.getByTestId('resultado-desfecho')).toHaveText('Análise cancelada');

  const estado = await estadoGravado(serviceWorker);
  const resultado = estado!.resultado!;
  expect(estado).toMatchObject({ fase: 'ociosa', sessao: null });
  expect(resultado.cenario).toMatchObject({ estadoFinal: 'cancelada', estatisticas: [] });
  expect(resultado.cenario!.iteracoes.length).toBeLessThan(50);

  // Debugger desanexado, script desregistrado e observadores da página desligados.
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(false);
  expect(await scriptsRegistrados(serviceWorker)).toBe(0);
  const removidos = Object.fromEntries(resultado.limpeza.map((item) => [item.recurso, item.quantidade]));
  expect(removidos['depurador']).toBe(1);
  expect(removidos['script-registrado']).toBe(1);
  expect(removidos['observador']).toBeGreaterThanOrEqual(1);
  expect(removidos['porta']).toBe(1);
  expect(resultado.paginaRespondeu).toBe(true);

  // Nenhum passo roda depois do cancelamento.
  const ciclos = await pagina.evaluate(() => window.estadoTeste.ciclos);
  await pagina.waitForTimeout(1500);
  expect(await pagina.evaluate(() => window.estadoTeste.ciclos)).toBe(ciclos);
  expect(await estadoGravado(serviceWorker)).toEqual(estado);
});

test('debugger desanexado por fora (barra de depuração): interrompida, com os dados parciais e o motivo', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  const { painel, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, {
    versao_esquema: 1,
    nome: 'cpu',
    url_inicial: 'http://localhost:4300/cpu-pesada',
    passos: [
      {
        tipo: 'repetir',
        vezes: 'iteracoes',
        passos: [
          { tipo: 'clicar', seletor: "[data-testid='acao-pesada']" },
          { tipo: 'esperar', ms: 700 },
        ],
      },
    ],
  });

  await executar(painel, { iteracoes: 50 });
  await expect(painel.getByTestId('execucao-progresso')).toHaveText(/iteração [3-9] de 50/, { timeout: 15_000 });

  // O botão "Cancelar" da barra de depuração não é alcançável por automação. O que ele
  // faz, do ponto de vista da extensão, é disparar `chrome.debugger.onDetach` com
  // `canceled_by_user`; o teste dispara esse mesmo evento.
  await serviceWorker.evaluate((tabId) => {
    const evento = chrome.debugger.onDetach as unknown as { dispatch(origem: { tabId: number }, motivo: string): void };
    evento.dispatch({ tabId }, 'canceled_by_user');
  }, idAba);

  await expect(painel.getByTestId('resultado-desfecho')).toHaveText('Interrompida');
  await expect(painel.getByTestId('resultado-conexao-perdida')).toContainText('cancelada na barra de aviso do Chrome');
  await expect(painel.getByTestId('resultado-conexao-perdida')).toContainText('parciais');

  const resultado = (await estadoGravado(serviceWorker))!.resultado!;
  expect(resultado).toMatchObject({ desfecho: 'interrompida', conexaoPerdida: 'canceled_by_user' });
  expect(resultado.cenario!.iteracoesCompletas).toBeGreaterThanOrEqual(2);
  expect(resultado.cenario!.iteracoesCompletas).toBeLessThan(50);
  // Os dados das iterações já feitas foram preservados.
  expect(resultado.dados.longTasks.filter((t) => t.duracao > 200).length).toBeGreaterThanOrEqual(2);
  expect(await scriptsRegistrados(serviceWorker)).toBe(0);
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(false);
});

test('com outro depurador na aba, a análise não começa e o painel orienta o usuário', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  // Sem a chave dos testes, o próprio Playwright é o "outro depurador" anexado à aba.
  await serviceWorker.evaluate((chave) => chrome.storage.local.remove(chave), CHAVE_IGNORAR_DEPURADOR);
  const { pagina, painel, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/limpa');
  await salvarCenario(painel, ABRIR_FECHAR);

  await executar(painel);

  await expect(painel.getByTestId('falha-debugger-titulo')).toHaveText('Há um depurador aberto nesta aba.');
  await expect(painel.getByTestId('falha-debugger-orientacao')).toContainText('janela de teste dedicada');
  await expect(painel.getByTestId('falha-debugger-dependente')).toHaveText(['Execução do cenário', 'Erros da página', 'Memória', 'DOM e listeners']);
  await expect(painel.getByTestId('analisar')).toBeVisible();

  // Nada começou: sem navegação, sem cliques, sem script, sem debugger da extensão.
  expect(await pagina.evaluate(() => window.estadoTeste)).toEqual({ ciclos: 0, listenersAtivos: 0 });
  expect((await estadoGravado(serviceWorker))?.fase ?? 'ociosa').toBe('ociosa');
  expect(await scriptsRegistrados(serviceWorker)).toBe(0);
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(false);

  // A sessão manual sem verificação que use o debugger continua funcionando.
  await painel.getByTestId('analisar').click();
  await painel.getByTestId('modo-manual').check();
  await painel.getByTestId('confirmar').click();
  await expect(painel.getByTestId('parar')).toBeVisible();
  await painel.getByTestId('parar').click();
  await expect(painel.getByTestId('resultado-desfecho')).toHaveText('Concluída');
});

test('cenário inválido é rejeitado na tela de cenários, com o caminho do campo', async ({ context, serviceWorker, idExtensao }) => {
  const { painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await painel.getByTestId('texto-cenario').fill(JSON.stringify({ ...ABRIR_FECHAR, passos: [{ tipo: 'clicar' }] }));
  await painel.getByTestId('salvar-cenario').click();

  await expect(painel.getByTestId('erro-cenario-caminho')).toHaveText('/passos/0/seletor');
  await expect(painel.getByTestId('sem-cenarios')).toBeVisible();

  // Arquivo com JSON malformado: linha e coluna.
  await painel.getByTestId('arquivo-cenario').setInputFiles({
    name: 'quebrado.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{\n  "nome": "x",,\n}'),
  });
  await expect(painel.getByTestId('erro-cenario')).toContainText('JSON malformado na linha 2, coluna 15');

  // Arquivo válido: entra na lista e fica selecionado.
  await painel.getByTestId('arquivo-cenario').setInputFiles('pagina-teste/cenarios/abrir-fechar.json');
  await expect(painel.getByTestId('selecionar-cenario-abrir-fechar')).toBeChecked();
  await painel.getByTestId('remover-cenario-abrir-fechar').click();
  await expect(painel.getByTestId('sem-cenarios')).toBeVisible();
});
