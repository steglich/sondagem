/** Orquestrador com condições de teste, limpeza confirmada e histórico (fase 5). */
import { describe, expect, it } from 'vitest';
import type { Cenario } from '../shared/cenario.ts';
import type { PerfilThrottling } from '../shared/condicoes.ts';
import { CONFIGURACAO_PADRAO, type ConfiguracaoArmazenamento } from '../shared/historico.ts';
import type { EstadoSessao, ExtensaoAtiva, MensagemDaPagina, PedidoCenario, ResultadoSessao, VisaoSessao } from '../shared/types.ts';
import { ABA, ABRIR, FECHAR, criarPagina, criarRelogioSimulado, criarRepositorioFalso, criarTransporteFalso } from './apoio-teste.ts';
import { criarConexaoCdp } from './cdp.ts';
import { type AmbienteSessao, DEPENDENTE_THROTTLING, type PortaDaPagina, criarOrquestrador } from './sessao.ts';

const URL_TESTE = 'http://localhost:4300/protegida';
const SENHA = 'senha-muito-secreta';

const CENARIO: Cenario = {
  versao_esquema: 1,
  nome: 'abrir-fechar',
  url_inicial: URL_TESTE,
  execucao: { iteracoes: 3, throttling: 'padrao' },
  passos: [
    {
      tipo: 'repetir',
      vezes: 'iteracoes',
      passos: [
        { tipo: 'clicar', seletor: ABRIR },
        { tipo: 'clicar', seletor: FECHAR },
      ],
    },
  ],
};

interface Opcoes {
  /** Ids das execuções de referência das linhas de base. */
  protegidos?: () => string[];
  gravado?: EstadoSessao;
  repositorio?: ReturnType<typeof criarRepositorioFalso>;
  perfis?: PerfilThrottling[];
  extensoes?: ExtensaoAtiva[];
  configuracao?: ConfiguracaoArmazenamento;
}

function montar(opcoes: Opcoes = {}) {
  const transporte = criarTransporteFalso();
  const pagina = criarPagina(transporte);
  const relogio = criarRelogioSimulado();
  const repositorio = opcoes.repositorio ?? criarRepositorioFalso();
  const scripts = new Map<string, string[]>();
  const publicadas: VisaoSessao[] = [];
  let estadoGravado = opcoes.gravado;
  let proximoId = 0;
  const ambiente: AmbienteSessao = {
    lerEstado: async () => structuredClone(estadoGravado),
    gravarEstado: async (estado) => void (estadoGravado = structuredClone(estado)),
    urlDaAba: async (id) => (id === ABA ? 'http://localhost:4300/' : null),
    registrarScript: async (id, padroes) => void scripts.set(id, padroes),
    removerScripts: async (ids) => (ids ?? [...scripts.keys()]).filter((id) => scripts.delete(id)).length,
    injetar: async () => undefined,
    publicar: (visao) => void publicadas.push(structuredClone(visao)),
    agora: () => relogio.agora(),
    criarCdp: () => criarConexaoCdp(transporte),
    soltarDepurador: async (idAba) => transporte.anexadas.delete(idAba),
    repetir: () => () => undefined,
    relogio,
    repositorio,
    lerPerfis: async () => opcoes.perfis ?? [],
    lerConfiguracao: async () => opcoes.configuracao ?? CONFIGURACAO_PADRAO,
    lerProtegidos: async () => opcoes.protegidos?.() ?? [],
    outrasExtensoes: async () => opcoes.extensoes ?? [],
    navegador: () => ({ versao: '158.0.8127.18', userAgent: 'Mozilla/5.0 Chrome/158.0.0.0' }),
    novoId: () => `analise-${++proximoId}`,
  };
  const orquestrador = criarOrquestrador(ambiente);

  /** Porta da página, que responde ao encerramento como o código injetado. */
  function conectarPorta() {
    const ouvintes: ((m: MensagemDaPagina) => void)[] = [];
    const quedas: (() => void)[] = [];
    const lote = { documento: { id: 'doc', url: URL_TESTE, inicio: 0 }, longTasks: [], interacoes: [], metricas: {} };
    const porta: PortaDaPagina = {
      idAba: ABA,
      idQuadro: 0,
      enviar(mensagem) {
        if (mensagem.tipo !== 'encerrar') return;
        queueMicrotask(() => {
          ouvintes.forEach((o) => o({ tipo: 'encerrado', lote, desconectados: { observadores: 2, listeners: 1, temporizadores: 1 } }));
          quedas.forEach((q) => q());
        });
      },
      desconectar: () => undefined,
      aoReceber: (ouvinte) => void ouvintes.push(ouvinte),
      aoDesconectar: (ouvinte) => void quedas.push(ouvinte),
    };
    orquestrador.portaConectada(porta);
    return { daPagina: (m: MensagemDaPagina) => ouvintes.forEach((o) => o(m)) };
  }

  async function visao(): Promise<VisaoSessao> {
    return (await orquestrador.comando({ tipo: 'obter-visao' })).visao;
  }

  return {
    orquestrador,
    transporte,
    pagina,
    relogio,
    repositorio,
    scripts,
    publicadas,
    conectarPorta,
    visao,
    gravado: () => estadoGravado,
    executar: (cenario: Cenario = CENARIO, pedido: Partial<PedidoCenario> = {}, selecao = ['processamento']) =>
      orquestrador.comando({ tipo: 'iniciar', idAba: ABA, selecao: selecao as never, cenario: { definicao: cenario, ...pedido } }),
    /** Espera a análise terminar (o runner roda em microtarefas, com o relógio simulado). */
    async ateTerminar(): Promise<ResultadoSessao> {
      for (let i = 0; i < 20_000; i++) {
        if (estadoGravado?.fase === 'ociosa' && estadoGravado.idResultado) return (await visao()).resultado!;
        await new Promise<void>((resolver) => setImmediate(resolver));
      }
      throw new Error('A análise não terminou.');
    },
    comandos: (metodo: string) => transporte.comandos.filter((c) => c.metodo === metodo).map((c) => c.parametros as Record<string, unknown>),
    metodos: () => transporte.comandos.map((c) => c.metodo),
  };
}

