/** `PerformanceObserver` simulado para os testes unitários do código injetado. */

export interface ObservadorSimulado {
  opcoes: PerformanceObserverInit[];
  conectado: boolean;
  /** Entrega entradas ao callback, como o navegador faria. */
  emitir(entradas: Partial<PerformanceEntry & { interactionId: number; target: unknown }>[]): void;
}

export interface FabricaSimulada {
  Observador: typeof PerformanceObserver;
  criados: ObservadorSimulado[];
  /** Observadores ainda conectados que observam o tipo dado. */
  doTipo(tipo: string): ObservadorSimulado[];
  /** Tipos observados por observadores ainda conectados. */
  tiposAtivos(): string[];
}

export function criarObservadorSimulado(): FabricaSimulada {
  const criados: ObservadorSimulado[] = [];

  class Simulado implements ObservadorSimulado {
    static readonly supportedEntryTypes = ['longtask', 'event'];
    opcoes: PerformanceObserverInit[] = [];
    conectado = false;
    readonly #callback: PerformanceObserverCallback;

    constructor(callback: PerformanceObserverCallback) {
      this.#callback = callback;
      criados.push(this);
    }
    observe(opcoes: PerformanceObserverInit = {}): void {
      this.opcoes.push(opcoes);
      this.conectado = true;
    }
    disconnect(): void {
      this.conectado = false;
    }
    takeRecords(): PerformanceEntryList {
      return [];
    }
    emitir(entradas: Partial<PerformanceEntry>[]): void {
      if (!this.conectado) return;
      const lista = { getEntries: () => entradas } as unknown as PerformanceObserverEntryList;
      this.#callback(lista, this as unknown as PerformanceObserver);
    }
  }

  const doTipo = (tipo: string): ObservadorSimulado[] =>
    criados.filter((o) => o.conectado && o.opcoes.some((opcoes) => opcoes.type === tipo));

  return {
    Observador: Simulado as unknown as typeof PerformanceObserver,
    criados,
    doTipo,
    tiposAtivos: () => [
      ...new Set(criados.filter((o) => o.conectado).flatMap((o) => o.opcoes.map((opcoes) => opcoes.type ?? ''))),
    ],
  };
}

/** Alvo de eventos simulado, que registra os listeners ativos. */
export function criarAlvoSimulado() {
  const ativos: { tipo: string; ouvinte: unknown; captura: boolean }[] = [];
  const captura = (opcoes: unknown): boolean =>
    typeof opcoes === 'boolean' ? opcoes : Boolean((opcoes as { capture?: boolean } | undefined)?.capture);

  class Alvo {
    addEventListener(tipo: string, ouvinte: unknown, opcoes?: unknown): void {
      ativos.push({ tipo, ouvinte, captura: captura(opcoes) });
    }
    removeEventListener(tipo: string, ouvinte: unknown, opcoes?: unknown): void {
      const i = ativos.findIndex((a) => a.tipo === tipo && a.ouvinte === ouvinte && a.captura === captura(opcoes));
      if (i !== -1) ativos.splice(i, 1);
    }
  }
  return { Alvo, ativos };
}
