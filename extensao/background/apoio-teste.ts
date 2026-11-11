/** Transporte de CDP, relógio e página simulados para os testes unitários do service worker. */
import type { MotivoDesconexao } from '../shared/types.ts';
import type { TransporteCdp } from './cdp.ts';
import { GRUPO_COLETA, contarPorConstrutor } from './memoria.ts';

/** `true` se o comando é a consulta que força a coleta de lixo (passo `forcar_gc`). */
export function ehColeta(metodo: string, parametros: Record<string, unknown> | object | undefined): boolean {
  return metodo === 'Runtime.queryObjects' && (parametros as Record<string, unknown> | undefined)?.['objectGroup'] === GRUPO_COLETA;
}

/** Comandos de CDP que só a medição de memória envia. */
export const DE_MEMORIA = /^(Performance|DOM)\.|^Runtime\.(queryObjects|callFunctionOn|releaseObjectGroup)$/;

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
    /** O que `Performance.getMetrics` e `DOM.getDetachedDomNodes` devolvem. */
    memoria: { heap: 1_000_000, nos: 50, listeners: 10, desanexados: 0 },
    /** Objetos "vivos" da página: é sobre eles que a função do censo roda de verdade. */
    objetos: [new Item(), new Item(), new Item(), new Painel(), [1, 2], {}, () => undefined] as unknown[],
    /** Exceção que a página lança durante a contagem do censo. */
    erroNoCenso: null as string | null,
    /** Quando `true`, a contagem do censo nunca responde. */
    censoTravado: false,
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
    if (metodo === 'Performance.getMetrics') {
      return {
        metrics: [
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