describe('condições de teste no resultado', () => {
  it('cenário com "padrao": o resultado traz os valores numéricos aplicados e o estado do cache', async () => {
    const m = montar();
    expect((await m.executar()).ok).toBe(true);
    const resultado = await m.ateTerminar();

    expect(resultado.desfecho).toBe('concluida');
    expect(resultado.condicoes).toEqual({
      perfil: 'padrao',
      cpu: 4,
      rede: { latenciaMs: 150, downloadKbps: 1600, uploadKbps: 750 },
      cacheDesligado: true,
      cacheLimpo: true,
      storageLimpo: [],
    });
    // O que foi declarado no cenário continua registrado como estava.
    expect(resultado.cenario?.configuracao.throttling).toBe('padrao');
    // As três condições aplicadas aparecem na lista do que foi removido.
    expect(resultado.limpeza).toContainEqual({ recurso: 'condicao-de-teste', quantidade: 3 });
    expect(m.comandos('Emulation.setCPUThrottlingRate')).toEqual([{ rate: 4 }, { rate: 1 }]);
  });

  it('cenário sem throttling: registra "nenhum", com o cache desligado e limpo', async () => {
    const m = montar();
    await m.executar({ ...CENARIO, execucao: { iteracoes: 1 } });
    const resultado = await m.ateTerminar();
    expect(resultado.condicoes).toEqual({ perfil: 'nenhum', cpu: 1, rede: null, cacheDesligado: true, cacheLimpo: true, storageLimpo: [] });
    expect(resultado.limpeza).toContainEqual({ recurso: 'condicao-de-teste', quantidade: 1 });
  });

  it('cenário com `manter_cache`: o cache fica ligado, mas é limpo antes', async () => {
    const m = montar();
    await m.executar({ ...CENARIO, execucao: { iteracoes: 1, manter_cache: true } });
    const resultado = await m.ateTerminar();
    expect(resultado.condicoes).toMatchObject({ cacheDesligado: false, cacheLimpo: true });
    expect(m.metodos()).not.toContain('Network.setCacheDisabled');
    expect(m.metodos()).toContain('Network.clearBrowserCache');
  });

  it('perfil salvo pelo usuário: aplica e registra os valores dele', async () => {
    const m = montar({ perfis: [{ nome: 'celular-antigo', cpu: 6, rede: { latenciaMs: 300, downloadKbps: null, uploadKbps: null } }] });
    await m.executar({ ...CENARIO, execucao: { iteracoes: 1, throttling: 'celular-antigo' } });
    const resultado = await m.ateTerminar();
    expect(resultado.condicoes).toMatchObject({ perfil: 'celular-antigo', cpu: 6, rede: { latenciaMs: 300, downloadKbps: null, uploadKbps: null } });
    expect(m.comandos('Emulation.setCPUThrottlingRate')[0]).toEqual({ rate: 6 });
    expect(m.comandos('Network.emulateNetworkConditions')[0]).toMatchObject({ latency: 300, downloadThroughput: -1 });
  });

  it('perfil inexistente: a execução não começa, e a mensagem lista os disponíveis', async () => {
    const m = montar({ perfis: [{ nome: 'celular-antigo', cpu: 6, rede: null }] });
    const resposta = await m.executar({ ...CENARIO, execucao: { throttling: '3g' } });

    expect(resposta).toMatchObject({
      ok: false,
      motivo: 'perfil-inexistente',
      mensagem: 'O perfil de throttling "3g" não existe. Perfis disponíveis: "nenhum", "padrao", "celular-antigo".',
      visao: { fase: 'ociosa' },
    });
    expect(m.transporte.chamadas.anexar).toBe(0);
    expect(m.scripts.size).toBe(0);
    expect(m.repositorio.gravacoes).toEqual([]);
  });

  it('cancelamento: as condições são desfeitas e contadas na limpeza', async () => {
    const m = montar();
    let cliques = 0;
    let cancelamento: Promise<unknown> | null = null;
    m.pagina.aoComando = (metodo, p) => {
      if (metodo === 'Input.dispatchMouseEvent' && p['type'] === 'mousePressed' && ++cliques === 2) {
        cancelamento = m.orquestrador.comando({ tipo: 'cancelar' });
      }
    };
    await m.executar();
    const resultado = await m.ateTerminar();
    await cancelamento;

    expect(resultado.desfecho).toBe('cancelada');
    expect(resultado.limpeza).toContainEqual({ recurso: 'condicao-de-teste', quantidade: 3 });
    expect(m.comandos('Emulation.setCPUThrottlingRate').at(-1)).toEqual({ rate: 1 });
    expect(m.transporte.anexadas.size).toBe(0);
  });
});

