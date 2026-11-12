import { describe, expect, it } from 'vitest';
import { type Marcacao, aplicarLote, dadosVazios, estatisticasDaExecucao } from '../shared/agregacao.ts';
import type { Cenario, Passo, PassoDeAcao } from '../shared/cenario.ts';
import { andamentoInicial } from '../shared/execucao-estado.ts';
import type { AndamentoExecucao, DadosColetados, EstadoExecucao, Marca } from '../shared/types.ts';
import {
  ABA,
  ABRIR,
  DE_CPU,
  DE_MEMORIA,
  FECHAR,
  type RelogioSimulado,
  type TransporteFalso,
  criarPagina,
  ehColeta,
  criarRelogioSimulado,
  criarTransporteFalso,
  entregaDePerfil,
} from './apoio-teste.ts';
import { criarConexaoCdp } from './cdp.ts';
import { TEMPO_LIMITE_ENTREGA_MS } from './cpu.ts';
import { GRUPO_CENSO, GRUPO_COLETA } from './memoria.ts';
import { MOTIVO_CANCELAMENTO, MOTIVO_CONEXAO_PERDIDA, TEMPO_LIMITE_SNAPSHOT_MS, contarIteracoes, executarCenario } from './scenarios.ts';


function cenario(passos: Passo[], extras: Partial<Cenario> = {}): Cenario {
  return { versao_esquema: 1, nome: 'teste', url_inicial: 'http://localhost:4300/limpa', passos, ...extras };
}

const CICLO: PassoDeAcao[] = [
  { tipo: 'clicar', seletor: ABRIR },
  { tipo: 'clicar', seletor: FECHAR },
];

interface Montagem {
  transporte: TransporteFalso;
  pagina: ReturnType<typeof criarPagina>;
  relogio: RelogioSimulado;
  controle: AbortController;
  estados: EstadoExecucao[];
  marcas: (Marca & { instante: number })[];
  longTask: { fim: number | null };
  dados: DadosColetados;
  limiteConstrutores: number | undefined;
  rodar(c: Cenario, opcoes?: { iteracoes?: number; verificacoesAtivas?: string[] }): Promise<AndamentoExecucao>;
  /** Comandos enviados, sem os de preparação. */
  metodos(): string[];
  cliques(): { x: unknown; y: unknown }[];
}

async function montar(): Promise<Montagem> {
  const transporte = criarTransporteFalso();
  const pagina = criarPagina(transporte);
  const relogio = criarRelogioSimulado();
  const controle = new AbortController();
  const conexao = criarConexaoCdp(transporte);
  await conexao.anexar(ABA);
  const m: Montagem = {
    transporte,
    pagina,
    relogio,
    controle,
    estados: [],
    marcas: [],
    longTask: { fim: null },
    dados: dadosVazios(),
    limiteConstrutores: undefined,
    rodar(c, opcoes = {}) {
      const iteracoes = opcoes.iteracoes ?? 3;
      return executarCenario(
        { cenario: c, iteracoes, verificacoesAtivas: opcoes.verificacoesAtivas ?? ['processamento'] },
        {
          cdp: conexao,
          relogio,
          sinal: controle.signal,
          ultimaLongTask: () => m.longTask.fim,
          memoria: { dados: m.dados, limiteConstrutores: m.limiteConstrutores },
          aoMudar(andamento, marca) {
            if (m.estados.at(-1) !== andamento.estado) m.estados.push(andamento.estado);
            if (marca) m.marcas.push({ ...marca, instante: relogio.agora() });
          },
        },
        andamentoInicial(iteracoes),
      );
    },
    metodos: () => transporte.comandos.map((c) => c.metodo),
    cliques: () =>
      transporte.comandos
        .filter((c) => c.metodo === 'Input.dispatchMouseEvent' && (c.parametros as { type: string }).type === 'mousePressed')
        .map((c) => ({ x: (c.parametros as { x: unknown }).x, y: (c.parametros as { y: unknown }).y })),
  };
  return m;
}

describe('preparação', () => {
  it('abre a URL inicial em carga nova antes de qualquer passo e registra o ambiente', async () => {
    const m = await montar();
    const andamento = await m.rodar(cenario([{ tipo: 'clicar', seletor: ABRIR }]));

    const metodos = m.metodos();
    expect(metodos.slice(0, 3)).toEqual(['Page.enable', 'Network.enable', 'Page.navigate']);
    expect(m.transporte.comandos[2]!.parametros).toEqual({ url: 'http://localhost:4300/limpa' });
    expect(metodos.indexOf('Page.navigate')).toBeLessThan(metodos.indexOf('Input.dispatchMouseEvent'));
    expect(andamento.estado).toBe('concluida');
    expect(andamento.ambiente).toEqual({
      versaoNavegador: '158.0.8127.18',
      userAgent: 'Mozilla/5.0 Chrome/158.0.0.0 Safari/537.36',
      janela: { largura: 1280, altura: 720 },
      dpr: 2,
    });
  });

  it('se a URL inicial não abre, nenhum passo roda e o resultado é erro', async () => {
    const m = await montar();
    m.pagina.erroDeNavegacao = 'net::ERR_CONNECTION_REFUSED';
    const andamento = await m.rodar(cenario(CICLO));

    expect(andamento.estado).toBe('erro');
    expect(andamento.falhas).toEqual([
      expect.objectContaining({ caminho: '/url_inicial', acao: 'interrompeu', motivo: expect.stringContaining('ERR_CONNECTION_REFUSED') }),
    ]);
    expect(m.cliques()).toEqual([]);
    expect(m.transporte.anexadas.size).toBe(0);
  });
});

