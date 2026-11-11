import { describe, expect, it } from 'vitest';
import type { Cenario } from '../shared/cenario.ts';
import type { EstadoExecucao, EstadoSessao, MensagemDaPagina, MensagemParaPagina, PedidoCenario, VisaoSessao } from '../shared/types.ts';
import { ABA, ABRIR, FECHAR, criarPagina, criarRelogioSimulado, criarTransporteFalso } from './apoio-teste.ts';
import { criarConexaoCdp } from './cdp.ts';
import { type AmbienteSessao, DEPENDENTE_CENARIO, type PortaDaPagina, criarOrquestrador } from './sessao.ts';

const URL_TESTE = 'http://localhost:4300/limpa';

const CENARIO: Cenario = {
  versao_esquema: 1,
  nome: 'abrir-fechar',
  url_inicial: URL_TESTE,
  execucao: { iteracoes: 20, throttling: 'padrao' },
  aquecimento: [{ tipo: 'clicar', seletor: ABRIR }, { tipo: 'clicar', seletor: FECHAR }],
  passos: [
    { tipo: 'forcar_gc' },
    {
      tipo: 'repetir',
      vezes: 'iteracoes',
      passos: [
        { tipo: 'clicar', seletor: ABRIR },
        { tipo: 'clicar', seletor: FECHAR },
        { tipo: 'esperar', ms: 100 },
      ],
    },
  ],
};

function montar(gravado?: EstadoSessao) {
  const transporte = criarTransporteFalso();
  const pagina = criarPagina(transporte);
  const relogio = criarRelogioSimulado();
  const abas = new Map<number, string>([[ABA, 'http://localhost:4300/']]);
  const scripts = new Map<string, string[]>();
  const publicadas: VisaoSessao[] = [];
  const gravacoes: EstadoSessao[] = [];
  const injetadas: number[] = [];
  let estadoGravado = gravado;
  const ambiente: AmbienteSessao = {
    lerEstado: async () => structuredClone(estadoGravado),
    gravarEstado: async (estado) => {
      estadoGravado = structuredClone(estado);
      gravacoes.push(estadoGravado);
    },
    urlDaAba: async (id) => abas.get(id) ?? null,
    registrarScript: async (id, padroes) => void scripts.set(id, padroes),
    removerScripts: async (ids) => (ids ?? [...scripts.keys()]).filter((id) => scripts.delete(id)).length,
    injetar: async (idAba) => void injetadas.push(idAba),
    publicar: (visao) => void publicadas.push(structuredClone(visao)),
    agora: () => relogio.agora(),
    criarCdp: () => criarConexaoCdp(transporte),
    soltarDepurador: async (idAba) => transporte.anexadas.delete(idAba),
    relogio,
  };
  const orquestrador = criarOrquestrador(ambiente);

  /** Porta da página, que responde ao encerramento como o código injetado. */
  function conectarPorta() {
    const ouvintes: ((m: MensagemDaPagina) => void)[] = [];
    const quedas: (() => void)[] = [];
    const recebidas: MensagemParaPagina[] = [];
    const lote = { documento: { id: 'doc', url: URL_TESTE, inicio: 0 }, longTasks: [], interacoes: [], metricas: {} };
    const porta: PortaDaPagina = {
      idAba: ABA,
      idQuadro: 0,
      enviar(mensagem) {
        recebidas.push(mensagem);
        if (mensagem.tipo === 'encerrar') {
          queueMicrotask(() => {
            ouvintes.forEach((o) => o({ tipo: 'encerrado', lote, desconectados: { observadores: 2, listeners: 1, temporizadores: 1 } }));
            quedas.forEach((q) => q());
          });
        }
      },
      desconectar: () => undefined,
      aoReceber: (ouvinte) => void ouvintes.push(ouvinte),
      aoDesconectar: (ouvinte) => void quedas.push(ouvinte),
    };
    orquestrador.portaConectada(porta);
    return { recebidas, daPagina: (m: MensagemDaPagina) => ouvintes.forEach((o) => o(m)) };
  }

  const iniciar = (pedido: Partial<PedidoCenario> | null = {}, selecao = ['processamento', 'erros-pagina']) =>
    orquestrador.comando({
      tipo: 'iniciar',
      idAba: ABA,
      selecao: selecao as never,
      ...(pedido ? { cenario: { definicao: CENARIO, ...pedido } } : {}),
    });

  /** Espera a análise terminar (o runner roda em microtarefas, com o relógio simulado). */
  async function ateTerminar(): Promise<EstadoSessao> {
    for (let i = 0; i < 20_000; i++) {
      if (estadoGravado?.fase === 'ociosa' && estadoGravado.resultado) return estadoGravado;
      await new Promise<void>((resolver) => setImmediate(resolver));
    }
    throw new Error('A análise não terminou.');
  }

  return {
    orquestrador,
    transporte,
    pagina,
    relogio,
    abas,
    scripts,
    publicadas,
    gravacoes,
    injetadas,
    conectarPorta,
    iniciar,
    ateTerminar,
    gravado: () => estadoGravado,
  };
}