describe('sessão manual', () => {
  const iniciarManual = (m: ReturnType<typeof montar>, extras: object = {}) =>
    m.orquestrador.comando({ tipo: 'iniciar', idAba: ABA, selecao: ['processamento'], ...extras });

  it('sem escolha de throttling: não anexa o debugger, não aplica nem limpa nada', async () => {
    const m = montar();
    expect((await iniciarManual(m)).ok).toBe(true);
    m.conectarPorta();
    const { visao } = await m.orquestrador.comando({ tipo: 'parar' });

    expect(m.transporte.chamadas.anexar).toBe(0);
    expect(m.transporte.comandos).toEqual([]);
    expect(visao.resultado?.condicoes).toEqual({ perfil: 'nenhum', cpu: 1, rede: null, cacheDesligado: false, cacheLimpo: false, storageLimpo: [] });
    expect(visao.resultado?.limpeza.map((item) => item.recurso)).not.toContain('condicao-de-teste');
  });

  it('escolher "nenhum" é o mesmo que não escolher', async () => {
    const m = montar();
    await iniciarManual(m, { throttling: 'nenhum' });
    expect(m.transporte.chamadas.anexar).toBe(0);
    expect(m.transporte.comandos).toEqual([]);
  });

  it('com "padrao" escolhido: aplica CPU e rede pelo debugger, sem mexer no cache, e desfaz ao parar', async () => {
    const m = montar();
    expect((await iniciarManual(m, { throttling: 'padrao' })).ok).toBe(true);
    m.conectarPorta();

    expect(m.transporte.anexadas.has(ABA)).toBe(true);
    expect(m.comandos('Emulation.setCPUThrottlingRate')).toEqual([{ rate: 4 }]);
    expect(m.comandos('Network.emulateNetworkConditions')).toEqual([{ offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750 }]);

    const { visao } = await m.orquestrador.comando({ tipo: 'parar' });
    expect(m.comandos('Emulation.setCPUThrottlingRate').at(-1)).toEqual({ rate: 1 });
    expect(m.comandos('Network.emulateNetworkConditions').at(-1)).toMatchObject({ latency: 0, downloadThroughput: -1 });
    expect(m.transporte.anexadas.size).toBe(0);
    // Nem cache desligado, nem limpeza de cache, nem recarga.
    expect(m.metodos().filter((metodo) => /setCacheDisabled|clearBrowserCache|Storage\.|Page\.navigate/.test(metodo))).toEqual([]);
    expect(visao.resultado?.condicoes).toMatchObject({ perfil: 'padrao', cpu: 4, cacheDesligado: false, cacheLimpo: false });
    expect(visao.resultado?.limpeza).toContainEqual({ recurso: 'condicao-de-teste', quantidade: 2 });
    expect(visao.resultado?.limpeza).toContainEqual({ recurso: 'depurador', quantidade: 1 });
  });

  it('o throttling escolhido depende do debugger: com outro depurador na aba, a sessão não começa', async () => {
    const m = montar();
    m.transporte.depuradasPorOutro.add(ABA);
    const resposta = await iniciarManual(m, { throttling: 'padrao' });
    expect(resposta).toMatchObject({ ok: false, motivo: 'debugger', falhaDebugger: { dependentes: [DEPENDENTE_THROTTLING] } });
    expect(m.transporte.comandos).toEqual([]);
  });

  it('perfil inexistente na sessão manual também não começa', async () => {
    const m = montar();
    expect(await iniciarManual(m, { throttling: 'nao-existe' })).toMatchObject({ ok: false, motivo: 'perfil-inexistente' });
  });
});

