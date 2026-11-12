import type { Worker } from '@playwright/test';
import { COMANDOS_DE_CPU } from '../../extensao/background/cpu.ts';
import { CATEGORIA_PERFIL_CPU, criarAgregadorCpu } from '../../extensao/shared/cpu.ts';
import { abrirPaginaEPainel, cenarioDaPaginaTeste, depuradorAnexado, executar, resultadoFinal, salvarCenario } from './apoio.ts';
import { coletarErros, expect, test } from './fixtures.ts';

const CPU_PESADA = cenarioDaPaginaTeste('cpu-pesada');
const ARQUIVO_DA_PAGINA = 'http://localhost:4300/cpu-pesada.ts';

/**
 * Passa a registrar todo método de CDP que a extensão envia pelo `chrome.debugger`.
 * A lista fica no próprio service worker; `enviados` a lê.
 */
async function registrarComandos(serviceWorker: Worker): Promise<void> {
  await serviceWorker.evaluate(() => {
    const global = globalThis as unknown as { comandosCdp: string[] };
    global.comandosCdp = [];
    const original = chrome.debugger.sendCommand.bind(chrome.debugger) as (...argumentos: unknown[]) => Promise<unknown>;
    (chrome.debugger as unknown as { sendCommand: (...argumentos: unknown[]) => Promise<unknown> }).sendCommand = (...argumentos) => {
      global.comandosCdp.push(String(argumentos[1]));
      return original(...argumentos);
    };
  });
}

const enviados = (serviceWorker: Worker): Promise<string[]> =>
  serviceWorker.evaluate(() => (globalThis as unknown as { comandosCdp: string[] }).comandosCdp);

