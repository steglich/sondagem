/** Transporte de CDP, relógio e página simulados para os testes unitários do service worker. */
import { type ExecucaoGuardada, idsARemover } from '../shared/historico.ts';
import type { MotivoDesconexao } from '../shared/types.ts';
import type { RepositorioResultados } from '../storage/repository.ts';
import type { TransporteCdp } from './cdp.ts';
import { GRUPO_COLETA, contarPorConstrutor } from './memoria.ts';

/** `true` se o comando é a consulta que força a coleta de lixo (passo `forcar_gc`). */
export function ehColeta(metodo: string, parametros: Record<string, unknown> | object | undefined): boolean {
  return metodo === 'Runtime.queryObjects' && (parametros as Record<string, unknown> | undefined)?.['objectGroup'] === GRUPO_COLETA;
}

/** Comandos de CDP que só a medição de memória envia. */
export const DE_MEMORIA = /^(Performance|DOM)\.|^Runtime\.(queryObjects|callFunctionOn|releaseObjectGroup)$/;

/** Comandos de CDP que só o perfil de CPU envia. */
export const DE_CPU = /^Tracing\./;

class Item {}
class Painel {}

export interface TransporteFalso extends TransporteCdp {
  /** Abas com o debugger desta extensão anexado. */
  anexadas: Set<number>;
  /** Abas que já têm outro cliente de depuração. */
  depuradasPorOutro: Set<number>;
  /** Erro que a próxima anexação deve lançar. */
  erroAoAnexar: string | null;
  comandos: { idAba: number; metodo: string; parametros?: object }[];
  chamadas: { anexar: number; desanexar: number };
  /** Resposta de cada comando. O padrão é um objeto vazio. */
  responder: (metodo: string, parametros: object | undefined) => unknown;
  /** Evento de CDP vindo do navegador. */
  emitir(idAba: number, metodo: string, parametros?: unknown): void;
  /** Desanexação feita por fora (barra de depuração, aba fechada). */
  derrubar(idAba: number, motivo: MotivoDesconexao): void;
  ouvintesAtivos(): number;
}

export function criarTransporteFalso(): TransporteFalso {
  const eventos = new Set<(idAba: number, metodo: string, parametros: unknown) => void>();
  const quedas = new Set<(idAba: number, motivo: MotivoDesconexao) => void>();
  const transporte: TransporteFalso = {
    anexadas: new Set(),
    depuradasPorOutro: new Set(),
    erroAoAnexar: null,
    comandos: [],
    chamadas: { anexar: 0, desanexar: 0 },
    responder: () => ({}),
    alvoJaDepurado: async (idAba) => transporte.depuradasPorOutro.has(idAba),
    async anexar(idAba) {
      transporte.chamadas.anexar++;
      if (transporte.erroAoAnexar) throw new Error(transporte.erroAoAnexar);
      if (transporte.anexadas.has(idAba)) throw new Error(`Another debugger is already attached to the tab with id: ${idAba}.`);
      transporte.anexadas.add(idAba);
    },
    async desanexar(idAba) {
      transporte.chamadas.desanexar++;
      if (!transporte.anexadas.delete(idAba)) throw new Error(`Debugger is not attached to the tab with id: ${idAba}.`);
    },
    async enviar(idAba, metodo, parametros) {
      if (!transporte.anexadas.has(idAba)) throw new Error(`Debugger is not attached to the tab with id: ${idAba}.`);
      transporte.comandos.push({ idAba, metodo, parametros });
      return transporte.responder(metodo, parametros);
    },
    aoEvento(ouvinte) {
      eventos.add(ouvinte);
      return () => void eventos.delete(ouvinte);
    },
    aoDesanexar(ouvinte) {
      quedas.add(ouvinte);
      return () => void quedas.delete(ouvinte);
    },
    emitir: (idAba, metodo, parametros = {}) => [...eventos].forEach((ouvinte) => ouvinte(idAba, metodo, parametros)),
    derrubar(idAba, motivo) {
      transporte.anexadas.delete(idAba);
      [...quedas].forEach((ouvinte) => ouvinte(idAba, motivo));
    },
    ouvintesAtivos: () => eventos.size + quedas.size,
  };
  return transporte;
}

/** Relógio em que o tempo só anda dentro de `esperar`, sem temporizadores reais. */
export interface RelogioSimulado {
  agora(): number;
  esperar(ms: number, sinal?: AbortSignal): Promise<void>;
  /** Chamado a cada espera, depois de o tempo avançar: é onde o teste faz a página "mudar". */
  aoAvancar: ((agora: number) => void) | null;
  /** Soma de tudo o que foi esperado. */
  esperado: number;
}