describe('limpeza de storage', () => {
  const COM_LIMPEZA: Cenario = { ...CENARIO, execucao: { iteracoes: 1 }, limpar_storage: ['local_storage', 'cookies'] };

  it('sem confirmação: a execução não começa e nada é apagado', async () => {
    const m = montar();
    const resposta = await m.executar(COM_LIMPEZA);

    expect(resposta).toMatchObject({ ok: false, motivo: 'limpeza-nao-confirmada', visao: { fase: 'ociosa' } });
    expect(!resposta.ok && resposta.mensagem).toContain('localStorage, cookies');
    expect(m.transporte.chamadas.anexar).toBe(0);
    expect(m.transporte.comandos).toEqual([]);
    expect(m.repositorio.gravacoes).toEqual([]);
  });

  it('confirmação parcial também não começa, e diz o que faltou', async () => {
    const m = montar();
    const resposta = await m.executar(COM_LIMPEZA, { storageConfirmado: ['local_storage'] });
    expect(resposta).toMatchObject({ ok: false, motivo: 'limpeza-nao-confirmada' });
    expect(!resposta.ok && resposta.mensagem).toContain('apaga cookies da aplicação');
    expect(m.transporte.comandos).toEqual([]);
  });

  it('confirmada: apaga só os tipos confirmados e registra no resultado', async () => {
    const m = montar();
    await m.executar({ ...COM_LIMPEZA, limpar_storage: ['local_storage'] }, { storageConfirmado: ['local_storage'] });
    const resultado = await m.ateTerminar();

    expect(m.comandos('Storage.clearDataForOrigin')).toEqual([{ origin: 'http://localhost:4300', storageTypes: 'cache_storage' }]);
    const naPagina = m.comandos('Runtime.evaluate').map((p) => String(p['expression'])).filter((e) => e.includes('.clear()'));
    expect(naPagina).toHaveLength(1);
    expect(naPagina[0]).toContain('localStorage.clear()');
    expect(JSON.stringify(m.transporte.comandos)).not.toContain('cookies');
    expect(resultado.condicoes.storageLimpo).toEqual(['local_storage']);
  });

  it('tipo confirmado que o cenário não declara nunca é enviado', async () => {
    const m = montar();
    await m.executar({ ...CENARIO, execucao: { iteracoes: 1 } }, { storageConfirmado: ['cookies', 'indexeddb', 'local_storage'] });
    const resultado = await m.ateTerminar();

    expect(m.comandos('Storage.clearDataForOrigin')).toEqual([{ origin: 'http://localhost:4300', storageTypes: 'cache_storage' }]);
    expect(JSON.stringify(m.transporte.comandos)).not.toContain('.clear()');
    expect(resultado.condicoes.storageLimpo).toEqual([]);
  });
});