test('o chrome.debugger aceita todos os comandos de CDP usados pelo perfil de CPU', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/cpu-pesada');
  // O domínio `Profiler` é recusado a extensões; o transporte falso dos testes unitários
  // aceita qualquer coisa. Só aqui aparece um comando que o navegador recusa.
  const preparar = (tabId: number, categoria: string) =>
    serviceWorker.evaluate(
      async ({ tabId, categoria }) => {
        const global = globalThis as unknown as {
          sonda: { saida: { metodo: string; erro: string | null }[]; eventos: unknown[]; completo: unknown; instantes: number[] };
        };
        global.sonda = { saida: [], eventos: [], completo: null, instantes: [] };
        chrome.debugger.onEvent.addListener((_origem, metodo, parametros) => {
          if (metodo === 'Tracing.dataCollected') global.sonda.eventos.push(...((parametros as { value?: unknown[] }).value ?? []));
          if (metodo === 'Tracing.tracingComplete') global.sonda.completo = parametros;
        });
        const enviar = async (metodo: string, parametros?: object): Promise<Record<string, unknown>> => {
          try {
            const resposta = (await chrome.debugger.sendCommand({ tabId }, metodo, parametros)) as Record<string, unknown>;
            global.sonda.saida.push({ metodo, erro: null });
            return resposta ?? {};
          } catch (erro) {
            global.sonda.saida.push({ metodo, erro: erro instanceof Error ? erro.message : String(erro) });
            return {};
          }
        };
        const instante = async (): Promise<void> => {
          const { metrics = [] } = (await enviar('Performance.getMetrics')) as { metrics?: { name: string; value: number }[] };
          global.sonda.instantes.push((metrics.find((m) => m.name === 'Timestamp')?.value ?? 0) * 1_000_000);
        };
        await chrome.debugger.attach({ tabId }, '1.3');
        await enviar('Performance.enable');
        await enviar('Tracing.start', { traceConfig: { includedCategories: [categoria] }, transferMode: 'ReportEvents' });
        await instante();
        return undefined;
      },
      { tabId, categoria },
    );
  await preparar(idAba, CATEGORIA_PERFIL_CPU);
  await pagina.getByTestId('acao-pesada').click();
  await expect(pagina.getByTestId('resultado-pesado')).not.toHaveText('—');

  const sonda = await serviceWorker.evaluate(async (tabId) => {
    const global = globalThis as unknown as {
      sonda: { saida: { metodo: string; erro: string | null }[]; eventos: unknown[]; completo: unknown; instantes: number[] };
    };
    const enviar = async (metodo: string): Promise<Record<string, unknown>> => {
      try {
        const resposta = (await chrome.debugger.sendCommand({ tabId }, metodo)) as Record<string, unknown>;
        global.sonda.saida.push({ metodo, erro: null });
        return resposta ?? {};
      } catch (erro) {
        global.sonda.saida.push({ metodo, erro: erro instanceof Error ? erro.message : String(erro) });
        return {};
      }
    };
    const { metrics = [] } = (await enviar('Performance.getMetrics')) as { metrics?: { name: string; value: number }[] };
    global.sonda.instantes.push((metrics.find((m) => m.name === 'Timestamp')?.value ?? 0) * 1_000_000);
    await enviar('Tracing.end');
    for (let i = 0; i < 200 && global.sonda.completo === null; i++) await new Promise((resolver) => setTimeout(resolver, 50));
    await chrome.debugger.detach({ tabId });
    return global.sonda;
  }, idAba);

  expect(sonda.saida.filter((r) => r.erro !== null)).toEqual([]);
  // A lista conferida aqui é a mesma que o módulo de CPU declara usar.
  expect([...new Set(sonda.saida.map((r) => r.metodo))].sort()).toEqual([...COMANDOS_DE_CPU].sort());
  expect(sonda.completo).toEqual({ dataLossOccurred: false });

  // O `Timestamp` de `Performance.getMetrics` está no relógio do trace: as duas leituras
  // caem no período do perfil, e a função pesada rodou entre elas.
  type Evento = { name?: string; args?: { data?: { startTime?: number; timeDeltas?: number[] } } };
  const eventos = sonda.eventos as Evento[];
  const inicio = eventos.find((e) => e.name === 'Profile')?.args?.data?.startTime;
  expect(inicio).toBeGreaterThan(0);
  const duracao = eventos.filter((e) => e.name === 'ProfileChunk').reduce((soma, e) => soma + (e.args?.data?.timeDeltas ?? []).reduce((a, b) => a + b, 0), 0);
  const [antes, depois] = sonda.instantes as [number, number];
  // Tolerância de 100 ms nas duas pontas: `Tracing.start` responde alguns ms antes de o
  // amostrador começar, e a última amostra pode ter sido tirada um pouco antes da leitura.
  expect(Math.abs(antes - inicio!)).toBeLessThan(100_000);
  expect(depois).toBeGreaterThan(antes + 300_000);
  expect(depois).toBeLessThanOrEqual(inicio! + duracao + 100_000);

  // Com o intervalo entre as leituras excluído, a função pesada some do resumo; sem excluir, é a primeira.
  const completo = criarAgregadorCpu();
  completo.receber(sonda.eventos);
  expect(completo.resumir().funcoes.find((f) => f.arquivo?.startsWith('http://localhost:4300/'))).toMatchObject({ nome: 'calculoPesado' });
  const semIntervalo = criarAgregadorCpu({ excluidos: [{ inicio: antes, fim: depois }] });
  semIntervalo.receber(sonda.eventos);
  expect(semIntervalo.resumir().funcoes.find((f) => f.nome === 'calculoPesado')?.tempoProprio ?? 0).toBeLessThan(5);
});