describe('execução de cenário pelo orquestrador', () => {
  it('anexa o debugger, executa e conclui com configuração efetiva, ambiente e estatísticas', async () => {
    const m = montar();
    const resposta = await m.iniciar({ iteracoes: 3, versaoBuild: ' 1.4.2 ' });

    expect(resposta).toMatchObject({
      ok: true,
      visao: { fase: 'ativa', execucao: { nome: 'abrir-fechar', totalIteracoes: 3 } },
    });
    // Em cenário não há injeção direta: a carga da URL inicial traz o script registrado.
    expect(m.injetadas).toEqual([]);
    expect(m.scripts.get('sondagem-sessao')).toEqual(['http://localhost/*']);

    const { resultado } = await m.ateTerminar();
    expect(resultado).toMatchObject({
      tipo: 'cenario',
      desfecho: 'concluida',
      url: URL_TESTE,
      conexaoPerdida: null,
      cenario: {
        configuracao: { nome: 'abrir-fechar', urlInicial: URL_TESTE, iteracoes: 3, throttling: 'padrao', versaoBuild: '1.4.2' },
        estadoFinal: 'concluida',
        ambiente: { versaoNavegador: '158.0.8127.18', janela: { largura: 1280, altura: 720 }, dpr: 2 },
        iteracoesCompletas: 3,
        iteracoesIncompletas: 0,
        falhas: [],
      },
    });
    expect(resultado!.cenario!.estatisticas.map((e) => [e.id, e.amostras])).toEqual([
      ['duracao-iteracao', 3],
      ['tempo-long-tasks', 3],
      ['pior-interacao', 0],
    ]);
    // 100 ms do passo esperar, mais 50 ms por clique para conferir que o elemento está parado.
    expect(resultado!.cenario!.estatisticas[0]).toMatchObject({ mediana: 200, p75: 200, p95: 200 });
    // Debugger desanexado e listado na limpeza.
    expect(m.transporte.anexadas.size).toBe(0);
    expect(m.transporte.ouvintesAtivos()).toBe(0);
    expect(resultado!.limpeza).toContainEqual({ recurso: 'depurador', quantidade: 1 });
    expect(m.scripts.size).toBe(0);
  });

  it('sem valor na confirmação usa as iterações do cenário', async () => {
    const m = montar();
    const resposta = await m.iniciar();
    expect(resposta.visao.execucao?.totalIteracoes).toBe(20);
    expect((await m.ateTerminar()).resultado?.cenario?.configuracao.iteracoes).toBe(20);
  });

  it('grava o estado em cada transição e publica o progresso', async () => {
    const m = montar();
    await m.iniciar({ iteracoes: 2 });
    await m.ateTerminar();

    const estados: EstadoExecucao[] = [];
    for (const gravacao of m.gravacoes) {
      const estado = gravacao.sessao?.cenario?.andamento.estado;
      if (estado && estados.at(-1) !== estado) estados.push(estado);
    }
    // Entre duas gravações o runner pode ter avançado mais de um estado, mas nunca fora da ordem.
    const ordem: EstadoExecucao[] = ['ociosa', 'preparando', 'aquecendo', 'executando', 'coletando', 'executando', 'coletando', 'concluida'];
    let posicao = 0;
    for (const estado of estados) {
      posicao = ordem.indexOf(estado, posicao);
      expect(posicao, `estado ${estado} fora de ordem em ${estados.join(' → ')}`).toBeGreaterThanOrEqual(0);
    }
    expect(estados).toContain('executando');
    expect(m.gravacoes.some((g) => g.sessao?.cenario?.andamento.iteracao === 2)).toBe(true);
    expect(m.publicadas.at(-1)).toMatchObject({ fase: 'ociosa', execucao: null, resultado: { tipo: 'cenario' } });
  });

  it('repassa à página o início e o fim do aquecimento e de cada iteração', async () => {
    const m = montar();
    m.pagina.aoComando = (metodo) => {
      // A página conecta logo depois de carregar a URL inicial.
      if (metodo === 'Browser.getVersion') porta = m.conectarPorta();
    };
    let porta: ReturnType<typeof m.conectarPorta> | undefined;
    await m.iniciar({ iteracoes: 2 });
    await m.ateTerminar();

    const marcas = porta!.recebidas.filter((r) => r.tipo === 'marcar').map((r) => `${r.marca.fase}:${r.marca.iteracao}`);
    expect(marcas).toEqual(['inicio:aquecimento', 'fim:aquecimento', 'inicio:1', 'fim:1', 'inicio:2', 'fim:2']);
    expect(porta!.recebidas.at(-1)).toEqual({ tipo: 'encerrar' });
  });

  it('carimba os registros com a iteração e descarta os do aquecimento', async () => {
    const m = montar();
    let porta: ReturnType<typeof m.conectarPorta> | undefined;
    let cliques = 0;
    m.pagina.aoComando = (metodo, p) => {
      if (metodo === 'Browser.getVersion') porta = m.conectarPorta();
      if (metodo !== 'Input.dispatchMouseEvent' || p['type'] !== 'mousePressed') return;
      cliques++;
      // Uma long task a cada clique em "abrir": cliques 1 (aquecimento), 3 (iteração 1) e 5 (iteração 2).
      if (cliques % 2 === 1) {
        porta!.daPagina({
          tipo: 'lote',
          lote: {
            documento: { id: 'doc', url: URL_TESTE, inicio: 0 },
            longTasks: [{ inicio: m.relogio.agora(), duracao: 60 + cliques }],
            interacoes: [],
            metricas: {},
          },
        });
      }
    };
    await m.iniciar({ iteracoes: 2 });
    const { resultado } = await m.ateTerminar();

    expect(resultado!.dados.longTasks.map((t) => [t.duracao, t.iteracao])).toEqual([
      [63, 1],
      [65, 2],
    ]);
    expect(resultado!.cenario!.estatisticas.find((e) => e.id === 'tempo-long-tasks')).toMatchObject({ amostras: 2, mediana: 64 });
  });

  it('cenário inválido é recusado antes de anexar ou registrar qualquer coisa', async () => {
    const m = montar();
    const resposta = await m.orquestrador.comando({
      tipo: 'iniciar',
      idAba: ABA,
      selecao: ['processamento'],
      cenario: { definicao: { ...CENARIO, passos: [{ tipo: 'clicar' }] } },
    });

    expect(resposta).toMatchObject({ ok: false, motivo: 'cenario-invalido' });
    expect(!resposta.ok && resposta.mensagem).toContain('/passos/0/seletor');
    expect(m.transporte.chamadas.anexar).toBe(0);
    expect(m.scripts.size).toBe(0);
    expect(m.gravado()?.fase ?? 'ociosa').toBe('ociosa');
  });

  it('passo que falha: resultado "erro" com o passo, a iteração e o motivo, e o debugger desanexado', async () => {
    const m = montar();
    let cliques = 0;
    m.pagina.aoComando = (metodo, p) => {
      if (metodo === 'Input.dispatchMouseEvent' && p['type'] === 'mousePressed' && ++cliques === 5) m.pagina.elementos.delete(FECHAR);
    };
    await m.iniciar({ iteracoes: 4 });
    const { resultado } = await m.ateTerminar();

    expect(resultado).toMatchObject({
      desfecho: 'erro',
      cenario: {
        estadoFinal: 'erro',
        iteracoesCompletas: 1,
        iteracoesIncompletas: 1,
        falhas: [{ caminho: '/passos/1/passos/1', tipoPasso: 'clicar', iteracao: 2, acao: 'interrompeu' }],
      },
    });
    expect(resultado!.cenario!.iteracoes.every((i) => i.fim !== null)).toBe(true);
    expect(m.transporte.anexadas.size).toBe(0);
    expect(m.publicadas.at(-1)?.resultado?.desfecho).toBe('erro');
  });

  it('cancelar durante a execução: para o runner, desanexa e marca como cancelado, sem medições', async () => {
    const m = montar();
    let cliques = 0;
    let cancelamento: Promise<unknown> | undefined;
    let comandosAoCancelar = -1;
    m.pagina.aoComando = (metodo, p) => {
      if (metodo === 'Input.dispatchMouseEvent' && p['type'] === 'mousePressed' && ++cliques === 7) {
        // Terceira iteração (2 cliques de aquecimento + 4 das duas primeiras).
        cancelamento = m.orquestrador.comando({ tipo: 'cancelar' });
        comandosAoCancelar = m.transporte.comandos.length;
      }
    };
    await m.iniciar({ iteracoes: 10 });
    const { resultado } = await m.ateTerminar();
    await cancelamento;

    expect(resultado).toMatchObject({ desfecho: 'cancelada', cenario: { estadoFinal: 'cancelada', estatisticas: [] } });
    expect(resultado!.dados).toEqual({ longTasks: [], interacoes: [], documentos: [], errosPagina: [] });
    expect(resultado!.cenario!.iteracoes.map((i) => i.completa)).toEqual([true, true, false]);
    // Nenhum comando de ação depois do cancelamento.
    const depois = m.transporte.comandos.slice(comandosAoCancelar).map((c) => c.metodo);
    expect(depois.filter((metodo) => metodo.startsWith('Input.'))).toEqual([]);
    expect(m.transporte.anexadas.size).toBe(0);
    expect(m.scripts.size).toBe(0);
    expect(resultado!.limpeza).toContainEqual({ recurso: 'depurador', quantidade: 1 });
  });

  it('só uma análise por vez: novo início durante a execução é recusado', async () => {
    const m = montar();
    await m.iniciar({ iteracoes: 2 });
    expect(await m.iniciar()).toMatchObject({ ok: false, motivo: 'sessao-ativa' });
    await m.ateTerminar();
  });
});

