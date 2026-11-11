/**
 * Rastreia todo `PerformanceObserver` e todo listener criado no mundo isolado da
 * extensão, para que a limpeza consiga desligar tudo e dizer quantos eram.
 *
 * A `web-vitals` cria observadores e listeners e não oferece forma de removê-los.
 * Como o script roda no mundo isolado, `PerformanceObserver` e
 * `EventTarget.prototype` aqui são os da extensão, não os da página: trocá-los
 * não altera nada que a página enxergue.
 */

export interface EscopoRastreavel {
  PerformanceObserver: typeof PerformanceObserver;
  EventTarget: { prototype: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> };
}

export interface Rastreador {
  /** Volta a aceitar observadores e listeners (início de uma sessão). */
  ativar(): void;
  /** Desliga tudo o que foi criado, passa a ignorar novos pedidos e devolve as contagens. */
  desconectarTudo(): { observadores: number; listeners: number };
}

interface Registro {
  alvo: EventTarget;
  tipo: string;
  ouvinte: EventListenerOrEventListenerObject;
  captura: boolean;
  /** Remove o listener auxiliar que acompanha os registros `once`. */
  soltar?: () => void;
}

const CHAVE = Symbol.for('sondagem.rastreador');

function captura(opcoes: boolean | AddEventListenerOptions | EventListenerOptions | undefined): boolean {
  return typeof opcoes === 'boolean' ? opcoes : Boolean(opcoes?.capture);
}

/**
 * Instala o rastreador no escopo (uma única vez: injeções seguintes no mesmo
 * documento reaproveitam o que já está instalado) e o devolve ativo.
 */
export function obterRastreador(escopo: EscopoRastreavel): Rastreador {
  const guardado = escopo as EscopoRastreavel & { [CHAVE]?: Rastreador };
  const existente = guardado[CHAVE];
  if (existente) {
    existente.ativar();
    return existente;
  }

  let ativo = true;
  const observadores = new Set<PerformanceObserver>();
  const listeners: Registro[] = [];

  const Original = escopo.PerformanceObserver;
  class ObservadorRastreado extends Original {
    override observe(opcoes?: PerformanceObserverInit): void {
      if (!ativo) return;
      observadores.add(this);
      super.observe(opcoes);
    }
    override disconnect(): void {
      observadores.delete(this);
      super.disconnect();
    }
  }
  escopo.PerformanceObserver = ObservadorRastreado;

  const prototipo = escopo.EventTarget.prototype;
  const adicionar = prototipo.addEventListener;
  const remover = prototipo.removeEventListener;

  function indiceDe(alvo: EventTarget, tipo: string, ouvinte: unknown, comCaptura: boolean): number {
    return listeners.findIndex(
      (r) => r.alvo === alvo && r.tipo === tipo && r.ouvinte === ouvinte && r.captura === comCaptura,
    );
  }

  prototipo.addEventListener = function (
    this: EventTarget | undefined,
    tipo: string,
    ouvinte: EventListenerOrEventListenerObject | null,
    opcoes?: boolean | AddEventListenerOptions,
  ): void {
    // Chamadas sem receptor (`addEventListener(...)`) valem para o objeto global.
    const alvo = this ?? (escopo as unknown as EventTarget);
    if (!ativo || !ouvinte) return;
    const comCaptura = captura(opcoes);
    if (indiceDe(alvo, tipo, ouvinte, comCaptura) === -1) {
      const registro: Registro = { alvo, tipo, ouvinte, captura: comCaptura };
      if (typeof opcoes === 'object' && opcoes.once) {
        // Um listener `once` sai sozinho ao disparar: o auxiliar tira o registro junto.
        const esquecer = (): void => {
          const i = listeners.indexOf(registro);
          if (i !== -1) listeners.splice(i, 1);
        };
        adicionar.call(alvo, tipo, esquecer, { once: true, capture: comCaptura });
        registro.soltar = () => remover.call(alvo, tipo, esquecer, { capture: comCaptura });
      }
      listeners.push(registro);
    }
    adicionar.call(alvo, tipo, ouvinte, opcoes);
  };

  prototipo.removeEventListener = function (
    this: EventTarget | undefined,
    tipo: string,
    ouvinte: EventListenerOrEventListenerObject | null,
    opcoes?: boolean | EventListenerOptions,
  ): void {
    const alvo = this ?? (escopo as unknown as EventTarget);
    const i = indiceDe(alvo, tipo, ouvinte, captura(opcoes));
    if (i !== -1) {
      listeners[i]?.soltar?.();
      listeners.splice(i, 1);
    }
    remover.call(alvo, tipo, ouvinte, opcoes);
  };

  const rastreador: Rastreador = {
    ativar() {
      ativo = true;
    },
    desconectarTudo() {
      ativo = false;
      const contagem = { observadores: observadores.size, listeners: listeners.length };
      for (const observador of [...observadores]) observador.disconnect();
      for (const registro of listeners.splice(0)) {
        registro.soltar?.();
        remover.call(registro.alvo, registro.tipo, registro.ouvinte, { capture: registro.captura });
      }
      return contagem;
    },
  };
  guardado[CHAVE] = rastreador;
  return rastreador;
}