test('cpu-pesada com "CPU": calculoPesado é a primeira função da página no resumo, com arquivo e linha', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  test.slow();
  const { painel, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  const erros = coletarErros(painel);
  await salvarCenario(painel, CPU_PESADA);
  await executar(painel);
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  expect(resultado.cenario).toMatchObject({ iteracoesCompletas: 5, iteracoesIncompletas: 0, falhas: [] });
  expect(resultado.selecao).toContain('cpu');
  const cpu = resultado.dados.cpu!;
  expect(cpu).toMatchObject({ estado: 'concluida', ativo: true, falha: null, incompleto: false, limiteAtingido: false });

  const resumo = cpu.resumo!;
  const daPagina = resumo.funcoes.filter((f) => f.arquivo?.startsWith('http://localhost:4300/'));
  // No arquivo servido, `function calculoPesado(` está na linha 4.
  expect(daPagina[0]).toMatchObject({ nome: 'calculoPesado', arquivo: ARQUIVO_DA_PAGINA, linha: 4 });
  expect(daPagina[0]!.coluna).toBeGreaterThan(0);
  // 5 iterações de 300 ms: o clique do aquecimento fica fora do perfil.
  expect(daPagina[0]!.tempoTotal).toBeGreaterThan(1200);
  expect(daPagina[0]!.tempoTotal).toBeLessThan(1700);
  expect(daPagina[0]!.percentual).toBeGreaterThan(50);
  // As categorias do motor ficam à parte, fora da lista.
  expect(resumo.funcoes.some((f) => ['(idle)', '(program)', '(garbage collector)', '(root)'].includes(f.nome))).toBe(false);
  expect(resumo.tempoAtivo).toBeLessThanOrEqual(resumo.tempoAmostrado);
  expect(resumo.funcoes.length).toBeLessThanOrEqual(200);
  // Do perfil bruto não fica nada gravado.
  const gravado = await serviceWorker.evaluate(async () => JSON.stringify([await chrome.storage.session.get(null), await chrome.storage.local.get(null)]));
  for (const campo of ['ProfileChunk', 'timeDeltas', 'cpuProfile']) expect(gravado).not.toContain(campo);

  await expect(painel.getByTestId('resultado-perfil-cpu')).toContainText('perfil de CPU ligado');
  await expect(painel.getByTestId('cpu-categorias')).toBeVisible();
  const primeira = painel.getByTestId('cpu-funcao').filter({ hasText: 'localhost:4300' }).first();
  await expect(primeira.getByTestId('cpu-funcao-nome')).toHaveText('calculoPesado');
  await expect(primeira.getByTestId('cpu-funcao-origem')).toHaveText(`${ARQUIVO_DA_PAGINA}:4`);
  await expect(painel.getByTestId('limpeza-concluida')).toBeVisible();
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(false);
  expect(erros).toEqual([]);
});

test('cpu-pesada sem "CPU": nenhum comando de trace é enviado e o resultado não tem a seção de CPU', async ({
  context,
  serviceWorker,
  idExtensao,
}) => {
  test.slow();
  const { painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await registrarComandos(serviceWorker);
  await salvarCenario(painel, CPU_PESADA);
  await executar(painel, { desmarcar: ['cpu'] });
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  expect(resultado.cenario).toMatchObject({ iteracoesCompletas: 5 });
  expect(resultado.selecao).not.toContain('cpu');
  expect(resultado.dados.cpu).toBeNull();
  const comandos = await enviados(serviceWorker);
  // O registro funcionou (o cenário foi executado pelo debugger) e nada do perfil passou por ele.
  expect(comandos).toContain('Input.dispatchMouseEvent');
  expect(comandos.filter((metodo) => /^(Tracing|Profiler)\./.test(metodo))).toEqual([]);

  await expect(painel.getByTestId('cenario-iteracoes')).toHaveText('5 de 5');
  await expect(painel.getByTestId('cpu-categorias')).toHaveCount(0);
  await expect(painel.getByTestId('cpu-funcoes')).toHaveCount(0);
  await expect(painel.getByTestId('resultado-perfil-cpu')).toHaveCount(0);
});

test('sessão manual com "CPU": o perfil cobre a sessão e mostra calculoPesado ao parar', async ({ context, serviceWorker, idExtensao }) => {
  const { pagina, painel, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/cpu-pesada');
  await painel.getByTestId('analisar').click();
  await painel.getByTestId('verificacao-cpu').check();
  await painel.getByTestId('confirmar').click();
  await expect(painel.getByTestId('status-cpu')).toHaveText('coletando');

  await pagina.getByTestId('acao-pesada').click();
  await expect(pagina.getByTestId('resultado-pesado')).not.toHaveText('—');
  await painel.getByTestId('parar').click();
  const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');

  expect(resultado.dados.cpu).toMatchObject({ estado: 'concluida', ativo: true, limiteAtingido: false });
  const daPagina = resultado.dados.cpu!.resumo!.funcoes.filter((f) => f.arquivo?.startsWith('http://localhost:4300/'));
  expect(daPagina[0]).toMatchObject({ nome: 'calculoPesado', arquivo: ARQUIVO_DA_PAGINA, linha: 4 });
  expect(await depuradorAnexado(serviceWorker, idAba)).toBe(false);
});