describe('passos de ação', () => {
  it('clicar: move, pressiona e solta no centro do elemento, na ordem declarada', async () => {
    const m = await montar();
    const andamento = await m.rodar(cenario(CICLO));

    const mouse = m.transporte.comandos.filter((c) => c.metodo === 'Input.dispatchMouseEvent').map((c) => c.parametros);
    expect(mouse).toEqual([
      { type: 'mouseMoved', x: 100, y: 40 },
      { type: 'mousePressed', x: 100, y: 40, button: 'left', clickCount: 1 },
      { type: 'mouseReleased', x: 100, y: 40, button: 'left', clickCount: 1 },
      { type: 'mouseMoved', x: 200, y: 40 },
      { type: 'mousePressed', x: 200, y: 40, button: 'left', clickCount: 1 },
      { type: 'mouseReleased', x: 200, y: 40, button: 'left', clickCount: 1 },
    ]);
    expect(andamento.passosExecutados).toBe(2);
  });

  it('clicar espera o elemento parar de se mover', async () => {
    const m = await montar();
    let leituras = 0;
    m.pagina.aoComando = (metodo, p) => {
      if (metodo === 'Runtime.evaluate' && String(p['expression']).includes('scrollIntoView')) {
        leituras++;
        m.pagina.elementos.get(ABRIR)!.y = leituras < 4 ? 40 + leituras * 10 : 80;
      }
    };
    await m.rodar(cenario([{ tipo: 'clicar', seletor: ABRIR }]));
    expect(m.cliques()).toEqual([{ x: 100, y: 80 }]);
  });

  it('clicar com outro elemento por cima falha dizendo quem cobre', async () => {
    const m = await montar();
    m.pagina.elementos.get(ABRIR)!.coberto = 'div#cortina';
    const andamento = await m.rodar(cenario([{ tipo: 'clicar', seletor: ABRIR, tempo_limite_ms: 500 }]));

    expect(andamento.estado).toBe('erro');
    expect(andamento.falhas[0]!.motivo).toContain('outro elemento está por cima');
    expect(andamento.falhas[0]!.motivo).toContain('div#cortina');
    expect(m.cliques()).toEqual([]);
  });

  it('digitar foca o elemento e insere o texto', async () => {
    const m = await montar();
    m.pagina.elementos.set('#busca', { x: 10, y: 10 });
    await m.rodar(cenario([{ tipo: 'digitar', seletor: '#busca', texto: 'sondagem', limpar: true }]));

    const insercao = m.transporte.comandos.find((c) => c.metodo === 'Input.insertText');
    expect(insercao?.parametros).toEqual({ text: 'sondagem' });
    const foco = m.transporte.comandos.find((c) => String((c.parametros as { expression?: string })?.expression).includes('.focus()'));
    expect(foco).toBeDefined();
    expect(m.transporte.comandos.indexOf(foco!)).toBeLessThan(m.transporte.comandos.indexOf(insercao!));
  });

  it('rolar gira a roda do mouse no centro da janela ou sobre o elemento', async () => {
    const m = await montar();
    await m.rodar(cenario([{ tipo: 'rolar', y: 400 }, { tipo: 'rolar', seletor: ABRIR, x: 30, y: -10 }]));

    const rodas = m.transporte.comandos.filter((c) => (c.parametros as { type?: string })?.type === 'mouseWheel').map((c) => c.parametros);
    expect(rodas).toEqual([
      { type: 'mouseWheel', x: 640, y: 360, deltaX: 0, deltaY: 400 },
      { type: 'mouseWheel', x: 100, y: 40, deltaX: 30, deltaY: -10 },
    ]);
  });

  it('navegar resolve a URL relativa à inicial e espera o carregamento', async () => {
    const m = await montar();
    const andamento = await m.rodar(cenario([{ tipo: 'navegar', url: '/cpu-pesada' }]));

    const navegacoes = m.transporte.comandos.filter((c) => c.metodo === 'Page.navigate').map((c) => (c.parametros as { url: string }).url);
    expect(navegacoes).toEqual(['http://localhost:4300/limpa', 'http://localhost:4300/cpu-pesada']);
    expect(andamento.estado).toBe('concluida');
  });

  it('navegar que não termina de carregar estoura o tempo limite', async () => {
    const m = await montar();
    let navegacoes = 0;
    m.pagina.aoComando = (metodo) => {
      if (metodo === 'Page.navigate') m.pagina.carregarAoNavegar = ++navegacoes === 1;
    };
    const andamento = await m.rodar(cenario([{ tipo: 'navegar', url: '/lenta', tempo_limite_ms: 2000 }]));

    expect(andamento.estado).toBe('erro');
    expect(andamento.falhas[0]!.motivo).toContain('Tempo limite de 2000 ms');
    expect(andamento.falhas[0]!.motivo).toContain('/lenta');
  });
});

describe('esperar', () => {
  it('por tempo: espera exatamente os ms pedidos, sem falar com a página', async () => {
    const m = await montar();
    const antes = m.relogio.agora();
    let comandosAntes = 0;
    m.pagina.aoComando = (metodo) => {
      if (metodo === 'Browser.getVersion') comandosAntes = m.transporte.comandos.length;
    };
    const andamento = await m.rodar(cenario([{ tipo: 'esperar', ms: 1234 }]));

    expect(m.relogio.agora() - antes).toBe(1234);
    expect(m.transporte.comandos.length).toBe(comandosAntes);
    expect(andamento.estado).toBe('concluida');
  });

  it('por tempo maior que o tempo limite padrão não é erro', async () => {
    const m = await montar();
    const andamento = await m.rodar(cenario([{ tipo: 'esperar', ms: 15_000 }]));
    expect(andamento.estado).toBe('concluida');
  });

  it('por seletor: só avança quando o elemento existe, sondando a cada 50 ms', async () => {
    const m = await montar();
    const inicio = m.relogio.agora();
    m.relogio.aoAvancar = (agora) => {
      if (agora - inicio >= 200) m.pagina.elementos.set('#modal', { x: 1, y: 1 });
    };
    const andamento = await m.rodar(cenario([{ tipo: 'esperar', seletor: '#modal' }, { tipo: 'clicar', seletor: ABRIR }]));

    expect(andamento.estado).toBe('concluida');
    expect(m.relogio.agora() - inicio).toBeGreaterThanOrEqual(200);
    expect(m.relogio.esperado % 50).toBe(0);
    expect(m.cliques()).toHaveLength(1);
  });

  it('por seletor: tempo limite padrão de 10 s, com o seletor na mensagem', async () => {
    const m = await montar();
    const inicio = m.relogio.agora();
    const andamento = await m.rodar(cenario([{ tipo: 'esperar', seletor: '#nunca' }, { tipo: 'clicar', seletor: ABRIR }]));

    expect(andamento.estado).toBe('erro');
    expect(m.relogio.agora() - inicio).toBe(10_000);
    expect(andamento.falhas).toEqual([
      { caminho: '/passos/0', tipoPasso: 'esperar', iteracao: null, acao: 'interrompeu', motivo: 'Tempo limite de 10000 ms: nenhum elemento corresponde a "#nunca".' },
    ]);
    expect(m.cliques()).toEqual([]);
  });

  it('por seletor: respeita tempo_limite_ms', async () => {
    const m = await montar();
    const inicio = m.relogio.agora();
    await m.rodar(cenario([{ tipo: 'esperar', seletor: '#nunca', tempo_limite_ms: 300 }]));
    expect(m.relogio.agora() - inicio).toBe(300);
  });
});