describe('falha ao anexar o debugger', () => {
  it('outro depurador na aba: nada começa, e a resposta lista o que depende do debugger', async () => {
    const m = montar();
    m.transporte.depuradasPorOutro.add(ABA);
    const resposta = await m.iniciar();

    expect(resposta).toMatchObject({
      ok: false,
      motivo: 'debugger',
      falhaDebugger: { categoria: 'outro-depurador', dependentes: [DEPENDENTE_CENARIO, 'Erros da página'] },
      visao: { fase: 'ociosa' },
    });
    expect(!resposta.ok && resposta.mensagem).toContain('Há um depurador aberto nesta aba');
    // Não age sobre o outro depurador nem deixa nada instalado.
    expect(m.transporte.chamadas).toEqual({ anexar: 0, desanexar: 0 });
    expect(m.transporte.comandos).toEqual([]);
    expect(m.scripts.size).toBe(0);
    expect(m.injetadas).toEqual([]);
    expect(m.gravado()?.fase ?? 'ociosa').toBe('ociosa');
  });

  it('aba que não aceita depuração', async () => {
    const m = montar();
    m.transporte.erroAoAnexar = 'Cannot access a chrome:// URL';
    const resposta = await m.iniciar(null, ['erros-pagina']);

    expect(resposta).toMatchObject({
      ok: false,
      motivo: 'debugger',
      falhaDebugger: { categoria: 'alvo-nao-depuravel', original: 'Cannot access a chrome:// URL', dependentes: ['Erros da página'] },
    });
    expect(!resposta.ok && resposta.mensagem).toContain('não pode ser analisada');
    expect(m.scripts.size).toBe(0);
  });

  it('erro desconhecido preserva a mensagem original', async () => {
    const m = montar();
    m.transporte.erroAoAnexar = 'Falha rara';
    const resposta = await m.iniciar();
    expect(resposta).toMatchObject({ falhaDebugger: { categoria: 'desconhecido', original: 'Falha rara' } });
  });

  it('sessão manual sem verificação que exige debugger não anexa nada', async () => {
    const m = montar();
    m.transporte.depuradasPorOutro.add(ABA);
    const resposta = await m.iniciar(null, ['processamento', 'carregamento']);

    expect(resposta.ok).toBe(true);
    expect(m.transporte.chamadas.anexar).toBe(0);
    expect(m.gravado()?.sessao?.usaDebugger).toBe(false);
    expect(m.injetadas).toEqual([ABA]);
  });
});