export function criarRelogioSimulado(inicio = 1_000_000): RelogioSimulado {
  let agora = inicio;
  const relogio: RelogioSimulado = {
    agora: () => agora,
    aoAvancar: null,
    esperado: 0,
    async esperar(ms, sinal) {
      sinal?.throwIfAborted();
      agora += ms;
      relogio.esperado += ms;
      relogio.aoAvancar?.(agora);
      // Cede a vez, como um temporizador real, para que eventos e cancelamentos sejam vistos.
      await Promise.resolve();
      sinal?.throwIfAborted();
    },
  };
  return relogio;
}

export const ABA = 5;
export const ABRIR = "[data-testid='abrir']";
export const FECHAR = "[data-testid='fechar']";

export interface ElementoFalso {
  x: number;
  y: number;
  invisivel?: boolean;
  coberto?: string;
}

/** Página simulada: responde aos comandos de CDP que o runner usa. */
export function criarPagina(transporte: TransporteFalso) {
  const elementos = new Map<string, ElementoFalso>([
    [ABRIR, { x: 100, y: 40 }],
    [FECHAR, { x: 200, y: 40 }],
  ]);
  const pagina = {
    elementos,
    /** Chamado a cada comando, antes da resposta. */
    aoComando: null as ((metodo: string, parametros: Record<string, unknown>) => void) | null,
    erroDeNavegacao: null as string | null,
    carregarAoNavegar: true,
    /** O que a limpeza de storage feita na página devolve: `false` se a aba saiu da origem do cenário. */
    limpezaNaPagina: true,
    /** O que `Performance.getMetrics` e `DOM.getDetachedDomNodes` devolvem. */
    memoria: { heap: 1_000_000, nos: 50, listeners: 10, desanexados: 0 },
    /** Objetos "vivos" da página: é sobre eles que a função do censo roda de verdade. */
    objetos: [new Item(), new Item(), new Item(), new Painel(), [1, 2], {}, () => undefined] as unknown[],
    /** Exceção que a página lança durante a contagem do censo. */
    erroNoCenso: null as string | null,
    /** Quando `true`, a contagem do censo nunca responde. */
    censoTravado: false,
    /** O trace do perfil de CPU, como o navegador o entrega depois de `Tracing.end`. */
    trace: {
      /** Um `Tracing.dataCollected` por item. */
      entregas: [] as unknown[][],
      /** Erro de `Tracing.start`. */
      erroAoIniciar: null as string | null,
      perda: false,
      /** Com `false`, `Tracing.tracingComplete` nunca chega. */
      completar: true,
      /** Relógio do trace, em µs: avança 1000 a cada `Performance.getMetrics`. */
      instante: 0,
      aberto: false,
    },
  };
  const seletorDe = (expressao: string): string => JSON.parse(/querySelector\(("(?:[^"\\]|\\.)*")\)/.exec(expressao)![1]!) as string;

  transporte.responder = (metodo, parametros) => {
    const p = (parametros ?? {}) as Record<string, unknown>;
    pagina.aoComando?.(metodo, p);
    if (metodo === 'Page.navigate') {
      if (pagina.erroDeNavegacao) return { errorText: pagina.erroDeNavegacao };
      if (pagina.carregarAoNavegar) queueMicrotask(() => transporte.emitir(ABA, 'Page.loadEventFired'));
      return { frameId: 'F', loaderId: 'L' };
    }
    if (metodo === 'Browser.getVersion') return { product: 'Chrome/158.0.8127.18' };
    if (metodo === 'Tracing.start') {
      if (pagina.trace.erroAoIniciar) throw new Error(pagina.trace.erroAoIniciar);
      if (pagina.trace.aberto) throw new Error('{"code":-32000,"message":"Tracing has already been started (possibly in another tab)."}');
      pagina.trace.aberto = true;
      return {};
    }
    if (metodo === 'Tracing.end') {
      if (!pagina.trace.aberto) throw new Error('{"code":-32000,"message":"Tracing is not started"}');
      pagina.trace.aberto = false;
      queueMicrotask(() => {
        for (const value of pagina.trace.entregas) transporte.emitir(ABA, 'Tracing.dataCollected', { value });
        if (pagina.trace.completar) transporte.emitir(ABA, 'Tracing.tracingComplete', { dataLossOccurred: pagina.trace.perda });
      });
      return {};
    }
    if (metodo === 'Performance.getMetrics') {
      pagina.trace.instante += 1000;
      return {
        metrics: [
          { name: 'Timestamp', value: pagina.trace.instante / 1_000_000 },
          { name: 'JSEventListeners', value: pagina.memoria.listeners },
          { name: 'Nodes', value: pagina.memoria.nos },
          { name: 'JSHeapUsedSize', value: pagina.memoria.heap },
        ],
      };
    }
    if (metodo === 'DOM.getDetachedDomNodes') {
      // Uma árvore por nó, como o navegador devolve: `treeNode` é a raiz, com os descendentes.
      return {
        detachedNodes: Array.from({ length: pagina.memoria.desanexados }, (_, i) => ({ treeNode: { nodeId: i + 1, nodeName: 'LI' }, retainedNodeIds: [] })),
      };
    }
    if (metodo === 'Runtime.queryObjects') return { objects: { objectId: 'lista' } };
    if (metodo === 'Runtime.callFunctionOn') {
      if (pagina.censoTravado) return new Promise(() => undefined);
      if (pagina.erroNoCenso) return { exceptionDetails: { text: 'Uncaught', exception: { description: pagina.erroNoCenso } } };
      const limite = (p['arguments'] as { value: number }[])[0]!.value;
      return { result: { value: contarPorConstrutor.call(pagina.objetos, limite) } };
    }
    if (metodo !== 'Runtime.evaluate') return {};

    const expressao = String(p['expression']);
    if (expressao === 'Object.prototype') return { result: { objectId: 'prototipo' } };
    if (expressao.includes('navigator.userAgent')) {
      return { result: { value: { ua: 'Mozilla/5.0 Chrome/158.0.0.0 Safari/537.36', largura: 1280, altura: 720, dpr: 2 } } };
    }
    if (expressao.includes('innerWidth / 2')) return { result: { value: { x: 640, y: 360 } } };
    // Limpeza de `localStorage` ou `sessionStorage` na página: `true` se a página é da origem pedida.
    if (expressao.includes('.clear()')) return { result: { value: pagina.limpezaNaPagina } };
    const seletor = seletorDe(expressao);
    if (seletor.startsWith('!!')) return { exceptionDetails: { text: 'Uncaught', exception: { description: `SyntaxError: '${seletor}' is not a valid selector` } } };
    const elemento = elementos.get(seletor);
    if (expressao.includes('scrollIntoView')) {
      if (!elemento) return { result: { value: { estado: 'ausente' } } };
      if (elemento.invisivel) return { result: { value: { estado: 'invisivel' } } };
      return { result: { value: { estado: 'ok', x: elemento.x, y: elemento.y, coberto: elemento.coberto ?? null } } };
    }
    if (expressao.includes('.focus()')) return { result: { value: elemento !== undefined } };
    return { result: { value: elemento !== undefined } };
  };
  return pagina;
}

/**
 * Um `Tracing.dataCollected` com um perfil de CPU pequeno: cada item é uma amostra
 * de `delta` µs com a função `nome` no topo da pilha. O perfil começa no instante 0
 * do relógio do trace.
 */
export function entregaDePerfil(amostras: readonly { nome: string; delta: number }[]): unknown[] {
  const nomes = [...new Set(amostras.map((a) => a.nome))];
  const nos = [
    { id: 1, callFrame: { functionName: '(root)', scriptId: 0 } },
    ...nomes.map((nome, i) => ({
      id: i + 2,
      parent: 1,
      callFrame: nome.startsWith('(')
        ? { functionName: nome, scriptId: 0 }
        : { functionName: nome, url: 'http://localhost:4300/app.js', lineNumber: i * 10, columnNumber: 2, scriptId: 4 },
    })),
  ];
  return [
    { name: 'Profile', id: '0x1', pid: 9, ts: 0, args: { data: { startTime: 0 } } },
    {
      name: 'ProfileChunk',
      id: '0x1',
      pid: 9,
      args: { data: { cpuProfile: { nodes: nos, samples: amostras.map((a) => nomes.indexOf(a.nome) + 2) }, timeDeltas: amostras.map((a) => a.delta) } },
    },
  ];
}

/** Repositório em memória, com o registro de cada gravação na ordem em que foi feita. */
export interface RepositorioFalso extends RepositorioResultados {
  /** Cópia do que cada `gravar` recebeu. */
  gravacoes: ExecucaoGuardada[];
  guardadas: Map<string, ExecucaoGuardada>;
}

export function criarRepositorioFalso(): RepositorioFalso {
  const guardadas = new Map<string, ExecucaoGuardada>();
  const repositorio: RepositorioFalso = {
    gravacoes: [],
    guardadas,
    async gravar(registro, dados) {
      // Como o IndexedDB: o que entra é uma cópia, e mudanças posteriores no objeto não a afetam.
      const copia = structuredClone({ registro, dados });
      repositorio.gravacoes.push(copia);
      guardadas.set(registro.id, copia);
    },
    ler: async (id) => structuredClone(guardadas.get(id) ?? null),
    listar: async (filtro) =>
      [...guardadas.values()]
        .map((g) => structuredClone(g.registro))
        .filter((r) => filtro?.grupo === undefined || r.grupo === filtro.grupo)
        .sort((a, b) => b.inicio - a.inicio),
    emAndamento: async () => (await repositorio.listar()).filter((r) => r.estado === 'em-andamento'),
    remover: async (id) => void guardadas.delete(id),
    tamanhoTotal: async () => (await repositorio.listar()).reduce((total, r) => total + r.tamanho, 0),
    async aplicarRetencao(retencao, agora) {
      const ids = idsARemover(await repositorio.listar(), retencao, agora);
      ids.forEach((id) => guardadas.delete(id));
      return ids;
    },
  };
  return repositorio;
}