describe('aguardar_inatividade', () => {
  it('sem rede nem long tasks, conclui depois da janela pedida', async () => {
    const m = await montar();
    const inicio = m.relogio.agora();
    const andamento = await m.rodar(cenario([{ tipo: 'aguardar_inatividade', ms: 300 }]));
    expect(andamento.estado).toBe('concluida');
    expect(m.relogio.agora() - inicio).toBe(300);
  });

  it('usa 500 ms quando o passo não informa a janela', async () => {
    const m = await montar();
    const inicio = m.relogio.agora();
    await m.rodar(cenario([{ tipo: 'aguardar_inatividade' }]));
    expect(m.relogio.agora() - inicio).toBe(500);
  });

  it('espera as requisições em andamento terminarem e conta a janela a partir do fim da última', async () => {
    const m = await montar();
    const inicio = m.relogio.agora();
    m.pagina.aoComando = (metodo) => {
      if (metodo === 'Browser.getVersion') {
        m.transporte.emitir(ABA, 'Network.requestWillBeSent', { requestId: 'r1' });
        m.transporte.emitir(ABA, 'Network.requestWillBeSent', { requestId: 'r2' });
      }
    };
    m.relogio.aoAvancar = (agora) => {
      if (agora - inicio === 400) m.transporte.emitir(ABA, 'Network.loadingFinished', { requestId: 'r1' });
      if (agora - inicio === 700) m.transporte.emitir(ABA, 'Network.loadingFailed', { requestId: 'r2' });
    };
    const andamento = await m.rodar(cenario([{ tipo: 'aguardar_inatividade', ms: 300 }]));

    expect(andamento.estado).toBe('concluida');
    expect(m.relogio.agora() - inicio).toBe(1000);
  });

  it('uma long task reportada reinicia a janela', async () => {
    const m = await montar();
    const inicio = m.relogio.agora();
    m.relogio.aoAvancar = (agora) => {
      if (agora - inicio === 200) m.longTask.fim = agora;
    };
    await m.rodar(cenario([{ tipo: 'aguardar_inatividade', ms: 300 }]));
    expect(m.relogio.agora() - inicio).toBe(500);
  });

  it('requisição que nunca termina estoura o tempo limite', async () => {
    const m = await montar();
    m.pagina.aoComando = (metodo) => {
      if (metodo === 'Browser.getVersion') m.transporte.emitir(ABA, 'Network.requestWillBeSent', { requestId: 'preso' });
    };
    const andamento = await m.rodar(cenario([{ tipo: 'aguardar_inatividade', ms: 300, tempo_limite_ms: 2000 }]));

    expect(andamento.estado).toBe('erro');
    expect(andamento.falhas[0]!.motivo).toContain('1 requisição(ões) em andamento');
  });
});