describe('login declarado: nada do que foi digitado é gravado', () => {
  const COM_LOGIN: Cenario = {
    ...CENARIO,
    execucao: { iteracoes: 1 },
    sessao: {
      url_login: 'http://localhost:4300/login',
      passos_login: [
        { tipo: 'digitar', seletor: ABRIR, texto: SENHA },
        { tipo: 'clicar', seletor: FECHAR },
      ],
    },
  };

  it('o runner digita a senha, mas o estado gravado, o histórico e o resultado não a contêm', async () => {
    const m = montar();
    // A primeira carga cai no login; a segunda, depois do login, na página protegida.
    const destinos = ['http://localhost:4300/login'];
    const responder = m.transporte.responder;
    const estadosDurante: string[] = [];
    m.transporte.responder = (metodo, p) => {
      if (metodo === 'Page.navigate') {
        const url = destinos.shift() ?? URL_TESTE;
        queueMicrotask(() => m.transporte.emitir(ABA, 'Page.frameNavigated', { frame: { id: 'principal', url } }));
      }
      if (metodo === 'Input.insertText') estadosDurante.push(JSON.stringify(m.gravado()));
      return responder(metodo, p);
    };
    await m.executar(COM_LOGIN);
    const resultado = await m.ateTerminar();

    expect(resultado.desfecho).toBe('concluida');
    // A senha chegou à página...
    expect(m.comandos('Input.insertText')).toEqual([{ text: SENHA }]);
    // ...e a nenhum outro lugar.
    expect(estadosDurante).toHaveLength(1);
    expect(estadosDurante[0]).toContain('passos_login');
    expect(estadosDurante[0]).not.toContain(SENHA);
    expect(JSON.stringify(m.gravado())).not.toContain(SENHA);
    expect(JSON.stringify(resultado)).not.toContain(SENHA);
    expect(JSON.stringify(m.publicadas)).not.toContain(SENHA);
    expect(m.repositorio.gravacoes.length).toBeGreaterThan(1);
    expect(JSON.stringify(m.repositorio.gravacoes)).not.toContain(SENHA);
    expect(JSON.stringify([...m.repositorio.guardadas.values()])).not.toContain(SENHA);
    // O cenário guardado mostra que houve login, com o texto mascarado.
    expect(m.repositorio.guardadas.get(resultado.id)?.registro.definicao?.sessao?.passos_login?.[0]).toEqual({ tipo: 'digitar', seletor: ABRIR, texto: '***' });
  });

  it('falha de sessão: o resultado guardado indica a iteração e não traz estatísticas', async () => {
    const m = montar();
    let cliques = 0;
    m.pagina.aoComando = (metodo, p) => {
      if (metodo === 'Input.dispatchMouseEvent' && p['type'] === 'mousePressed' && ++cliques === 3) {
        queueMicrotask(() => m.transporte.emitir(ABA, 'Page.frameNavigated', { frame: { id: 'principal', url: 'http://localhost:4300/login' } }));
      }
    };
    await m.executar({ ...CENARIO, sessao: { url_login: 'http://localhost:4300/login' } });
    const resultado = await m.ateTerminar();

    expect(resultado.desfecho).toBe('erro');
    expect(resultado.cenario).toMatchObject({ estadoFinal: 'erro', falhaDeSessao: { url: 'http://localhost:4300/login', iteracao: 2 }, estatisticas: [] });
    expect(m.repositorio.guardadas.get(resultado.id)?.registro).toMatchObject({ estado: 'erro', resumo: { cenario: { falhaDeSessao: { iteracao: 2 }, estatisticas: [] } } });
  });
});

