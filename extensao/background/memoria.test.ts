import { describe, expect, it } from 'vitest';
import { dadosVazios } from '../shared/agregacao.ts';
import { GRUPO_CENSO, GRUPO_COLETA, contarPorConstrutor, forcarColeta, lerContadoresDom, medirMemoria, tirarSnapshot } from './memoria.ts';

/** Canal de CDP que responde pelo método e registra o que foi enviado. */
function canal(respostas: Record<string, unknown | (() => unknown)> = {}) {
  const comandos: { metodo: string; parametros?: object }[] = [];
  const padrao: Record<string, unknown> = {
    'Runtime.evaluate': { result: { objectId: 'prototipo' } },
    'Runtime.queryObjects': { objects: { objectId: 'lista' } },
    'Performance.getMetrics': { metrics: [{ name: 'JSHeapUsedSize', value: 2_000_000 }, { name: 'Nodes', value: 80 }, { name: 'JSEventListeners', value: 12 }] },
    'DOM.getDetachedDomNodes': { detachedNodes: [] },
  };
  return {
    comandos,
    metodos: () => comandos.map((c) => c.metodo),
    cdp: {
      async enviar<T>(metodo: string, parametros?: object): Promise<T> {
        comandos.push({ metodo, parametros });
        const resposta = metodo in respostas ? respostas[metodo] : (padrao[metodo] ?? {});
        return (typeof resposta === 'function' ? (resposta as () => unknown)() : resposta) as T;
      },
    },
  };
}

describe('função de contagem do censo', () => {
  class Carrinho {}
  class Produto {}

  it('conta os objetos pelo nome do construtor, em ordem decrescente', () => {
    const objetos = [new Produto(), new Produto(), new Carrinho(), [1], [2], [3], {}, new Map(), function nomeada() {}];
    expect(contarPorConstrutor.call(objetos, 500)).toEqual({
      totalObjetos: 9,
      construtores: [
        { nome: 'Array', contagem: 3 },
        { nome: 'Produto', contagem: 2 },
        { nome: 'Carrinho', contagem: 1 },
        { nome: 'Function', contagem: 1 },
        { nome: 'Map', contagem: 1 },
        { nome: 'Object', contagem: 1 },
      ],
      outros: null,
    });
  });

  it('guarda os de maior contagem e soma o resto em "outros"', () => {
    const objetos = Array.from({ length: 600 }, (_, i) => {
      const classe = { [`Classe${i}`]: class {} }[`Classe${i}`]!;
      return Array.from({ length: i < 3 ? 10 - i : 1 }, () => new classe());
    }).flat();

    const censo = contarPorConstrutor.call(objetos, 500);
    expect(censo.totalObjetos).toBe(10 + 9 + 8 + 597);
    expect(censo.construtores).toHaveLength(500);
    expect(censo.construtores.slice(0, 3)).toEqual([
      { nome: 'Classe0', contagem: 10 },
      { nome: 'Classe1', contagem: 9 },
      { nome: 'Classe2', contagem: 8 },
    ]);
    expect(censo.outros).toEqual({ nome: '(outros)', contagem: 100 });
    expect(contarPorConstrutor.call(objetos, 2).outros).toEqual({ nome: '(outros)', contagem: 8 + 597 });
  });

  it('objeto sem construtor, classe anônima e getter que lança não interrompem a contagem', () => {
    const semConstrutor = Object.create({});
    const anonima = new (class {})();
    Object.defineProperty(Object.getPrototypeOf(anonima).constructor, 'name', { value: '' });
    const hostil = Object.create(
      Object.defineProperty({}, 'constructor', {
        get() {
          throw new Error('não mexa');
        },
      }),
    );
    const proxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('proxy fechado');
        },
      },
    );
    const censo = contarPorConstrutor.call([semConstrutor, anonima, hostil, proxy], 500);
    expect(Object.fromEntries(censo.construtores.map((c) => [c.nome, c.contagem]))).toEqual({
      Object: 1,
      '(anônimo)': 1,
      '(inacessível)': 2,
    });
  });

  it('é autossuficiente: funciona depois de virar texto, como chega à página', () => {
    // Só no teste: simula o `Runtime.callFunctionOn`, que recebe a função como texto.
    const naPagina = new Function(`return (${contarPorConstrutor.toString()})`)() as typeof contarPorConstrutor;
    expect(naPagina.call([new Produto(), {}, {}], 1)).toEqual({
      totalObjetos: 3,
      construtores: [{ nome: 'Object', contagem: 2 }],
      outros: { nome: '(outros)', contagem: 1 },
    });
  });
});

