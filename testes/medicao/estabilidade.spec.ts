/**
 * Testes que comparam tempos medidos. Rodam no projeto `medicao`, depois dos outros
 * e um de cada vez: com a suíte inteira em paralelo, a carga dos próprios testes
 * vira ruído (a variação da duração da iteração passou de 4% para 13%).
 */
import { CONFIGURACAO_PADRAO } from '../../extensao/shared/historico.ts';
import { mediana } from '../../extensao/shared/stats.ts';
import { variacaoEntreExecucoes } from '../../extensao/shared/variacao.ts';
import {
  abrirPaginaEPainel,
  cenarioDaPaginaTeste,
  estadoGravado,
  executar,
  historico,
  resultadoFinal,
  salvarCenario,
} from '../extensao/apoio.ts';
import { expect, test } from '../extensao/fixtures.ts';

test.describe.configure({ mode: 'serial' });

const ABRIR_FECHAR = cenarioDaPaginaTeste('abrir-fechar');

test('abrir-fechar com "padrao", 3 execuções: a variação das métricas fica dentro do limite configurado', async ({ context, serviceWorker, idExtensao }) => {
  test.slow();
  const { painel } = await abrirPaginaEPainel(context, serviceWorker, idExtensao);
  await salvarCenario(painel, { ...ABRIR_FECHAR, execucao: { iteracoes: 5, throttling: 'padrao' } });

  for (let execucao = 0; execucao < 3; execucao++) {
    await executar(painel);
    const resultado = await resultadoFinal(painel, serviceWorker, 'Concluída');
    expect(resultado.cenario).toMatchObject({ iteracoesCompletas: 5, iteracoesIncompletas: 0 });
  }

  const registros = (await historico(serviceWorker)).map((g) => g.registro);
  expect(registros).toHaveLength(3);
  expect(new Set(registros.map((r) => r.chaveCondicoes)).size).toBe(1);
  const [grupo] = variacaoEntreExecucoes(registros, CONFIGURACAO_PADRAO.limiteVariacao);
  expect(grupo).toMatchObject({ nomeCenario: 'abrir-fechar', execucoes: 3 });
  console.log('Variação entre 3 execuções de abrir-fechar com "padrao":', JSON.stringify(grupo!.metricas));
  expect(grupo!.metricas.filter((m) => m.instavel)).toEqual([]);
  // A interface mostra o mesmo cálculo, sem métrica sinalizada.
  await expect(painel.getByTestId('variacao')).toContainText('3 execuções');
  await expect(painel.getByTestId('metrica-instavel')).toHaveCount(0);
});

/** Diferença máxima, em %, no tempo de long tasks por iteração entre o painel aberto e o fechado. */
const LIMITE_DE_IMPACTO = 5;
const RODADAS = 3;
const ITERACOES = 8;

test('impacto da extensão: com o painel aberto e atualizando, as long tasks da página ficam dentro do limite', async ({ context, serviceWorker, idExtensao }) => {
  test.setTimeout(240_000);
  const { painel: primeiro, idAba } = await abrirPaginaEPainel(context, serviceWorker, idExtensao, '/cpu-pesada');
  await salvarCenario(primeiro, { ...cenarioDaPaginaTeste('cpu-pesada'), execucao: { iteracoes: ITERACOES } });
  let painel = primeiro;

  /** Executa o cenário e devolve a mediana do tempo em long tasks por iteração. */
  const medir = async (painelAberto: boolean): Promise<number> => {
    const anterior = (await estadoGravado(serviceWorker))?.idResultado ?? null;
    // Só "Processamento": o perfil de CPU e a memória deixariam a página mais lenta nas duas medições.
    await executar(painel, { desmarcar: ['carregamento', 'erros-pagina', 'memoria', 'dom-listeners', 'cpu'] });
    await expect(painel.getByTestId('execucao-estado')).toBeVisible();
    // Painel fechado: a execução segue no service worker, sem ninguém recebendo o status.
    if (!painelAberto) await painel.close();
    await expect
      .poll(async () => {
        const estado = await estadoGravado(serviceWorker);
        return estado?.fase === 'ociosa' && estado.idResultado !== anterior;
      }, { timeout: 60_000 })
      .toBe(true);
    const resultado = (await estadoGravado(serviceWorker))!.resultado!;
    expect(resultado.desfecho).toBe('concluida');
    expect(resultado.cenario!.iteracoesCompletas).toBe(ITERACOES);
    if (!painelAberto) {
      painel = await context.newPage();
      await painel.goto(`chrome-extension://${idExtensao}/index.html?aba=${idAba}#/painel`);
      await expect(painel.getByTestId('analisar')).toBeVisible();
    }
    const tempo = resultado.cenario!.estatisticas.find((e) => e.id === 'tempo-long-tasks')!.mediana!;
    expect(tempo).toBeGreaterThan(200);
    return tempo;
  };

  // Alternadas, para que uma oscilação da máquina não caia toda em um dos lados.
  const aberto: number[] = [];
  const fechado: number[] = [];
  for (let rodada = 0; rodada < RODADAS; rodada++) {
    aberto.push(await medir(true));
    fechado.push(await medir(false));
  }
  const comPainel = mediana(aberto)!;
  const semPainel = mediana(fechado)!;
  const diferenca = ((comPainel - semPainel) / semPainel) * 100;
  console.log(
    `Impacto do painel: aberto ${comPainel.toFixed(1)} ms, fechado ${semPainel.toFixed(1)} ms por iteração (${diferenca >= 0 ? '+' : ''}${diferenca.toFixed(2)}%).`,
    JSON.stringify({ aberto, fechado }),
  );
  expect(Math.abs(diferenca)).toBeLessThan(LIMITE_DE_IMPACTO);
});
