import { describe, expect, it } from 'vitest';
import { dadosVazios } from '../shared/agregacao.ts';
import type { Cenario, Passo } from '../shared/cenario.ts';
import { PERFIL_PADRAO, condicoesDe, resolverThrottling } from '../shared/condicoes.ts';
import { andamentoInicial } from '../shared/execucao-estado.ts';
import { confirmarLimpeza } from '../shared/limpeza-storage.ts';
import type { AndamentoExecucao, CondicoesDeTeste } from '../shared/types.ts';
import { ABA, ABRIR, FECHAR, criarPagina, criarRelogioSimulado, criarTransporteFalso } from './apoio-teste.ts';
import { criarConexaoCdp } from './cdp.ts';
import { COMANDOS_DE_CONDICOES, efeitosDasCondicoes, limparCache, limparStorage } from './condicoes.ts';
import { MOTIVO_CANCELAMENTO, type PlanoExecucao, executarCenario } from './scenarios.ts';

const URL_INICIAL = 'http://localhost:4300/protegida';
const ORIGEM = 'http://localhost:4300';
const URL_LOGIN = 'http://localhost:4300/login';
const PADRAO: CondicoesDeTeste = condicoesDe(PERFIL_PADRAO, { desligado: true, limpo: true });

const CICLO: Passo[] = [
  { tipo: 'clicar', seletor: ABRIR },
  { tipo: 'clicar', seletor: FECHAR },
];

function cenario(extras: Partial<Cenario> = {}): Cenario {
  return {
    versao_esquema: 1,
    nome: 'teste',
    url_inicial: URL_INICIAL,
    passos: [{ tipo: 'repetir', vezes: 'iteracoes', passos: CICLO }],
    ...extras,
  };
}

async function montar() {
  const transporte = criarTransporteFalso();
  const pagina = criarPagina(transporte);
  const relogio = criarRelogioSimulado();
  const controle = new AbortController();
  const conexao = criarConexaoCdp(transporte);
  await conexao.anexar(ABA);
  const restauradas: string[][] = [];
  /** URL para onde cada `Page.navigate` leva de fato (um redirecionamento, por exemplo). */
  const destinos: string[] = [];
  const responder = transporte.responder;
  transporte.responder = (metodo, parametros) => {
    const resposta = responder(metodo, parametros);
    if (metodo === 'Page.navigate') {
      const url = destinos.shift() ?? String((parametros as { url: string }).url);
      queueMicrotask(() => transporte.emitir(ABA, 'Page.frameNavigated', { frame: { id: 'principal', url } }));
    }
    return resposta;
  };
  return {
    transporte,
    pagina,
    controle,
    restauradas,
    destinos,
    anexada: () => transporte.anexadas.has(ABA),
    rodar(c: Cenario, plano: Partial<PlanoExecucao> = {}): Promise<AndamentoExecucao> {
      return executarCenario(
        { cenario: c, iteracoes: 3, verificacoesAtivas: ['processamento'], ...plano },
        {
          cdp: conexao,
          relogio,
          sinal: controle.signal,
          ultimaLongTask: () => null,
          memoria: { dados: dadosVazios() },
          aoMudar: () => undefined,
          aoRestaurar: (desfeitas) => void restauradas.push(desfeitas),
        },
        andamentoInicial(3),
      );
    },
    metodos: () => transporte.comandos.map((c) => c.metodo),
    comandos: (metodo: string) => transporte.comandos.filter((c) => c.metodo === metodo).map((c) => c.parametros as Record<string, unknown>),
  };
}