describe('conexão perdida', () => {
  it('barra de depuração cancelada durante o cenário: interrompida, com os dados parciais e o motivo', async () => {
    const m = montar();
    let porta: ReturnType<typeof m.conectarPorta> | undefined;
    let cliques = 0;
    m.pagina.aoComando = (metodo, p) => {
      if (metodo === 'Browser.getVersion') porta = m.conectarPorta();
      if (metodo !== 'Input.dispatchMouseEvent' || p['type'] !== 'mousePressed') return;
      cliques++;
      if (cliques === 3) {
        porta!.daPagina({
          tipo: 'lote',
          lote: { documento: { id: 'doc', url: URL_TESTE, inicio: 0 }, longTasks: [{ inicio: m.relogio.agora(), duracao: 77 }], interacoes: [], metricas: {} },
        });
      }
      if (cliques === 6) m.transporte.derrubar(ABA, 'canceled_by_user');
    };
    await m.iniciar({ iteracoes: 10 });
    const { resultado } = await m.ateTerminar();

    expect(resultado).toMatchObject({
      desfecho: 'interrompida',
      conexaoPerdida: 'canceled_by_user',
      cenario: { estadoFinal: 'erro', iteracoesCompletas: 1, iteracoesIncompletas: 1 },
    });
    // Os dados já coletados são preservados.
    expect(resultado!.dados.longTasks).toEqual([{ inicio: expect.any(Number), duracao: 77, iteracao: 1 }]);
    expect(cliques).toBe(6);
    // A limpeza foi feita; o debugger já tinha saído por fora, então não entra na lista.
    expect(m.scripts.size).toBe(0);
    expect(resultado!.limpeza.some((item) => item.recurso === 'depurador')).toBe(false);
    expect(resultado!.limpeza).toContainEqual({ recurso: 'observador', quantidade: 2 });
    expect(m.transporte.ouvintesAtivos()).toBe(0);
  });

  it('em sessão manual com "Erros da página": encerra como interrompida', async () => {
    const m = montar();
    await m.iniciar(null, ['processamento', 'erros-pagina']);
    m.conectarPorta();
    m.transporte.derrubar(ABA, 'replaced_with_devtools');
    const { resultado } = await m.ateTerminar();

    expect(resultado).toMatchObject({ tipo: 'sessao-manual', desfecho: 'interrompida', conexaoPerdida: 'replaced_with_devtools', cenario: null });
  });

  it('service worker reiniciado no meio de um cenário: solta o debugger e encerra como interrompida', async () => {
    const primeiro = montar();
    // A execução fica parada na carga da URL inicial.
    const responder = primeiro.transporte.responder;
    primeiro.transporte.responder = (metodo, p) => (metodo === 'Page.navigate' ? new Promise(() => undefined) : responder(metodo, p));
    await primeiro.iniciar({ iteracoes: 3 });
    await new Promise<void>((resolver) => setImmediate(resolver));
    const emCurso = primeiro.gravado()!;
    expect(emCurso).toMatchObject({ fase: 'ativa', sessao: { tipo: 'cenario', usaDebugger: true } });

    // Novo service worker, com a memória vazia e o debugger ainda anexado à aba.
    const segundo = montar(emCurso);
    segundo.transporte.anexadas.add(ABA);
    await segundo.orquestrador.recuperar();

    expect(segundo.transporte.anexadas.size).toBe(0);
    expect(segundo.gravado()).toMatchObject({
      fase: 'ociosa',
      resultado: { desfecho: 'interrompida', cenario: { estadoFinal: 'erro' }, limpeza: [{ recurso: 'depurador', quantidade: 1 }] },
    });
  });
});