describe('gravação no histórico', () => {
  it('grava ao iniciar (em andamento), ao fim de cada iteração e ao terminar, com os metadados', async () => {
    const m = montar({ extensoes: [{ id: 'abc', nome: 'Bloqueador' }] });
    await m.executar(CENARIO, { versaoBuild: '1.4.2' });
    const resultado = await m.ateTerminar();

    const sequencia = m.repositorio.gravacoes.map((g) => ({
      id: g.registro.id,
      estado: g.registro.estado,
      iteracoesFechadas: (g.registro.andamento?.iteracoes ?? g.registro.resumo?.cenario?.iteracoes ?? []).filter((i) => i.fim !== null).length,
    }));
    expect(sequencia).toEqual([
      { id: 'analise-1', estado: 'em-andamento', iteracoesFechadas: 0 },
      { id: 'analise-1', estado: 'em-andamento', iteracoesFechadas: 1 },
      { id: 'analise-1', estado: 'em-andamento', iteracoesFechadas: 2 },
      { id: 'analise-1', estado: 'em-andamento', iteracoesFechadas: 3 },
      { id: 'analise-1', estado: 'concluida', iteracoesFechadas: 3 },
    ]);

    // Já na primeira gravação estão os metadados conhecidos no início.
    expect(m.repositorio.gravacoes[0]!.registro).toMatchObject({
      tipo: 'cenario',
      nomeCenario: 'abrir-fechar',
      grupo: 'cenario:abrir-fechar',
      url: URL_TESTE,
      versaoBuild: '1.4.2',
      navegador: { versao: '158.0.8127.18' },
      condicoes: { perfil: 'padrao', cpu: 4 },
      extensoes: [{ id: 'abc', nome: 'Bloqueador' }],
      configuracao: { iteracoes: 3 },
      resumo: null,
    });

    // E na última, o resultado completo.
    const final = m.repositorio.guardadas.get('analise-1')!;
    expect(final.registro).toMatchObject({
      estado: 'concluida',
      fim: resultado.fim,
      ambiente: { versaoNavegador: '158.0.8127.18', janela: { largura: 1280, altura: 720 } },
      andamento: null,
      resumo: { desfecho: 'concluida', cenario: { iteracoesCompletas: 3 } },
    });
    expect(final.registro.definicao).toEqual(CENARIO);
    expect(final.registro.resumo).not.toHaveProperty('dados');
    expect(final.registro.tamanho).toBeGreaterThan(0);
    expect(resultado).toMatchObject({ id: 'analise-1', extensoes: [{ id: 'abc', nome: 'Bloqueador' }], navegador: { versao: '158.0.8127.18' }, truncado: [] });
  });

  it('o resultado não fica em `chrome.storage.session`: só o id', async () => {
    const m = montar();
    await m.executar();
    const resultado = await m.ateTerminar();
    expect(m.gravado()).toEqual({ fase: 'ociosa', sessao: null, resultado: null, idResultado: resultado.id });
  });

  it('sessão manual: em andamento ao iniciar, concluída ao parar', async () => {
    const m = montar({ extensoes: [{ id: 'abc', nome: 'Bloqueador' }, { id: 'def', nome: 'Tradutor' }] });
    await m.orquestrador.comando({ tipo: 'iniciar', idAba: ABA, selecao: ['processamento'] });
    const porta = m.conectarPorta();
    await new Promise<void>((resolver) => setImmediate(resolver));
    porta.daPagina({ tipo: 'lote', lote: { documento: { id: 'doc', url: URL_TESTE, inicio: 0 }, longTasks: [{ inicio: 1, duracao: 300 }], interacoes: [], metricas: {} } });
    const { visao } = await m.orquestrador.comando({ tipo: 'parar' });

    expect(m.repositorio.gravacoes.map((g) => g.registro.estado)).toEqual(['em-andamento', 'concluida']);
    const final = m.repositorio.guardadas.get('analise-1')!;
    expect(final.registro).toMatchObject({ tipo: 'sessao-manual', grupo: 'manual', nomeCenario: null, definicao: null });
    expect(final.dados.longTasks).toEqual([{ inicio: 1, duracao: 300 }]);
    // As duas outras extensões ativas ficam registradas no resultado.
    expect(visao.resultado?.extensoes).toEqual([{ id: 'abc', nome: 'Bloqueador' }, { id: 'def', nome: 'Tradutor' }]);
    expect(final.registro.extensoes).toHaveLength(2);
  });

  it('análise cancelada e com erro também são salvas, com o estado certo', async () => {
    const m = montar();
    m.pagina.elementos.delete(FECHAR);
    await m.executar();
    expect((await m.ateTerminar()).desfecho).toBe('erro');
    expect(m.repositorio.guardadas.get('analise-1')?.registro).toMatchObject({ estado: 'erro', resumo: { cenario: { estadoFinal: 'erro' } } });

    await m.orquestrador.comando({ tipo: 'iniciar', idAba: ABA, selecao: ['processamento'] });
    await m.orquestrador.comando({ tipo: 'cancelar' });
    expect(m.repositorio.guardadas.get('analise-2')?.registro).toMatchObject({ estado: 'cancelada' });
    expect((await m.repositorio.listar()).map((r) => r.estado)).toEqual(['cancelada', 'erro']);
  });

  it('início que falha não deixa registro "em andamento" para trás', async () => {
    const m = montar();
    m.transporte.responder = (metodo) => {
      if (metodo === 'Runtime.enable') throw new Error('recusado');
      return {};
    };
    const resposta = await m.executar(CENARIO, {}, ['erros-pagina']);
    expect(resposta).toMatchObject({ ok: false, motivo: 'erro' });
    expect(m.repositorio.guardadas.size).toBe(0);
    expect(m.transporte.anexadas.size).toBe(0);
  });

});