describe('throttling e cache', () => {
  it('com "padrao": aplica CPU, rede e cache desligado antes da carga inicial e do aquecimento', async () => {
    const m = await montar();
    const andamento = await m.rodar(cenario({ aquecimento: [{ tipo: 'clicar', seletor: ABRIR }] }), { condicoes: PADRAO });
    expect(andamento.estado).toBe('concluida');

    expect(m.comandos('Emulation.setCPUThrottlingRate')[0]).toEqual({ rate: 4 });
    // 1,6 Mbps e 750 kbps em bytes por segundo.
    expect(m.comandos('Network.emulateNetworkConditions')[0]).toEqual({ offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750 });
    expect(m.comandos('Network.setCacheDisabled')[0]).toEqual({ cacheDisabled: true });

    const metodos = m.metodos();
    const carga = metodos.indexOf('Page.navigate');
    const primeiroClique = metodos.indexOf('Input.dispatchMouseEvent');
    for (const metodo of ['Emulation.setCPUThrottlingRate', 'Network.emulateNetworkConditions', 'Network.setCacheDisabled']) {
      expect(metodos.indexOf(metodo)).toBeGreaterThan(-1);
      expect(metodos.indexOf(metodo)).toBeLessThan(carga);
    }
    expect(carga).toBeLessThan(primeiroClique);
  });

  it('as condições não mudam durante a execução: cada uma é aplicada uma vez e desfeita uma vez, no fim', async () => {
    const m = await montar();
    await m.rodar(cenario(), { condicoes: PADRAO });

    expect(m.comandos('Emulation.setCPUThrottlingRate')).toEqual([{ rate: 4 }, { rate: 1 }]);
    expect(m.comandos('Network.setCacheDisabled')).toEqual([{ cacheDisabled: true }, { cacheDisabled: false }]);
    expect(m.comandos('Network.emulateNetworkConditions')[1]).toEqual({ offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    // A restauração vem depois do último passo, na ordem inversa da aplicação.
    const metodos = m.metodos();
    expect(metodos.lastIndexOf('Emulation.setCPUThrottlingRate')).toBeGreaterThan(metodos.lastIndexOf('Input.dispatchMouseEvent'));
    expect(m.restauradas).toEqual([['cache desligado', 'throttling de rede', 'throttling de CPU']]);
    expect(m.anexada()).toBe(false);
  });

  it('restaura também quando um passo falha', async () => {
    const m = await montar();
    m.pagina.elementos.delete(FECHAR);
    const andamento = await m.rodar(cenario(), { condicoes: PADRAO });

    expect(andamento.estado).toBe('erro');
    expect(m.comandos('Emulation.setCPUThrottlingRate').at(-1)).toEqual({ rate: 1 });
    expect(m.comandos('Network.setCacheDisabled').at(-1)).toEqual({ cacheDisabled: false });
    expect(m.restauradas).toEqual([['cache desligado', 'throttling de rede', 'throttling de CPU']]);
    expect(m.anexada()).toBe(false);
  });

  it('restaura também em cancelamento, com o debugger ainda anexado na hora de desfazer', async () => {
    const m = await montar();
    let cliques = 0;
    m.pagina.aoComando = (metodo, p) => {
      if (metodo === 'Input.dispatchMouseEvent' && p['type'] === 'mousePressed' && ++cliques === 3) m.controle.abort(MOTIVO_CANCELAMENTO);
    };
    const andamento = await m.rodar(cenario(), { condicoes: PADRAO });

    expect(andamento.estado).toBe('cancelada');
    expect(m.comandos('Emulation.setCPUThrottlingRate')).toEqual([{ rate: 4 }, { rate: 1 }]);
    expect(m.comandos('Network.emulateNetworkConditions')).toHaveLength(2);
    expect(m.comandos('Network.setCacheDisabled')).toEqual([{ cacheDisabled: true }, { cacheDisabled: false }]);
    expect(m.restauradas[0]).toHaveLength(3);
    expect(m.anexada()).toBe(false);
  });

  it('cancelamento durante a própria preparação: desfaz o que já tinha entrado', async () => {
    const m = await montar();
    m.pagina.aoComando = (metodo) => {
      if (metodo === 'Network.emulateNetworkConditions') m.controle.abort(MOTIVO_CANCELAMENTO);
    };
    const andamento = await m.rodar(cenario(), { condicoes: PADRAO });

    expect(andamento.estado).toBe('cancelada');
    expect(m.metodos()).not.toContain('Page.navigate');
    expect(m.comandos('Emulation.setCPUThrottlingRate')).toEqual([{ rate: 4 }, { rate: 1 }]);
    expect(m.comandos('Network.emulateNetworkConditions').at(-1)).toMatchObject({ latency: 0 });
    // O cache nem chegou a ser desligado.
    expect(m.metodos()).not.toContain('Network.setCacheDisabled');
  });

  it('perfil personalizado: aplica o fator de CPU 6 e a latência de 300 ms, sem limite de taxa', async () => {
    const m = await montar();
    const resolucao = resolverThrottling({ cpu: 6, rede: { latencia_ms: 300 } }, []);
    if (!resolucao.ok) throw new Error(resolucao.mensagem);
    await m.rodar(cenario(), { condicoes: condicoesDe(resolucao.perfil, { desligado: true, limpo: true }) });

    expect(m.comandos('Emulation.setCPUThrottlingRate')[0]).toEqual({ rate: 6 });
    expect(m.comandos('Network.emulateNetworkConditions')[0]).toEqual({ offline: false, latency: 300, downloadThroughput: -1, uploadThroughput: -1 });
  });

  it('com "nenhum" e o cache mantido: nenhuma emulação é enviada, e nada há para restaurar', async () => {
    const m = await montar();
    await m.rodar(cenario(), { condicoes: condicoesDe({ nome: 'nenhum', cpu: 1, rede: null }, { desligado: false, limpo: true }) });

    expect(m.metodos().filter((metodo) => /Emulation\.|emulateNetworkConditions|setCacheDisabled/.test(metodo))).toEqual([]);
    expect(m.restauradas).toEqual([[]]);
  });

  it('sem condições no plano, nada é aplicado nem limpo', async () => {
    const m = await montar();
    await m.rodar(cenario());
    expect(m.metodos().filter((metodo) => COMANDOS_DE_CONDICOES.includes(metodo))).toEqual([]);
  });

  it('todo comando enviado pelas condições está em COMANDOS_DE_CONDICOES', async () => {
    const m = await montar();
    const limpeza = confirmarLimpeza({ limpar_storage: ['cookies'] }, ['cookies']);
    if (!limpeza.ok) throw new Error('não confirmou');
    await m.rodar(cenario(), { condicoes: PADRAO, limparStorage: limpeza.tipos });
    const dasCondicoes = m.metodos().filter((metodo) => /^(Emulation|Storage)\.|Network\.(emulate|setCache|clear)/.test(metodo));
    expect(new Set(dasCondicoes)).toEqual(new Set(COMANDOS_DE_CONDICOES));
  });
});

describe('limpeza de cache antes da execução', () => {
  it('limpa o cache HTTP e o Cache Storage da origem antes da carga inicial, que faz a recarga', async () => {
    const m = await montar();
    await m.rodar(cenario(), { condicoes: PADRAO });

    const metodos = m.metodos();
    expect(metodos.filter((metodo) => metodo === 'Network.clearBrowserCache')).toHaveLength(1);
    expect(m.comandos('Storage.clearDataForOrigin')).toEqual([{ origin: ORIGEM, storageTypes: 'cache_storage' }]);
    expect(metodos.indexOf('Network.clearBrowserCache')).toBeLessThan(metodos.indexOf('Page.navigate'));
    expect(metodos.indexOf('Storage.clearDataForOrigin')).toBeLessThan(metodos.indexOf('Page.navigate'));
    expect(m.comandos('Page.navigate')).toEqual([{ url: URL_INICIAL }]);
  });

  it('os parâmetros da limpeza padrão não incluem cookies nem outro tipo de storage', async () => {
    const m = await montar();
    await m.rodar(cenario({ limpar_storage: ['cookies', 'local_storage'] }), { condicoes: PADRAO });

    // Mesmo com `limpar_storage` no cenário: sem os tipos confirmados no plano, só o cache sai.
    const tipos = m.comandos('Storage.clearDataForOrigin').map((p) => p['storageTypes']);
    expect(tipos).toEqual(['cache_storage']);
    const enviado = JSON.stringify(m.transporte.comandos);
    for (const proibido of ['cookies', 'local_storage', 'indexeddb', 'session_storage', '"all"', 'sessionStorage', 'Network.clearBrowserCookies']) {
      expect(enviado).not.toContain(proibido);
    }
  });

  it('`limparCache` só envia os dois comandos de cache', async () => {
    const enviados: { metodo: string; parametros?: object }[] = [];
    await limparCache({ enviar: async (metodo: string, parametros?: object) => void enviados.push({ metodo, parametros }) as never }, ORIGEM);
    expect(enviados).toEqual([
      { metodo: 'Network.clearBrowserCache', parametros: undefined },
      { metodo: 'Storage.clearDataForOrigin', parametros: { origin: ORIGEM, storageTypes: 'cache_storage' } },
    ]);
  });
});

describe('limpeza de storage confirmada', () => {
  it('só há tipos confirmados se o usuário confirmou todos os que o cenário declara', () => {
    const declarado = { limpar_storage: ['local_storage', 'cookies'] as const };
    expect(confirmarLimpeza({ limpar_storage: [...declarado.limpar_storage] }, undefined)).toEqual({ ok: false, faltando: ['local_storage', 'cookies'] });
    expect(confirmarLimpeza({ limpar_storage: [...declarado.limpar_storage] }, ['cookies'])).toEqual({ ok: false, faltando: ['local_storage'] });
    expect(confirmarLimpeza({ limpar_storage: [...declarado.limpar_storage] }, ['cookies', 'local_storage'])).toEqual({
      ok: true,
      tipos: ['local_storage', 'cookies'],
    });
  });

  it('o que foi confirmado sem estar no cenário é ignorado', () => {
    expect(confirmarLimpeza({ limpar_storage: ['local_storage'] }, ['local_storage', 'cookies', 'indexeddb'])).toEqual({ ok: true, tipos: ['local_storage'] });
    // Cenário sem `limpar_storage`: nada a confirmar e nada a apagar, não importa o que venha marcado.
    expect(confirmarLimpeza({}, ['cookies'])).toEqual({ ok: true, tipos: [] });
  });

  it('o Cache Storage não precisa de confirmação: já sai na limpeza padrão', () => {
    expect(confirmarLimpeza({ limpar_storage: ['cache_storage'] }, [])).toEqual({ ok: true, tipos: [] });
  });

  /** Expressões de limpeza avaliadas na página, na ordem. */
  const limpezasNaPagina = (m: Awaited<ReturnType<typeof montar>>): string[] =>
    m.comandos('Runtime.evaluate').map((p) => String(p['expression'])).filter((expressao) => expressao.includes('.clear()'));

  it('localStorage confirmado: é limpo na página da origem, e nada mais é apagado', async () => {
    const m = await montar();
    const limpeza = confirmarLimpeza({ limpar_storage: ['local_storage'] }, ['local_storage']);
    if (!limpeza.ok) throw new Error('não confirmou');
    await m.rodar(cenario({ limpar_storage: ['local_storage'] }), { condicoes: PADRAO, limparStorage: limpeza.tipos });

    // Pelo CDP sai só o cache: `Storage.clearDataForOrigin` com `local_storage` levaria junto o sessionStorage.
    expect(m.comandos('Storage.clearDataForOrigin')).toEqual([{ origin: ORIGEM, storageTypes: 'cache_storage' }]);
    expect(limpezasNaPagina(m)).toEqual([`(() => { if (location.origin !== "${ORIGEM}") return false; localStorage.clear(); return true; })()`]);
    const enviado = JSON.stringify(m.transporte.comandos);
    expect(enviado).not.toContain('cookies');
    expect(enviado).not.toContain('sessionStorage');
    expect(enviado).not.toContain('indexeddb');
  });

  it('cookies e IndexedDB vão em uma chamada do CDP; o sessionStorage é limpo na página, seguido de carga nova', async () => {
    const m = await montar();
    const limpeza = confirmarLimpeza({ limpar_storage: ['cookies', 'indexeddb', 'session_storage'] }, ['cookies', 'indexeddb', 'session_storage']);
    if (!limpeza.ok) throw new Error('não confirmou');
    const andamento = await m.rodar(cenario(), { limparStorage: limpeza.tipos });

    expect(andamento.estado).toBe('concluida');
    expect(m.comandos('Storage.clearDataForOrigin')).toEqual([{ origin: ORIGEM, storageTypes: 'cookies,indexeddb' }]);
    expect(limpezasNaPagina(m)).toEqual([`(() => { if (location.origin !== "${ORIGEM}") return false; sessionStorage.clear(); return true; })()`]);
    const metodos = m.metodos();
    const limpezaNaPagina = m.transporte.comandos.findIndex((c) => String((c.parametros as { expression?: string })?.expression).includes('.clear()'));
    const cargas = metodos.flatMap((metodo, i) => (metodo === 'Page.navigate' ? [i] : []));
    expect(cargas).toHaveLength(2);
    expect(limpezaNaPagina).toBeGreaterThan(cargas[0]!);
    expect(limpezaNaPagina).toBeLessThan(cargas[1]!);
  });

  it('se a URL inicial levou a aba para outra origem, a limpeza na página não acontece e a execução para', async () => {
    const m = await montar();
    m.pagina.limpezaNaPagina = false;
    const limpeza = confirmarLimpeza({ limpar_storage: ['local_storage'] }, ['local_storage']);
    if (!limpeza.ok) throw new Error('não confirmou');
    const andamento = await m.rodar(cenario(), { condicoes: PADRAO, limparStorage: limpeza.tipos });

    expect(andamento.estado).toBe('erro');
    expect(andamento.falhas.at(-1)?.motivo).toBe(`Não foi possível limpar o storage: a URL inicial levou a aba para fora de ${ORIGEM}.`);
    expect(m.metodos()).not.toContain('Input.dispatchMouseEvent');
    expect(m.comandos('Emulation.setCPUThrottlingRate').at(-1)).toEqual({ rate: 1 });
  });

  it('`limparStorage` com lista vazia não envia nada', async () => {
    const enviados: string[] = [];
    const limpeza = confirmarLimpeza({}, []);
    if (!limpeza.ok) throw new Error('não confirmou');
    expect(await limparStorage({ enviar: async (metodo: string) => void enviados.push(metodo) as never }, ORIGEM, limpeza.tipos)).toEqual([]);
    expect(enviados).toEqual([]);
  });
});

describe('efeitos das condições', () => {
  it('só cria efeito para o que muda alguma coisa', () => {
    const cdp = { enviar: async () => ({}) as never };
    expect(efeitosDasCondicoes(PADRAO, cdp).map((e) => e.nome)).toEqual(['throttling de CPU', 'throttling de rede', 'cache desligado']);
    expect(efeitosDasCondicoes({ ...PADRAO, rede: null, cacheDesligado: false }, cdp).map((e) => e.nome)).toEqual(['throttling de CPU']);
    expect(efeitosDasCondicoes({ ...PADRAO, cpu: 1, rede: null, cacheDesligado: false }, cdp)).toEqual([]);
  });
});

describe('sessão expirada', () => {
  const COM_LOGIN = { sessao: { url_login: URL_LOGIN } };

  it('redirecionamento para o login na iteração 2: para com falha de sessão, sem tentar autenticar', async () => {
    const m = await montar();
    let cliques = 0;
    m.pagina.aoComando = (metodo, p) => {
      if (metodo !== 'Input.dispatchMouseEvent' || p['type'] !== 'mousePressed' || ++cliques !== 3) return;
      queueMicrotask(() => m.transporte.emitir(ABA, 'Page.frameNavigated', { frame: { id: 'principal', url: `${URL_LOGIN}?voltar=%2Fprotegida` } }));
    };
    const andamento = await m.rodar(cenario(COM_LOGIN), { condicoes: PADRAO });

    expect(andamento.estado).toBe('erro');
    expect(andamento.falhaDeSessao).toEqual({ url: `${URL_LOGIN}?voltar=%2Fprotegida`, iteracao: 2 });
    expect(andamento.falhas).toEqual([
      {
        // O terceiro clique é o primeiro passo da iteração 2: o redirecionamento é visto ainda dentro dele.
        caminho: '/passos/0/passos/0',
        tipoPasso: 'clicar',
        iteracao: 2,
        motivo: `Falha de sessão: a aplicação redirecionou para a tela de login (${URL_LOGIN}?voltar=%2Fprotegida).`,
        acao: 'interrompeu',
        falhaDeSessao: true,
      },
    ]);
    expect(andamento.iteracoes.map((i) => i.completa)).toEqual([true, false]);
    // Nada foi digitado nem clicado depois do redirecionamento, e as condições saíram.
    expect(cliques).toBe(3);
    expect(m.metodos()).not.toContain('Input.insertText');
    expect(m.comandos('Emulation.setCPUThrottlingRate').at(-1)).toEqual({ rate: 1 });
    expect(m.anexada()).toBe(false);
  });

  it('a política `em_erro` não transforma a falha de sessão em passo pulado', async () => {
    const m = await montar();
    m.pagina.aoComando = (metodo, p) => {
      if (metodo === 'Input.dispatchMouseEvent' && p['type'] === 'mousePressed') {
        queueMicrotask(() => m.transporte.emitir(ABA, 'Page.frameNavigated', { frame: { id: 'principal', url: URL_LOGIN } }));
      }
    };
    const passos: Passo[] = [{ tipo: 'repetir', vezes: 'iteracoes', passos: CICLO.map((p) => ({ ...p, em_erro: 'pular' }) as Passo) }];
    const andamento = await m.rodar(cenario({ ...COM_LOGIN, passos }));

    expect(andamento.estado).toBe('erro');
    expect(andamento.falhas).toHaveLength(1);
    expect(andamento.falhas[0]).toMatchObject({ acao: 'interrompeu', falhaDeSessao: true, iteracao: 1 });
  });

  it('a carga inicial já cai no login: falha de sessão antes de qualquer passo', async () => {
    const m = await montar();
    m.destinos.push(URL_LOGIN);
    const andamento = await m.rodar(cenario(COM_LOGIN));

    expect(andamento.estado).toBe('erro');
    expect(andamento.falhaDeSessao).toEqual({ url: URL_LOGIN, iteracao: null });
    expect(andamento.falhas).toEqual([expect.objectContaining({ caminho: '', falhaDeSessao: true, iteracao: null })]);
    expect(m.metodos()).not.toContain('Input.dispatchMouseEvent');
  });

  it('navegação que não casa com a URL de login não interrompe nada', async () => {
    const m = await montar();
    m.pagina.aoComando = (metodo, p) => {
      if (metodo === 'Input.dispatchMouseEvent' && p['type'] === 'mousePressed') {
        queueMicrotask(() => m.transporte.emitir(ABA, 'Page.frameNavigated', { frame: { id: 'principal', url: 'http://localhost:4300/protegida/detalhe' } }));
      }
    };
    const andamento = await m.rodar(cenario(COM_LOGIN));
    expect(andamento.estado).toBe('concluida');
    expect(andamento.falhaDeSessao).toBeNull();
  });

  it('padrão com asterisco e navegação dentro do documento (aplicação de página única)', async () => {
    const m = await montar();
    let cliques = 0;
    m.pagina.aoComando = (metodo, p) => {
      if (metodo !== 'Input.dispatchMouseEvent' || p['type'] !== 'mousePressed' || ++cliques !== 1) return;
      queueMicrotask(() => m.transporte.emitir(ABA, 'Page.navigatedWithinDocument', { frameId: 'principal', url: 'http://localhost:4300/#/entrar?motivo=expirou' }));
    };
    const andamento = await m.rodar(cenario({ sessao: { url_login: '*/#/entrar*' } }));
    expect(andamento.estado).toBe('erro');
    expect(andamento.falhaDeSessao).toEqual({ url: 'http://localhost:4300/#/entrar?motivo=expirou', iteracao: 1 });
  });

  it('um iframe que abre a tela de login não é falha de sessão', async () => {
    const m = await montar();
    m.pagina.aoComando = (metodo, p) => {
      if (metodo === 'Input.dispatchMouseEvent' && p['type'] === 'mousePressed') {
        queueMicrotask(() => m.transporte.emitir(ABA, 'Page.frameNavigated', { frame: { id: 'filho', parentId: 'principal', url: URL_LOGIN } }));
      }
    };
    expect((await m.rodar(cenario(COM_LOGIN))).estado).toBe('concluida');
  });

  it('sem `url_login`, a detecção fica desligada', async () => {
    const m = await montar();
    m.destinos.push(URL_LOGIN);
    const andamento = await m.rodar(cenario());
    expect(andamento.estado).toBe('concluida');
    expect(andamento.falhaDeSessao).toBeNull();
  });
});

describe('login declarado', () => {
  const LOGIN: Cenario['sessao'] = {
    url_login: URL_LOGIN,
    passos_login: [
      { tipo: 'digitar', seletor: ABRIR, texto: 'segredo-do-usuario' },
      { tipo: 'clicar', seletor: FECHAR },
    ],
  };

  it('a carga inicial cai no login: executa os passos de login, reabre a URL inicial e segue', async () => {
    const m = await montar();
    m.destinos.push(URL_LOGIN);
    const andamento = await m.rodar(cenario({ sessao: LOGIN }), { iteracoes: 1 });

    expect(andamento.estado).toBe('concluida');
    expect(andamento.falhaDeSessao).toBeNull();
    expect(m.comandos('Input.insertText')).toEqual([{ text: 'segredo-do-usuario' }]);
    expect(m.comandos('Page.navigate')).toEqual([{ url: URL_INICIAL }, { url: URL_INICIAL }]);
    // Os passos de login não são iteração nem aquecimento do resultado.
    expect(andamento.iteracoes).toHaveLength(1);
    expect(andamento.aquecimento).toBeNull();
  });

  it('a aplicação já está autenticada: os passos de login não rodam', async () => {
    const m = await montar();
    const andamento = await m.rodar(cenario({ sessao: LOGIN }));
    expect(andamento.estado).toBe('concluida');
    expect(m.metodos()).not.toContain('Input.insertText');
    expect(m.comandos('Page.navigate')).toHaveLength(1);
  });

  it('o login não funcionou (a aplicação volta ao login): falha de sessão, sem segunda tentativa', async () => {
    const m = await montar();
    m.destinos.push(URL_LOGIN, URL_LOGIN);
    const andamento = await m.rodar(cenario({ sessao: LOGIN }));

    expect(andamento.estado).toBe('erro');
    expect(andamento.falhaDeSessao).toEqual({ url: URL_LOGIN, iteracao: null });
    expect(m.comandos('Input.insertText')).toHaveLength(1);
  });

  it('depois do login, a sessão expirar no meio da execução é falha de sessão: o login não é refeito', async () => {
    const m = await montar();
    m.destinos.push(URL_LOGIN);
    let cliques = 0;
    m.pagina.aoComando = (metodo, p) => {
      // O primeiro clique é o do passo de login.
      if (metodo !== 'Input.dispatchMouseEvent' || p['type'] !== 'mousePressed' || ++cliques !== 3) return;
      queueMicrotask(() => m.transporte.emitir(ABA, 'Page.frameNavigated', { frame: { id: 'principal', url: URL_LOGIN } }));
    };
    const andamento = await m.rodar(cenario({ sessao: LOGIN }));

    expect(andamento.estado).toBe('erro');
    expect(andamento.falhaDeSessao).toEqual({ url: URL_LOGIN, iteracao: 1 });
    expect(m.comandos('Input.insertText')).toHaveLength(1);
  });

  it('nenhuma falha registrada traz o texto digitado no login', async () => {
    const m = await montar();
    m.destinos.push(URL_LOGIN);
    m.pagina.elementos.delete(FECHAR);
    const andamento = await m.rodar(cenario({ sessao: LOGIN }));

    expect(andamento.estado).toBe('erro');
    expect(andamento.falhas[0]).toMatchObject({ caminho: '/sessao/passos_login/1', tipoPasso: 'clicar' });
    expect(JSON.stringify(andamento)).not.toContain('segredo-do-usuario');
  });
});