describe('erros da página', () => {
  const excecao = (texto: string, mensagem: string) => ({
    exceptionDetails: { text: texto, url: 'http://localhost:4300/erros.ts', lineNumber: 4, columnNumber: 2, exception: { description: mensagem } },
  });

  it('em cenário: cada erro fica na iteração em que ocorreu, e a execução conclui', async () => {
    const m = montar();
    let cliques = 0;
    m.pagina.aoComando = (metodo, p) => {
      if (metodo !== 'Input.dispatchMouseEvent' || p['type'] !== 'mousePressed') return;
      cliques++;
      if (cliques === 1) m.transporte.emitir(ABA, 'Runtime.exceptionThrown', excecao('Uncaught', 'Error: no aquecimento'));
      if (cliques === 5) m.transporte.emitir(ABA, 'Runtime.exceptionThrown', excecao('Uncaught', 'Error: na segunda'));
      if (cliques === 8) m.transporte.emitir(ABA, 'Runtime.exceptionThrown', excecao('Uncaught (in promise)', 'Error: rejeitada'));
    };
    await m.iniciar({ iteracoes: 3 });
    const { resultado } = await m.ateTerminar();

    expect(resultado!.desfecho).toBe('concluida');
    expect(resultado!.cenario!.iteracoesCompletas).toBe(3);
    expect(resultado!.dados.errosPagina.map((e) => [e.tipo, e.mensagem, e.iteracao, e.linha])).toEqual([
      ['excecao', 'Error: na segunda', 2, 5],
      ['rejeicao', 'Error: rejeitada', 3, 5],
    ]);
    expect(m.transporte.comandos.map((c) => c.metodo)).toContain('Runtime.enable');
  });

  it('verificação desmarcada: não habilita a coleta nem registra erros', async () => {
    const m = montar();
    let cliques = 0;
    m.pagina.aoComando = (metodo, p) => {
      if (metodo === 'Input.dispatchMouseEvent' && p['type'] === 'mousePressed' && ++cliques === 3) {
        m.transporte.emitir(ABA, 'Runtime.exceptionThrown', excecao('Uncaught', 'Error: ignorado'));
      }
    };
    await m.iniciar({ iteracoes: 2 }, ['processamento']);
    const { resultado } = await m.ateTerminar();

    expect(resultado!.dados.errosPagina).toEqual([]);
    expect(m.transporte.comandos.map((c) => c.metodo)).not.toContain('Runtime.enable');
  });

  it('em sessão manual: anexa o debugger, coleta e desanexa ao parar', async () => {
    const m = montar();
    await m.iniciar(null, ['erros-pagina']);
    m.conectarPorta();
    expect([...m.transporte.anexadas]).toEqual([ABA]);
    expect(m.injetadas).toEqual([ABA]);

    m.transporte.emitir(ABA, 'Runtime.exceptionThrown', excecao('Uncaught', 'TypeError: x is not a function'));
    const resposta = await m.orquestrador.comando({ tipo: 'parar' });

    expect(resposta.visao.resultado).toMatchObject({
      tipo: 'sessao-manual',
      desfecho: 'concluida',
      dados: { errosPagina: [{ tipo: 'excecao', mensagem: 'TypeError: x is not a function', arquivo: 'http://localhost:4300/erros.ts' }] },
    });
    expect(resposta.visao.resultado!.dados.errosPagina[0]).not.toHaveProperty('iteracao');
    expect(m.transporte.anexadas.size).toBe(0);
    expect(resposta.visao.resultado!.limpeza).toContainEqual({ recurso: 'depurador', quantidade: 1 });
  });
});