describe('limites e retenção ao salvar', () => {
  const comLongTasks = (m: ReturnType<typeof montar>): void => {
    // A página só conecta depois da carga inicial; aqui basta o lote chegar durante a execução.
    const porta = m.conectarPorta();
    let enviado = false;
    m.pagina.aoComando = (metodo) => {
      if (metodo !== 'Input.dispatchMouseEvent' || enviado) return;
      enviado = true;
      porta.daPagina({
        tipo: 'lote',
        lote: {
          documento: { id: 'doc', url: URL_TESTE, inicio: 0 },
          longTasks: Array.from({ length: 400 }, (_, i) => ({ inicio: m.relogio.agora() + i, duracao: 60 })),
          interacoes: [],
          metricas: {},
        },
      });
    };
  };

  it('execução acima do limite: as listas detalhadas são truncadas, as estatísticas ficam e o resultado indica', async () => {
    const m = montar({ configuracao: { ...CONFIGURACAO_PADRAO, limiteExecucaoMb: 0.004 } });
    await m.executar();
    comLongTasks(m);
    const resultado = await m.ateTerminar();

    expect(resultado.truncado).toContain('longTasks');
    expect(resultado.dados.longTasks).toEqual([]);
    expect(resultado.cenario?.estatisticas).toHaveLength(3);
    const guardada = m.repositorio.guardadas.get(resultado.id)!;
    expect(guardada.registro.truncado).toEqual(resultado.truncado);
    expect(guardada.dados.longTasks).toEqual([]);
    expect(guardada.registro.resumo?.cenario?.estatisticas).toEqual(resultado.cenario?.estatisticas);
  });

  it('dentro do limite, nada é truncado', async () => {
    const m = montar();
    await m.executar();
    comLongTasks(m);
    const resultado = await m.ateTerminar();
    expect(resultado.truncado).toEqual([]);
    expect(resultado.dados.longTasks.length).toBeGreaterThan(0);
  });

  it('histórico cheio: a nova execução entra só com as estatísticas, e avisa pelo `truncado`', async () => {
    const repositorio = criarRepositorioFalso();
    const m = montar({ repositorio, configuracao: { ...CONFIGURACAO_PADRAO, limiteHistoricoMb: 0.01 } });
    await m.executar({ ...CENARIO, execucao: { iteracoes: 1 } });
    const primeira = await m.ateTerminar();
    // A execução anterior ocupa o histórico inteiro.
    const antiga = repositorio.guardadas.get(primeira.id)!;
    antiga.registro.tamanho = 0.01 * 1024 * 1024;

    await m.executar();
    comLongTasks(m);
    const segunda = await m.ateTerminar();
    expect(segunda.truncado).toContain('longTasks');
    expect(segunda.cenario?.estatisticas).toHaveLength(3);
    // Nada do que já estava guardado foi descartado.
    expect(repositorio.guardadas.has(primeira.id)).toBe(true);
  });

  it('retenção de 2 por cenário: a terceira execução remove a mais antiga daquele cenário', async () => {
    const m = montar({ configuracao: { ...CONFIGURACAO_PADRAO, retencao: { maximoPorCenario: 2, idadeMaximaDias: null } } });
    const umaVez = { ...CENARIO, execucao: { iteracoes: 1 } };
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      await m.executar(umaVez);
      ids.push((await m.ateTerminar()).id);
    }
    expect((await m.repositorio.listar()).map((r) => r.id).sort()).toEqual([ids[1], ids[2]].sort());
  });

  it('a execução marcada como linha de base não é removida pela retenção', async () => {
    const ids: string[] = [];
    // A primeira execução vira a referência depois de terminar.
    const m = montar({ configuracao: { ...CONFIGURACAO_PADRAO, retencao: { maximoPorCenario: 2, idadeMaximaDias: null } }, protegidos: () => ids.slice(0, 1) });
    const umaVez = { ...CENARIO, execucao: { iteracoes: 1 } };
    for (let i = 0; i < 4; i++) {
      await m.executar(umaVez);
      ids.push((await m.ateTerminar()).id);
    }
    expect((await m.repositorio.listar()).map((r) => r.id).sort()).toEqual([ids[0], ids[2], ids[3]].sort());
  });
});