describe('repetir, aquecimento e iterações', () => {
  const comAquecimento = cenario([{ tipo: 'esperar', ms: 10 }, { tipo: 'repetir', vezes: 'iteracoes', passos: [...CICLO, { tipo: 'esperar', ms: 100 }] }], {
    aquecimento: [...CICLO, { tipo: 'esperar', ms: 100 }],
  });

  it('executa o aquecimento uma vez e os passos do repetir o número de vezes resolvido', async () => {
    const m = await montar();
    const andamento = await m.rodar(comAquecimento, { iteracoes: 3 });

    expect(andamento.estado).toBe('concluida');
    expect(m.cliques()).toHaveLength(2 + 3 * 2);
    expect(andamento.totalIteracoes).toBe(3);
    expect(andamento.iteracoes.map((i) => [i.numero, i.completa, i.passosExecutados])).toEqual([
      [1, true, 3],
      [2, true, 3],
      [3, true, 3],
    ]);
    // 3 do aquecimento + 1 antes do repetir + 9 das iterações.
    expect(andamento.passosExecutados).toBe(13);
  });

  it('passa pelos estados na ordem da tabela', async () => {
    const m = await montar();
    await m.rodar(comAquecimento, { iteracoes: 2 });
    expect(m.estados).toEqual([
      'preparando',
      'aquecendo',
      'executando',
      'coletando',
      'executando',
      'coletando',
      'executando',
      'coletando',
      'concluida',
    ]);
  });

  it('marca o início e o fim do aquecimento e de cada iteração', async () => {
    const m = await montar();
    const andamento = await m.rodar(comAquecimento, { iteracoes: 2 });

    expect(m.marcas.map(({ fase, iteracao }) => `${fase}:${iteracao}`)).toEqual([
      'inicio:aquecimento',
      'fim:aquecimento',
      'inicio:1',
      'fim:1',
      'inicio:2',
      'fim:2',
    ]);
    expect(andamento.aquecimento).toEqual({ inicio: m.marcas[0]!.instante, fim: m.marcas[1]!.instante });
    expect(andamento.iteracoes[0]).toMatchObject({ inicio: m.marcas[2]!.instante, fim: m.marcas[3]!.instante });
  });

  it('registros do aquecimento são descartados e os demais recebem o número da iteração', async () => {
    const m = await montar();
    const andamento = await m.rodar(comAquecimento, { iteracoes: 3 });
    const marcacao: Marcacao = andamento;
    const meio = (i: { inicio: number; fim: number | null }): number => (i.inicio + i.fim!) / 2;

    const dados = aplicarLote(
      dadosVazios(),
      {
        documento: { id: 'd', url: 'http://localhost:4300/limpa', inicio: 0 },
        longTasks: [
          { inicio: meio(andamento.aquecimento!), duracao: 80 },
          { inicio: andamento.aquecimento!.fim! + 1, duracao: 60 }, // entre o aquecimento e a iteração 1
          { inicio: meio(andamento.iteracoes[0]!), duracao: 70 },
          { inicio: meio(andamento.iteracoes[2]!), duracao: 90 },
          { inicio: meio(andamento.iteracoes[2]!) + 1, duracao: 30 },
        ],
        interacoes: [
          { id: 1, documento: 'd', inicio: meio(andamento.aquecimento!), duracao: 50, tipo: 'click', alvo: 'button' },
          { id: 2, documento: 'd', inicio: meio(andamento.iteracoes[1]!), duracao: 64, tipo: 'click', alvo: 'button' },
        ],
        metricas: {},
      },
      marcacao,
    );

    expect(dados.longTasks.map((t) => [t.duracao, t.iteracao])).toEqual([
      [60, null],
      [70, 1],
      [90, 3],
      [30, 3],
    ]);
    expect(dados.interacoes.map((i) => [i.id, i.iteracao])).toEqual([[2, 2]]);

    const estatisticas = estatisticasDaExecucao(dados, andamento.iteracoes, ['processamento']);
    expect(estatisticas.find((e) => e.id === 'tempo-long-tasks')).toMatchObject({ amostras: 3, mediana: 70, p95: 115 });
    expect(estatisticas.find((e) => e.id === 'pior-interacao')).toMatchObject({ amostras: 1, mediana: 64 });
    expect(estatisticas.find((e) => e.id === 'duracao-iteracao')?.amostras).toBe(3);
  });

  it('repetir com número fixo ignora as iterações da execução; repetir aninhado é só um laço', async () => {
    const m = await montar();
    const aninhado = cenario([
      { tipo: 'repetir', vezes: 2, passos: [{ tipo: 'repetir', vezes: 3, passos: [{ tipo: 'clicar', seletor: ABRIR }] }] },
    ]);
    const andamento = await m.rodar(aninhado, { iteracoes: 7 });

    expect(m.cliques()).toHaveLength(6);
    expect(andamento.iteracoes.map((i) => [i.numero, i.passosExecutados])).toEqual([
      [1, 3],
      [2, 3],
    ]);
    expect(andamento.totalIteracoes).toBe(2);
  });

  it('dois repetir no nível principal continuam a numeração', async () => {
    const passos: Passo[] = [
      { tipo: 'repetir', vezes: 2, passos: CICLO },
      { tipo: 'repetir', vezes: 'iteracoes', passos: CICLO },
    ];
    expect(contarIteracoes(passos, 4)).toBe(6);
    const m = await montar();
    const andamento = await m.rodar(cenario(passos), { iteracoes: 4 });
    expect(andamento.iteracoes.map((i) => i.numero)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('execuções repetidas do mesmo cenário produzem a mesma sequência de comandos', async () => {
    const sequencias: string[][] = [];
    for (let i = 0; i < 3; i++) {
      const m = await montar();
      const andamento = await m.rodar(comAquecimento, { iteracoes: 4 });
      sequencias.push([...m.metodos(), `passos:${andamento.passosExecutados}`, `iteracoes:${andamento.iteracoes.length}`]);
    }
    expect(sequencias[1]).toEqual(sequencias[0]);
    expect(sequencias[2]).toEqual(sequencias[0]);
  });
});

describe('tempo limite e política de erro', () => {
  /** O botão de fechar some na iteração indicada e volta na seguinte. */
  function sumirNaIteracao(m: Montagem, numero: number): void {
    const original = m.pagina.elementos.get(FECHAR)!;
    let iteracao = 0;
    m.pagina.aoComando = (metodo, p) => {
      if (metodo !== 'Input.dispatchMouseEvent' || p['type'] !== 'mousePressed' || p['x'] !== 100) return;
      iteracao++;
      if (iteracao === numero) m.pagina.elementos.delete(FECHAR);
      else m.pagina.elementos.set(FECHAR, original);
    };
  }

  it('interromper (padrão): a execução para e informa o passo, a iteração e o motivo', async () => {
    const m = await montar();
    sumirNaIteracao(m, 2);
    const andamento = await m.rodar(cenario([{ tipo: 'repetir', vezes: 'iteracoes', passos: CICLO }]), { iteracoes: 4 });

    expect(andamento.estado).toBe('erro');
    expect(andamento.falhas).toEqual([
      {
        caminho: '/passos/0/passos/1',
        tipoPasso: 'clicar',
        iteracao: 2,
        acao: 'interrompeu',
        motivo: `Tempo limite de 10000 ms: nenhum elemento corresponde a "${FECHAR}".`,
      },
    ]);
    expect(andamento.iteracoes.map((i) => [i.numero, i.completa])).toEqual([
      [1, true],
      [2, false],
    ]);
    // Nenhum passo depois da falha: 2 cliques da iteração 1 e 1 da iteração 2.
    expect(m.cliques()).toHaveLength(3);
    expect(m.transporte.anexadas.size).toBe(0);
  });

  it('pular: a execução continua, e a iteração fica incompleta e fora das estatísticas', async () => {
    const m = await montar();
    sumirNaIteracao(m, 4);
    const passos: Passo[] = [
      {
        tipo: 'repetir',
        vezes: 'iteracoes',
        passos: [CICLO[0]!, { tipo: 'clicar', seletor: FECHAR, em_erro: 'pular', tempo_limite_ms: 200 }, { tipo: 'esperar', ms: 20 }],
      },
    ];
    const andamento = await m.rodar(cenario(passos), { iteracoes: 5 });

    expect(andamento.estado).toBe('concluida');
    expect(andamento.falhas).toEqual([expect.objectContaining({ caminho: '/passos/0/passos/1', iteracao: 4, acao: 'pulou' })]);
    expect(andamento.iteracoes.map((i) => i.completa)).toEqual([true, true, true, false, true]);
    expect(andamento.iteracoes[3]!.passosExecutados).toBe(2);

    const estatisticas = estatisticasDaExecucao(dadosVazios(), andamento.iteracoes, ['processamento']);
    expect(estatisticas.map((e) => e.amostras)).toEqual([4, 4, 0]);
  });

  it('repetir: tenta de novo e segue se uma das novas tentativas der certo', async () => {
    const m = await montar();
    m.pagina.elementos.delete(FECHAR);
    let tentativas = 0;
    m.relogio.aoAvancar = () => {
      // Cada tentativa dura 100 ms; o botão aparece durante a terceira.
      tentativas = Math.floor(m.relogio.esperado / 100);
      if (tentativas >= 2) m.pagina.elementos.set(FECHAR, { x: 200, y: 40 });
    };
    const andamento = await m.rodar(cenario([{ tipo: 'clicar', seletor: FECHAR, em_erro: 'repetir', tempo_limite_ms: 100 }]));

    expect(andamento.estado).toBe('concluida');
    expect(andamento.falhas).toEqual([]);
    expect(m.cliques()).toEqual([{ x: 200, y: 40 }]);
  });

  it('repetir: depois de 2 novas tentativas sem sucesso, interrompe', async () => {
    const m = await montar();
    const inicio = m.relogio.agora();
    const andamento = await m.rodar(
      cenario([{ tipo: 'esperar', seletor: '#nunca', em_erro: 'repetir', tempo_limite_ms: 100 }, { tipo: 'clicar', seletor: ABRIR }]),
    );

    expect(andamento.estado).toBe('erro');
    expect(m.relogio.agora() - inicio).toBe(300);
    expect(andamento.falhas).toEqual([
      expect.objectContaining({ acao: 'interrompeu', motivo: expect.stringContaining('(3 tentativas)') }),
    ]);
    expect(m.cliques()).toEqual([]);
  });

  it('seletor inválido vira erro do passo, com a explicação da página', async () => {
    const m = await montar();
    const andamento = await m.rodar(cenario([{ tipo: 'esperar', seletor: '!!ruim' }]));
    expect(andamento.estado).toBe('erro');
    expect(andamento.falhas[0]!.motivo).toContain('not a valid selector');
  });

  it('falha no aquecimento com interromper encerra a execução antes das iterações', async () => {
    const m = await montar();
    const andamento = await m.rodar(
      cenario([{ tipo: 'repetir', vezes: 2, passos: CICLO }], { aquecimento: [{ tipo: 'clicar', seletor: '#nada', tempo_limite_ms: 100 }] }),
    );
    expect(andamento.estado).toBe('erro');
    expect(andamento.falhas[0]).toMatchObject({ caminho: '/aquecimento/0', iteracao: null });
    expect(andamento.iteracoes).toEqual([]);
    expect(andamento.aquecimento?.fim).not.toBeNull();
  });
});

describe('cancelamento e limpeza', () => {
  it('cancelar no meio da iteração: nenhum passo seguinte roda e o debugger é desanexado', async () => {
    const m = await montar();
    let pressionados = 0;
    let comandosNoCancelamento = -1;
    m.pagina.aoComando = (metodo, p) => {
      if (metodo === 'Input.dispatchMouseEvent' && p['type'] === 'mousePressed' && ++pressionados === 5) {
        // Durante o primeiro clique da iteração 3.
        m.controle.abort(MOTIVO_CANCELAMENTO);
        comandosNoCancelamento = m.transporte.comandos.length;
      }
    };
    const andamento = await m.rodar(cenario([{ tipo: 'repetir', vezes: 'iteracoes', passos: CICLO }, { tipo: 'clicar', seletor: ABRIR }]), {
      iteracoes: 10,
    });

    expect(andamento.estado).toBe('cancelada');
    expect(andamento.iteracao).toBe(3);
    expect(andamento.iteracoes.map((i) => i.completa)).toEqual([true, true, false]);
    // O comando em curso foi o último enviado.
    expect(m.transporte.comandos.length).toBe(comandosNoCancelamento);
    expect(m.cliques()).toHaveLength(5);
    expect(m.transporte.chamadas.desanexar).toBe(1);
    expect(m.transporte.anexadas.size).toBe(0);
    expect(m.transporte.ouvintesAtivos()).toBe(0);
    expect(andamento.falhas).toEqual([]);
  });

  it('cancelar durante uma espera interrompe a espera', async () => {
    const m = await montar();
    const inicio = m.relogio.agora();
    m.relogio.aoAvancar = (agora) => {
      if (agora - inicio >= 250) m.controle.abort(MOTIVO_CANCELAMENTO);
    };
    const andamento = await m.rodar(cenario([{ tipo: 'esperar', seletor: '#nunca' }, { tipo: 'clicar', seletor: ABRIR }]));

    expect(andamento.estado).toBe('cancelada');
    expect(m.relogio.agora() - inicio).toBe(250);
    expect(m.cliques()).toEqual([]);
    expect(m.transporte.chamadas.desanexar).toBe(1);
  });

  it('cancelado antes de começar: nada é enviado além da limpeza', async () => {
    const m = await montar();
    m.controle.abort(MOTIVO_CANCELAMENTO);
    const andamento = await m.rodar(cenario(CICLO));
    expect(andamento.estado).toBe('cancelada');
    expect(m.transporte.comandos).toEqual([]);
    expect(m.transporte.anexadas.size).toBe(0);
  });

  it('um comando que nunca responde não impede o cancelamento', async () => {
    const m = await montar();
    const responder = m.transporte.responder;
    m.transporte.responder = (metodo, p) => {
      if (metodo === 'Input.insertText') {
        queueMicrotask(() => m.controle.abort(MOTIVO_CANCELAMENTO));
        return new Promise(() => undefined);
      }
      return responder(metodo, p);
    };
    m.pagina.elementos.set('#campo', { x: 1, y: 1 });
    const andamento = await m.rodar(cenario([{ tipo: 'digitar', seletor: '#campo', texto: 'x' }]));
    expect(andamento.estado).toBe('cancelada');
    expect(m.transporte.anexadas.size).toBe(0);
  });

  it('desanexa também ao concluir normalmente', async () => {
    const m = await montar();
    await m.rodar(cenario(CICLO));
    expect(m.transporte.chamadas.desanexar).toBe(1);
    expect(m.transporte.ouvintesAtivos()).toBe(0);
  });

  it('conexão perdida no meio: termina em erro, com a iteração em curso incompleta', async () => {
    const m = await montar();
    let pressionados = 0;
    m.pagina.aoComando = (metodo, p) => {
      if (metodo === 'Input.dispatchMouseEvent' && p['type'] === 'mousePressed' && ++pressionados === 3) {
        m.transporte.derrubar(ABA, 'canceled_by_user');
        m.controle.abort(MOTIVO_CONEXAO_PERDIDA);
      }
    };
    const andamento = await m.rodar(cenario([{ tipo: 'repetir', vezes: 5, passos: CICLO }]));

    expect(andamento.estado).toBe('erro');
    expect(andamento.iteracoes.map((i) => i.completa)).toEqual([true, false]);
    expect(andamento.falhas).toEqual([expect.objectContaining({ iteracao: 2, motivo: 'A conexão com o debugger foi perdida.' })]);
    expect(m.cliques()).toHaveLength(3);
  });
});

describe('passos de medição', () => {
  const MEDIR: Passo = { tipo: 'medir', metricas: ['heap_usado', 'nos_dom', 'listeners'] };
  const comMedicao = cenario([
    { tipo: 'forcar_gc' },
    { tipo: 'forcar_gc' },
    { tipo: 'snapshot', rotulo: 'inicio' },
    { tipo: 'repetir', vezes: 'iteracoes', passos: [...CICLO, { tipo: 'forcar_gc' }, MEDIR] },
    { tipo: 'snapshot', rotulo: 'fim' },
  ]);
  const semMedicao = cenario([{ tipo: 'repetir', vezes: 'iteracoes', passos: CICLO }]);
  const MEMORIA = ['processamento', 'memoria'];
  /** Comandos que só a medição de memória envia, com o grupo de objetos quando há. */
  const deMemoria = (m: Montagem): string[] =>
    m.transporte.comandos
      .filter((c) => DE_MEMORIA.test(c.metodo) || (c.parametros as { expression?: string } | undefined)?.expression === 'Object.prototype')
      .map((c) => {
        const grupo = (c.parametros as { objectGroup?: string } | undefined)?.objectGroup;
        return grupo ? `${c.metodo} ${grupo}` : c.metodo;
      });
  const COLETA = [`Runtime.evaluate ${GRUPO_COLETA}`, `Runtime.queryObjects ${GRUPO_COLETA}`, `Runtime.releaseObjectGroup ${GRUPO_COLETA}`];
  const MEDICAO = ['Performance.enable', 'Performance.getMetrics'];
  const CENSO = [`Runtime.evaluate ${GRUPO_CENSO}`, `Runtime.queryObjects ${GRUPO_CENSO}`, 'Runtime.callFunctionOn', `Runtime.releaseObjectGroup ${GRUPO_CENSO}`];

  it('sem "Memória" nem "DOM e listeners", os passos de memória não geram nenhum comando de CDP', async () => {
    const com = await montar();
    const andamentoCom = await com.rodar(comMedicao, { verificacoesAtivas: ['processamento', 'carregamento', 'erros-pagina'] });
    const sem = await montar();
    const andamentoSem = await sem.rodar(semMedicao);

    expect(andamentoCom.estado).toBe('concluida');
    expect(com.transporte.comandos).toEqual(sem.transporte.comandos);
    expect(deMemoria(com)).toEqual([]);
    // Nada dos domínios que o chrome.debugger nem oferece a extensões.
    expect(com.metodos().some((metodo) => /HeapProfiler|Memory\.|getHeapUsage/.test(metodo))).toBe(false);
    // Os passos de ação rodam todos, e os de medição não contam como executados.
    expect(andamentoCom.passosExecutados).toBe(andamentoSem.passosExecutados);
    expect(andamentoCom.iteracoes).toHaveLength(3);
    expect(com.dados).toEqual(dadosVazios());
  });

  it('com "Memória", nenhum comando sai dos domínios que o chrome.debugger recusa a extensões', async () => {
    const m = await montar();
    await m.rodar(comMedicao, { verificacoesAtivas: ['memoria', 'dom-listeners'] });
    expect(deMemoria(m).length).toBeGreaterThan(0);
    expect(m.metodos().some((metodo) => /HeapProfiler|Memory\.|Profiler\.|getHeapUsage/.test(metodo))).toBe(false);
  });

  it('forcar_gc: uma coleta por passo, o grupo de objetos é liberado, e o passo seguinte só começa depois da resposta', async () => {
    const m = await montar();
    const ordem: string[] = [];
    const original = m.transporte.enviar;
    m.transporte.enviar = async (idAba, metodo, parametros) => {
      const resposta = await original(idAba, metodo, parametros);
      if (ehColeta(metodo, parametros)) {
        // A coleta demora: se o runner não esperasse, a medição sairia antes deste registro.
        await m.relogio.esperar(300);
        ordem.push('coleta concluída');
      } else if (metodo === 'Performance.getMetrics') ordem.push('medição');
      return resposta;
    };
    const andamento = await m.rodar(cenario([{ tipo: 'forcar_gc' }, { tipo: 'forcar_gc' }, MEDIR]), { verificacoesAtivas: MEMORIA });

    expect(andamento.estado).toBe('concluida');
    expect(deMemoria(m)).toEqual([...COLETA, ...COLETA, ...MEDICAO]);
    expect(ordem).toEqual(['coleta concluída', 'coleta concluída', 'medição']);
    expect(andamento.passosExecutados).toBe(3);
  });

  it('medir: uma medição por iteração, com o número da iteração', async () => {
    const m = await montar();
    m.pagina.aoComando = (metodo, parametros) => {
      if (ehColeta(metodo, parametros)) m.pagina.memoria.heap += 1000;
    };
    const andamento = await m.rodar(cenario([{ tipo: 'repetir', vezes: 'iteracoes', passos: [...CICLO, { tipo: 'forcar_gc' }, MEDIR] }]), {
      iteracoes: 10,
      verificacoesAtivas: MEMORIA,
    });

    expect(andamento.estado).toBe('concluida');
    expect(m.dados.medicoes).toHaveLength(10);
    expect(m.dados.medicoes.map((x) => x.iteracao)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(m.dados.medicoes[0]).toMatchObject({ heapUsado: 1_001_000, nosDom: 50, listeners: 10 });
    expect(m.dados.medicoes[9]!.heapUsado).toBe(1_010_000);
    expect(m.dados.snapshots).toEqual([]);
  });

  it('medir respeita o campo metricas: só registra o que foi pedido', async () => {
    const soHeap = await montar();
    await soHeap.rodar(cenario([{ tipo: 'medir', metricas: ['heap_usado'] }]), { verificacoesAtivas: MEMORIA });
    expect(deMemoria(soHeap)).toEqual(MEDICAO);
    expect(soHeap.dados.medicoes).toEqual([expect.objectContaining({ heapUsado: 1_000_000, nosDom: null, listeners: null, iteracao: null })]);

    const soListeners = await montar();
    await soListeners.rodar(cenario([{ tipo: 'medir', metricas: ['listeners'] }]), { verificacoesAtivas: MEMORIA });
    expect(soListeners.dados.medicoes).toEqual([expect.objectContaining({ heapUsado: null, nosDom: null, listeners: 10 })]);
  });

  it('snapshot: conta os objetos por construtor, guarda só o resumo com o rótulo e libera a lista de objetos', async () => {
    const m = await montar();
    const andamento = await m.rodar(comMedicao, { verificacoesAtivas: MEMORIA });

    expect(andamento.estado).toBe('concluida');
    expect(m.dados.snapshots.map((s) => [s.rotulo, s.iteracao])).toEqual([
      ['inicio', null],
      ['fim', null],
    ]);
    expect(m.dados.snapshots[0]).toMatchObject({
      totalObjetos: 7,
      construtores: [
        { nome: 'Item', contagem: 3 },
        { nome: 'Array', contagem: 1 },
        { nome: 'Function', contagem: 1 },
        { nome: 'Object', contagem: 1 },
        { nome: 'Painel', contagem: 1 },
      ],
      outros: null,
    });
    expect(deMemoria(m).slice(COLETA.length * 2, COLETA.length * 2 + CENSO.length)).toEqual(CENSO);
    // A contagem roda na página; de lá só volta a tabela.
    const chamada = m.transporte.comandos.find((c) => c.metodo === 'Runtime.callFunctionOn')!.parametros as Record<string, unknown>;
    expect(chamada).toMatchObject({ objectId: 'lista', returnByValue: true, arguments: [{ value: 500 }] });
    expect(String(chamada['functionDeclaration'])).toMatch(/^function contarPorConstrutor\(/);
    expect(m.dados.pausasDeMedicao).toHaveLength(2);
    expect(m.dados.pausasDeMedicao.every((p) => p.fim !== null)).toBe(true);
  });

  it('snapshot: o resumo é limitado, e o resto é somado em "outros"', async () => {
    const m = await montar();
    m.limiteConstrutores = 2;
    await m.rodar(cenario([{ tipo: 'snapshot', rotulo: 'inicio' }]), { verificacoesAtivas: MEMORIA });
    expect(m.dados.snapshots[0]).toMatchObject({
      totalObjetos: 7,
      construtores: [
        { nome: 'Item', contagem: 3 },
        { nome: 'Array', contagem: 1 },
      ],
      outros: { nome: '(outros)', contagem: 3 },
    });
  });

  it('snapshot que a página recusa: o passo falha com o motivo, segue a política em_erro e libera a lista', async () => {
    const interrompe = await montar();
    interrompe.pagina.erroNoCenso = 'TypeError: Map is not a constructor\n    at contarPorConstrutor';
    const erro = await interrompe.rodar(cenario([{ tipo: 'snapshot', rotulo: 'inicio' }, ...CICLO]), { verificacoesAtivas: MEMORIA });
    expect(erro.estado).toBe('erro');
    expect(erro.falhas).toEqual([
      {
        caminho: '/passos/0',
        tipoPasso: 'snapshot',
        iteracao: null,
        motivo: 'A página recusou a contagem de objetos: TypeError: Map is not a constructor',
        acao: 'interrompeu',
      },
    ]);
    expect(interrompe.cliques()).toHaveLength(0);
    expect(interrompe.dados.snapshots).toEqual([]);
    expect(deMemoria(interrompe).at(-1)).toBe(`Runtime.releaseObjectGroup ${GRUPO_CENSO}`);

    const pula = await montar();
    pula.pagina.erroNoCenso = 'Error: falhou';
    const segue = await pula.rodar(cenario([{ tipo: 'snapshot', rotulo: 'inicio', em_erro: 'pular' }, ...CICLO]), { verificacoesAtivas: MEMORIA });
    expect(segue.estado).toBe('concluida');
    expect(segue.falhas).toEqual([expect.objectContaining({ tipoPasso: 'snapshot', acao: 'pulou' })]);
    expect(pula.cliques()).toHaveLength(2);
  });

  it('snapshot que não termina: falha no tempo limite do passo', async () => {
    const m = await montar();
    m.pagina.censoTravado = true;
    const andamento = await m.rodar(cenario([{ tipo: 'snapshot', rotulo: 'inicio', tempo_limite_ms: 2000 }]), { verificacoesAtivas: MEMORIA });
    expect(andamento.estado).toBe('erro');
    expect(andamento.falhas[0]!.motivo).toBe('Tempo limite de 2000 ms: a contagem de objetos não terminou.');
    expect(TEMPO_LIMITE_SNAPSHOT_MS).toBeGreaterThan(2000);
  });

  it('long task durante o snapshot é marcada como causada pela medição e sai das estatísticas', async () => {
    const m = await montar();
    let instanteDoSnapshot = 0;
    m.pagina.aoComando = (metodo) => {
      if (metodo === 'Runtime.callFunctionOn') instanteDoSnapshot = m.relogio.agora();
    };
    const andamento = await m.rodar(
      cenario([{ tipo: 'repetir', vezes: 'iteracoes', passos: [...CICLO, { tipo: 'snapshot', rotulo: 'meio' }, { tipo: 'esperar', ms: 500 }] }]),
      { iteracoes: 1, verificacoesAtivas: MEMORIA },
    );
    expect(andamento.estado).toBe('concluida');

    // O lote da página chega depois: uma long task que cobre o snapshot e outra da própria página.
    const inicioDaIteracao = andamento.iteracoes[0]!.inicio;
    aplicarLote(
      m.dados,
      {
        documento: { id: 'd', url: 'http://localhost:4300/limpa', inicio: 0 },
        longTasks: [
          { inicio: inicioDaIteracao + 10, duracao: 60 },
          { inicio: instanteDoSnapshot - 5, duracao: 900 },
        ],
        interacoes: [],
        metricas: {},
      },
      andamento,
    );
    expect(m.dados.longTasks.map((t) => t.causadaPelaMedicao ?? false)).toEqual([false, true]);
    const tempo = estatisticasDaExecucao(m.dados, andamento.iteracoes, ['processamento']).find((e) => e.id === 'tempo-long-tasks');
    expect(tempo).toMatchObject({ amostras: 1, mediana: 60 });
  });

  it('"DOM e listeners": coleta o lixo e lê os contadores depois do aquecimento e no fim, mesmo sem "Memória"', async () => {
    const m = await montar();
    let cliques = 0;
    m.pagina.aoComando = (metodo, parametros) => {
      if (metodo !== 'Input.dispatchMouseEvent' || parametros['type'] !== 'mousePressed' || ++cliques % 2 === 0) return;
      m.pagina.memoria.listeners++;
      m.pagina.memoria.desanexados += 3;
    };
    const andamento = await m.rodar(cenario([{ tipo: 'forcar_gc' }, { tipo: 'repetir', vezes: 'iteracoes', passos: CICLO }], { aquecimento: CICLO }), {
      iteracoes: 4,
      verificacoesAtivas: ['dom-listeners'],
    });
    expect(andamento.estado).toBe('concluida');
    // O ciclo do aquecimento já tinha acontecido na leitura inicial; cada iteração acrescenta 1 listener e 3 nós.
    expect(m.dados.contadoresDom).toEqual({
      inicio: { nosDom: 50, listeners: 11, nosDesanexados: 3 },
      fim: { nosDom: 50, listeners: 15, nosDesanexados: 15 },
    });
    const LEITURA = [...COLETA, ...MEDICAO, 'DOM.enable', 'DOM.getDetachedDomNodes', 'DOM.disable'];
    // Sem "Memória", o passo forcar_gc do cenário não roda: as coletas são só as das duas leituras.
    expect(deMemoria(m)).toEqual([...LEITURA, ...LEITURA]);
  });

  it('cancelar durante o snapshot: a execução para sem resumo', async () => {
    const m = await montar();
    m.pagina.censoTravado = true;
    m.relogio.aoAvancar = () => {
      if (m.metodos().includes('Runtime.callFunctionOn')) m.controle.abort(MOTIVO_CANCELAMENTO);
    };
    const andamento = await m.rodar(cenario([{ tipo: 'snapshot', rotulo: 'inicio' }, ...CICLO]), { verificacoesAtivas: MEMORIA });
    expect(andamento.estado).toBe('cancelada');
    expect(m.cliques()).toHaveLength(0);
    expect(m.dados.snapshots).toEqual([]);
  });
});

describe('perfil de CPU', () => {
  const COM_AQUECIMENTO = cenario([{ tipo: 'repetir', vezes: 'iteracoes', passos: CICLO }], { aquecimento: CICLO });
  const ehClique = (c: { metodo: string; parametros?: object }): boolean =>
    c.metodo === 'Input.dispatchMouseEvent' && (c.parametros as { type: string }).type === 'mousePressed';

  it('liga o perfil depois do aquecimento e para ao final dos passos principais', async () => {
    const m = await montar();
    m.pagina.trace.entregas = [entregaDePerfil([{ nome: 'pesada', delta: 3000 }])];
    const andamento = await m.rodar(COM_AQUECIMENTO, { iteracoes: 2, verificacoesAtivas: ['cpu', 'dom-listeners'] });

    expect(andamento.estado).toBe('concluida');
    const comandos = m.transporte.comandos;
    expect(m.metodos().filter((metodo) => DE_CPU.test(metodo))).toEqual(['Tracing.start', 'Tracing.end']);
    const inicio = m.metodos().indexOf('Tracing.start');
    const fim = m.metodos().indexOf('Tracing.end');
    const cliques = comandos.flatMap((c, i) => (ehClique(c) ? [i] : []));
    // 2 cliques de aquecimento antes do perfil; os 4 das iterações, dentro dele.
    expect(cliques.filter((i) => i < inicio)).toHaveLength(2);
    expect(cliques.filter((i) => i > inicio && i < fim)).toHaveLength(4);
    // As leituras de "DOM e listeners" ficam fora: a de início antes, a de fim depois.
    const leiturasDom = comandos.flatMap((c, i) => (c.metodo === 'DOM.getDetachedDomNodes' ? [i] : []));
    expect(leiturasDom).toHaveLength(2);
    expect(leiturasDom[0]).toBeLessThan(inicio);
    expect(leiturasDom[1]).toBeGreaterThan(fim);
    expect(comandos[inicio]!.parametros).toEqual({
      traceConfig: { includedCategories: ['disabled-by-default-v8.cpu_profiler'] },
      transferMode: 'ReportEvents',
    });

    expect(m.dados.cpu).toMatchObject({ estado: 'concluida', ativo: true, falha: null, incompleto: false, limiteAtingido: false });
    expect(m.dados.cpu!.resumo!.funcoes).toEqual([
      { nome: 'pesada', arquivo: 'http://localhost:4300/app.js', linha: 1, coluna: 3, tempoProprio: 3, tempoTotal: 3, percentual: 100 },
    ]);
  });

  it('sem "CPU": nenhum comando de trace é enviado e não há perfil', async () => {
    const m = await montar();
    const andamento = await m.rodar(COM_AQUECIMENTO, { verificacoesAtivas: ['processamento', 'memoria', 'dom-listeners'] });
    expect(andamento.estado).toBe('concluida');
    expect(m.metodos().some((metodo) => DE_CPU.test(metodo))).toBe(false);
    expect(m.dados.cpu).toBeNull();
  });

  it('as amostras durante o snapshot e a coleta forçada ficam fora do resumo', async () => {
    const m = await montar();
    // O relógio do trace anda 1000 µs por leitura: a coleta forçada fica em [1000, 2000]
    // e o snapshot, em [3000, 4000].
    m.pagina.trace.entregas = [
      entregaDePerfil([
        { nome: 'antes', delta: 500 }, // 500
        { nome: 'naColeta', delta: 1000 }, // 1500
        { nome: 'entre', delta: 1000 }, // 2500
        { nome: 'noCenso', delta: 1000 }, // 3500
        { nome: 'depois', delta: 1000 }, // 4500
      ]),
    ];
    const c = cenario([{ tipo: 'forcar_gc' }, { tipo: 'repetir', vezes: 1, passos: CICLO }, { tipo: 'snapshot', rotulo: 'fim' }]);
    const andamento = await m.rodar(c, { verificacoesAtivas: ['cpu', 'memoria'] });

    expect(andamento.estado).toBe('concluida');
    expect(m.dados.snapshots).toHaveLength(1);
    expect(m.dados.cpu!.resumo!.funcoes.map((f) => f.nome).sort()).toEqual(['antes', 'depois', 'entre']);
    expect(m.dados.cpu!.resumo!.tempoAmostrado).toBe(2.5);
    // Cada intervalo é lido no relógio do trace, antes e depois da operação.
    const metodos = m.metodos();
    const coleta = m.transporte.comandos.findIndex((c2) => ehColeta(c2.metodo, c2.parametros));
    expect(metodos.slice(coleta - 3, coleta - 1)).toEqual(['Performance.enable', 'Performance.getMetrics']);
    expect(metodos.filter((metodo) => metodo === 'Performance.getMetrics')).toHaveLength(4);
  });

  it('só o resumo é guardado: nada do perfil bruto fica nos dados', async () => {
    const m = await montar();
    m.pagina.trace.entregas = [entregaDePerfil([{ nome: 'pesada', delta: 3000 }]), entregaDePerfil([{ nome: 'pesada', delta: 1000 }]).slice(1)];
    await m.rodar(COM_AQUECIMENTO, { verificacoesAtivas: ['cpu'] });
    const texto = JSON.stringify(m.dados);
    expect(m.dados.cpu!.resumo!.funcoes[0]!.tempoProprio).toBe(4);
    for (const campo of ['ProfileChunk', 'timeDeltas', 'samples', 'cpuProfile', 'callFrame']) expect(texto).not.toContain(campo);
    expect(Object.keys(m.dados.cpu!)).toEqual(['estado', 'ativo', 'resumo', 'falha', 'incompleto', 'limiteAtingido']);
  });

  it('cancelar com o perfil ligado: o trace é parado antes de o debugger sair, sem resumo', async () => {
    const m = await montar();
    m.pagina.trace.entregas = [entregaDePerfil([{ nome: 'pesada', delta: 3000 }])];
    let cliques = 0;
    m.pagina.aoComando = (metodo, parametros) => {
      // Terceiro clique: o primeiro depois do aquecimento, já com o perfil ligado.
      if (metodo === 'Input.dispatchMouseEvent' && parametros['type'] === 'mousePressed' && ++cliques === 3) m.controle.abort(MOTIVO_CANCELAMENTO);
    };
    const andamento = await m.rodar(COM_AQUECIMENTO, { verificacoesAtivas: ['cpu'] });

    expect(andamento.estado).toBe('cancelada');
    expect(m.metodos().filter((metodo) => DE_CPU.test(metodo))).toEqual(['Tracing.start', 'Tracing.end']);
    expect(m.metodos().at(-1)).toBe('Tracing.end');
    expect(m.pagina.trace.aberto).toBe(false);
    expect(m.dados.cpu!.resumo).toBeNull();
    expect(m.transporte.anexadas.size).toBe(0);
    expect(m.transporte.ouvintesAtivos()).toBe(0);
  });

  it('passo que falha com o perfil ligado: o trace é parado e o que foi gravado vira resumo', async () => {
    const m = await montar();
    m.pagina.trace.entregas = [entregaDePerfil([{ nome: 'pesada', delta: 3000 }])];
    const c = cenario([{ tipo: 'repetir', vezes: 2, passos: [...CICLO, { tipo: 'clicar', seletor: '#nao-existe', tempo_limite_ms: 200 }] }]);
    const andamento = await m.rodar(c, { verificacoesAtivas: ['cpu'] });

    expect(andamento.estado).toBe('erro');
    expect(m.metodos().filter((metodo) => DE_CPU.test(metodo))).toEqual(['Tracing.start', 'Tracing.end']);
    expect(m.pagina.trace.aberto).toBe(false);
    expect(m.dados.cpu).toMatchObject({ estado: 'concluida', ativo: true });
    expect(m.dados.cpu!.resumo!.funcoes.map((f) => f.nome)).toEqual(['pesada']);
    expect(m.transporte.anexadas.size).toBe(0);
  });

  it('conexão perdida com o perfil ligado: termina em erro, sem resumo e sem prender o runner', async () => {
    const m = await montar();
    let cliques = 0;
    m.pagina.aoComando = (metodo, parametros) => {
      if (metodo === 'Input.dispatchMouseEvent' && parametros['type'] === 'mousePressed' && ++cliques === 3) {
        m.transporte.derrubar(ABA, 'canceled_by_user');
        m.controle.abort(MOTIVO_CONEXAO_PERDIDA);
      }
    };
    const andamento = await m.rodar(COM_AQUECIMENTO, { verificacoesAtivas: ['cpu'] });
    expect(andamento.estado).toBe('erro');
    expect(m.dados.cpu).toMatchObject({ estado: 'coletando', resumo: null });
  });

  it('o navegador recusa o trace: a execução conclui sem perfil, com o motivo', async () => {
    const m = await montar();
    m.pagina.trace.erroAoIniciar = '{"code":-32000,"message":"Tracing has already been started (possibly in another tab)."}';
    const andamento = await m.rodar(COM_AQUECIMENTO, { iteracoes: 2, verificacoesAtivas: ['cpu', 'memoria'] });

    expect(andamento.estado).toBe('concluida');
    expect(andamento.iteracoes.filter((i) => i.completa)).toHaveLength(2);
    expect(m.metodos().filter((metodo) => DE_CPU.test(metodo))).toEqual(['Tracing.start']);
    expect(m.dados.cpu).toEqual({
      estado: 'falhou',
      ativo: false,
      resumo: null,
      falha: 'O perfil de CPU não foi coletado: o navegador já tem um trace em andamento (uma gravação do painel Performance, por exemplo).',
      incompleto: false,
      limiteAtingido: false,
    });
  });

  it('o navegador perdeu dados do perfil: o resumo fica, marcado como incompleto', async () => {
    const m = await montar();
    m.pagina.trace.entregas = [entregaDePerfil([{ nome: 'pesada', delta: 3000 }])];
    m.pagina.trace.perda = true;
    await m.rodar(COM_AQUECIMENTO, { verificacoesAtivas: ['cpu'] });
    expect(m.dados.cpu).toMatchObject({ estado: 'concluida', incompleto: true });
    expect(m.dados.cpu!.resumo!.funcoes).toHaveLength(1);
  });

  it('a entrega do perfil não termina: depois do prazo, fica o que chegou, como incompleto', async () => {
    const m = await montar();
    m.pagina.trace.entregas = [entregaDePerfil([{ nome: 'pesada', delta: 3000 }])];
    m.pagina.trace.completar = false;
    const antes = m.relogio.agora();
    const andamento = await m.rodar(cenario([{ tipo: 'repetir', vezes: 1, passos: CICLO }]), { verificacoesAtivas: ['cpu'] });
    expect(andamento.estado).toBe('concluida');
    expect(m.relogio.agora() - antes).toBeGreaterThanOrEqual(TEMPO_LIMITE_ENTREGA_MS);
    expect(m.dados.cpu).toMatchObject({ estado: 'concluida', incompleto: true });
    expect(m.dados.cpu!.resumo!.funcoes).toHaveLength(1);
  });
});
