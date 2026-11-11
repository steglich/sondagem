import { describe, expect, it } from 'vitest';
import { type Marcacao, aplicarLote, dadosVazios, estatisticasDaExecucao } from '../shared/agregacao.ts';
import type { Cenario, Passo, PassoDeAcao } from '../shared/cenario.ts';
import { andamentoInicial } from '../shared/execucao-estado.ts';
import type { AndamentoExecucao, EstadoExecucao, Marca } from '../shared/types.ts';
import {
  ABA,
  ABRIR,
  FECHAR,
  type RelogioSimulado,
  type TransporteFalso,
  criarPagina,
  criarRelogioSimulado,
  criarTransporteFalso,
} from './apoio-teste.ts';
import { criarConexaoCdp } from './cdp.ts';
import { MOTIVO_CANCELAMENTO, MOTIVO_CONEXAO_PERDIDA, contarIteracoes, executarCenario } from './scenarios.ts';


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
    rodar(c, opcoes = {}) {
      const iteracoes = opcoes.iteracoes ?? 3;
      return executarCenario(
        { cenario: c, iteracoes, verificacoesAtivas: opcoes.verificacoesAtivas ?? ['processamento'] },
        {
          cdp: conexao,
          relogio,
          sinal: controle.signal,
          ultimaLongTask: () => m.longTask.fim,
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
  const comMedicao = cenario([
    { tipo: 'forcar_gc' },
    { tipo: 'forcar_gc' },
    { tipo: 'snapshot', rotulo: 'inicio' },
    {
      tipo: 'repetir',
      vezes: 'iteracoes',
      passos: [...CICLO, { tipo: 'forcar_gc' }, { tipo: 'medir', metricas: ['heap_usado', 'nos_dom', 'listeners'] }],
    },
    { tipo: 'snapshot', rotulo: 'fim' },
  ]);
  const semMedicao = cenario([{ tipo: 'repetir', vezes: 'iteracoes', passos: CICLO }]);

  it('medir, snapshot e forcar_gc não geram comandos de CDP nesta fase', async () => {
    const com = await montar();
    const andamentoCom = await com.rodar(comMedicao, { verificacoesAtivas: ['processamento', 'carregamento', 'erros-pagina'] });
    const sem = await montar();
    const andamentoSem = await sem.rodar(semMedicao);

    expect(andamentoCom.estado).toBe('concluida');
    expect(com.transporte.comandos).toEqual(sem.transporte.comandos);
    const dominios = new Set(com.metodos().map((metodo) => metodo.split('.')[0]));
    expect([...dominios].sort()).toEqual(['Browser', 'Input', 'Network', 'Page', 'Runtime']);
    expect(com.metodos().some((metodo) => /HeapProfiler|Memory|DOM\./.test(metodo))).toBe(false);
    // Os passos de ação rodam todos, e os de medição não contam como executados.
    expect(andamentoCom.passosExecutados).toBe(andamentoSem.passosExecutados);
    expect(andamentoCom.iteracoes).toHaveLength(3);
  });
});