describe('recuperação ao acordar', () => {
  it('service worker encerrado no meio do cenário: limpa, marca como interrompida e mantém os dados das iterações anteriores', async () => {
    const repositorio = criarRepositorioFalso();
    const primeiro = montar({ repositorio });
    // A execução para na terceira iteração: o clique nunca volta.
    let cliques = 0;
    const responder = primeiro.transporte.responder;
    primeiro.transporte.responder = (metodo, p) => {
      if (metodo === 'Input.dispatchMouseEvent' && (p as { type?: string }).type === 'mousePressed' && ++cliques === 5) return new Promise(() => undefined);
      return responder(metodo, p);
    };
    await primeiro.executar();
    for (let i = 0; i < 200 && cliques < 5; i++) await new Promise<void>((resolver) => setImmediate(resolver));
    await new Promise<void>((resolver) => setImmediate(resolver));
    const emCurso = primeiro.gravado()!;
    expect(emCurso).toMatchObject({ fase: 'ativa', sessao: { id: 'analise-1', usaDebugger: true } });
    expect(repositorio.guardadas.get('analise-1')?.registro).toMatchObject({ estado: 'em-andamento' });

    // Novo service worker: memória vazia, debugger ainda anexado, script ainda registrado.
    const segundo = montar({ repositorio, gravado: emCurso });
    segundo.transporte.anexadas.add(ABA);
    segundo.scripts.set('sondagem-sessao', ['http://localhost/*']);
    await segundo.orquestrador.recuperar();

    expect(segundo.transporte.anexadas.size).toBe(0);
    expect(segundo.scripts.size).toBe(0);
    expect(segundo.gravado()).toMatchObject({ fase: 'ociosa', sessao: null, idResultado: 'analise-1' });
    const guardada = repositorio.guardadas.get('analise-1')!;
    expect(guardada.registro).toMatchObject({
      estado: 'interrompida',
      andamento: null,
      resumo: { desfecho: 'interrompida', cenario: { estadoFinal: 'erro', iteracoesCompletas: 2, iteracoesIncompletas: 1 } },
    });
    expect(guardada.registro.resumo?.cenario?.falhas.at(-1)).toMatchObject({ iteracao: 3, motivo: 'A extensão foi suspensa durante a execução.' });
    expect(await repositorio.emAndamento()).toEqual([]);
    expect((await segundo.visao()).resultado).toMatchObject({ id: 'analise-1', desfecho: 'interrompida' });
  });

  it('registro "em andamento" sem estado de sessão (o navegador fechou): vira interrompido com o que estava gravado', async () => {
    const repositorio = criarRepositorioFalso();
    const primeiro = montar({ repositorio });
    let cliques = 0;
    const responder = primeiro.transporte.responder;
    primeiro.transporte.responder = (metodo, p) => {
      if (metodo === 'Input.dispatchMouseEvent' && (p as { type?: string }).type === 'mousePressed' && ++cliques === 3) return new Promise(() => undefined);
      return responder(metodo, p);
    };
    await primeiro.executar();
    for (let i = 0; i < 200 && cliques < 3; i++) await new Promise<void>((resolver) => setImmediate(resolver));
    await new Promise<void>((resolver) => setImmediate(resolver));

    // O `chrome.storage.session` não sobrevive ao reinício do navegador; o IndexedDB, sim.
    const segundo = montar({ repositorio });
    await segundo.orquestrador.recuperar();

    const guardada = repositorio.guardadas.get('analise-1')!;
    expect(guardada.registro).toMatchObject({ estado: 'interrompida', resumo: { desfecho: 'interrompida', cenario: { iteracoesCompletas: 1 } } });
    expect(await repositorio.emAndamento()).toEqual([]);
    expect(segundo.gravado()).toBeUndefined();
  });

  it('acordar com uma sessão manual ativa não a encerra nem mexe no registro dela', async () => {
    const repositorio = criarRepositorioFalso();
    const primeiro = montar({ repositorio });
    await primeiro.orquestrador.comando({ tipo: 'iniciar', idAba: ABA, selecao: ['processamento'] });

    const segundo = montar({ repositorio, gravado: primeiro.gravado() });
    await segundo.orquestrador.recuperar();
    expect(segundo.gravado()).toMatchObject({ fase: 'ativa' });
    expect(repositorio.guardadas.get('analise-1')?.registro.estado).toBe('em-andamento');
  });

  it('depois de reiniciar, o último resultado é relido do repositório pelo id gravado', async () => {
    const repositorio = criarRepositorioFalso();
    const primeiro = montar({ repositorio });
    await primeiro.executar({ ...CENARIO, execucao: { iteracoes: 1 } });
    const resultado = await primeiro.ateTerminar();

    const segundo = montar({ repositorio, gravado: primeiro.gravado() });
    await segundo.orquestrador.recuperar();
    expect((await segundo.visao()).resultado).toEqual(resultado);
  });

  it('se o último resultado foi removido do histórico, a visão volta sem resultado', async () => {
    const repositorio = criarRepositorioFalso();
    const primeiro = montar({ repositorio });
    await primeiro.executar({ ...CENARIO, execucao: { iteracoes: 1 } });
    const resultado = await primeiro.ateTerminar();
    await repositorio.remover(resultado.id);

    const segundo = montar({ repositorio, gravado: primeiro.gravado() });
    await segundo.orquestrador.recuperar();
    expect((await segundo.visao()).resultado).toBeNull();
  });
});