describe('comandos de CDP', () => {
  it('forcarColeta: consulta os objetos vivos (o que coleta o lixo) e libera o grupo, mesmo se a consulta falhar', async () => {
    const ok = canal();
    await forcarColeta(ok);
    expect(ok.comandos).toEqual([
      { metodo: 'Runtime.evaluate', parametros: { expression: 'Object.prototype', objectGroup: GRUPO_COLETA } },
      { metodo: 'Runtime.queryObjects', parametros: { prototypeObjectId: 'prototipo', objectGroup: GRUPO_COLETA } },
      { metodo: 'Runtime.releaseObjectGroup', parametros: { objectGroup: GRUPO_COLETA } },
    ]);

    const falha = canal({
      'Runtime.queryObjects': () => {
        throw new Error('recusado');
      },
    });
    await expect(forcarColeta(falha)).rejects.toThrow('recusado');
    expect(falha.metodos().at(-1)).toBe('Runtime.releaseObjectGroup');
  });

  it('medirMemoria: lê heap, nós e listeners de Performance.getMetrics', async () => {
    const c = canal();
    const dados = dadosVazios();
    const medicao = await medirMemoria({ ...c, dados, agora: () => 42 }, ['heap_usado', 'nos_dom', 'listeners'], 3);
    expect(medicao).toEqual({ instante: 42, heapUsado: 2_000_000, nosDom: 80, listeners: 12, iteracao: 3 });
    expect(dados.medicoes).toEqual([medicao]);
    expect(c.metodos()).toEqual(['Performance.enable', 'Performance.getMetrics']);
  });

  it('lerContadoresDom: coleta antes, e conta todos os nós de cada árvore desanexada', async () => {
    const arvore = { nodeName: 'SECTION', children: [{ nodeName: 'H2', children: [{ nodeName: '#text' }] }, { nodeName: 'UL', children: [{}, {}, {}] }] };
    const c = canal({
      'DOM.getDetachedDomNodes': {
        detachedNodes: [
          { treeNode: arvore, retainedNodeIds: [1, 2] },
          { treeNode: { nodeName: 'DIV', shadowRoots: [{ children: [{}] }] }, retainedNodeIds: [] },
        ],
      },
    });
    const dados = dadosVazios();
    const contadores = await lerContadoresDom({ ...c, dados }, 'fim');

    // 7 da primeira árvore (section, h2, texto, ul e 3 itens) e 3 da segunda.
    expect(contadores).toEqual({ nosDom: 80, listeners: 12, nosDesanexados: 10 });
    expect(dados.contadoresDom).toEqual({ inicio: null, fim: contadores });
    expect(c.metodos()).toEqual([
      'Runtime.evaluate',
      'Runtime.queryObjects',
      'Runtime.releaseObjectGroup',
      'Performance.enable',
      'Performance.getMetrics',
      'DOM.enable',
      'DOM.getDetachedDomNodes',
      'DOM.disable',
    ]);
  });

  it('lerContadoresDom: navegador sem DOM.getDetachedDomNodes mantém nós e listeners e desliga o domínio', async () => {
    const c = canal({
      'DOM.getDetachedDomNodes': () => {
        throw new Error("'DOM.getDetachedDomNodes' wasn't found");
      },
    });
    const dados = dadosVazios();
    await expect(lerContadoresDom({ ...c, dados }, 'inicio')).rejects.toThrow("wasn't found");
    expect(dados.contadoresDom.inicio).toEqual({ nosDom: 80, listeners: 12, nosDesanexados: null });
    expect(c.metodos().at(-1)).toBe('DOM.disable');
  });

  it('tirarSnapshot: resposta em formato inesperado falha com motivo claro e libera a lista', async () => {
    const c = canal({ 'Runtime.callFunctionOn': { result: { value: 'oi' } } });
    const dados = dadosVazios();
    await expect(tirarSnapshot({ ...c, dados, agora: () => 1 }, 'inicio')).rejects.toThrow('formato inesperado');
    expect(dados.snapshots).toEqual([]);
    expect(dados.pausasDeMedicao).toEqual([{ inicio: 1, fim: 1 }]);
    expect(c.comandos.at(-1)).toEqual({ metodo: 'Runtime.releaseObjectGroup', parametros: { objectGroup: GRUPO_CENSO } });
  });
});
