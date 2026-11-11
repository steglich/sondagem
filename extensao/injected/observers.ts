/**
 * Coleta de long tasks e de interações na página testada, com acúmulo em memória.
 * Quem envia os registros é o emissor de lotes (`lotes.ts`).
 *
 * Este arquivo nunca pode depender do framework de interface.
 */
import { ALVO_DESCONHECIDO, type Coletor, type Interacao, type LongTask } from '../shared/types.ts';

/** Interações mais curtas que isto não são entregues pelo navegador. */
export const LIMIAR_INTERACAO_MS = 40;

export interface OpcoesColeta {
  coletores: readonly Coletor[];
  /** Construtor de `PerformanceObserver` (o rastreado, na página; um simulado, nos testes). */
  Observador: typeof PerformanceObserver;
  /** `performance.timeOrigin` do documento, para converter `startTime` em instante absoluto. */
  origemTempo: number;
  /** Identificador do documento, gravado em cada interação. */
  documento: string;
}

export interface Coleta {
  /** Devolve o que foi acumulado desde a última chamada e esvazia o acúmulo. */
  drenar(): { longTasks: LongTask[]; interacoes: Interacao[] };
  /** Desconecta os observadores desta coleta. */
  parar(): void;
}

/** Campos do Event Timing que os tipos do DOM ainda não trazem por completo. */
interface EntradaDeEvento extends PerformanceEntry {
  interactionId?: number;
  target?: unknown;
}

interface ElementoDescritivel {
  tagName: string;
  id?: string;
  className?: unknown;
  getAttribute?: (nome: string) => string | null;
}

/** Descrição curta do alvo de uma interação: tag com `data-testid`, `id` ou classes. */
export function descreverAlvo(alvo: unknown): string {
  const elemento = alvo as ElementoDescritivel | null | undefined;
  if (!elemento || typeof elemento.tagName !== 'string') return ALVO_DESCONHECIDO;
  const tag = elemento.tagName.toLowerCase();
  const idTeste = elemento.getAttribute?.('data-testid');
  if (idTeste) return `${tag}[data-testid="${idTeste}"]`;
  if (elemento.id) return `${tag}#${elemento.id}`;
  const classes = typeof elemento.className === 'string' ? elemento.className.split(/\s+/).filter(Boolean) : [];
  return classes.length ? `${tag}.${classes.slice(0, 2).join('.')}` : tag;
}

export function criarColeta(opcoes: OpcoesColeta): Coleta {
  const { coletores, Observador, origemTempo, documento } = opcoes;
  let longTasks: LongTask[] = [];
  /** Uma interação gera vários eventos (pointerdown, pointerup, click): fica o mais demorado. */
  let interacoes = new Map<number, Interacao>();
  const observadores: PerformanceObserver[] = [];

  function observar(opcoesDoTipo: PerformanceObserverInit, aoReceber: (entrada: PerformanceEntry) => void): void {
    try {
      const observador = new Observador((lista) => lista.getEntries().forEach(aoReceber));
      observador.observe(opcoesDoTipo);
      observadores.push(observador);
    } catch {
      // Tipo de entrada não suportado neste navegador: a verificação fica sem registros.
    }
  }

  // Sem `buffered`: o que aconteceu antes do início da análise não pertence a ela.
  if (coletores.includes('long-tasks')) {
    observar({ type: 'longtask' }, (entrada) => {
      longTasks.push({ inicio: origemTempo + entrada.startTime, duracao: entrada.duration });
    });
  }

  if (coletores.includes('interacoes')) {
    observar({ type: 'event', durationThreshold: LIMIAR_INTERACAO_MS } as PerformanceObserverInit, (entrada) => {
      const evento = entrada as EntradaDeEvento;
      const id = evento.interactionId;
      // Eventos sem interactionId não são interações do usuário (ex.: mouseover).
      if (!id) return;
      const anterior = interacoes.get(id);
      if (anterior && anterior.duracao >= evento.duration) {
        // Mesmo sem ser o mais demorado, este evento pode trazer o alvo que faltava: em cliques
        // rápidos o navegador entrega o pointerdown sem alvo e o click, de mesma duração, com ele.
        if (anterior.alvo === ALVO_DESCONHECIDO && evento.target) anterior.alvo = descreverAlvo(evento.target);
        return;
      }
      interacoes.set(id, {
        id,
        documento,
        inicio: origemTempo + evento.startTime,
        duracao: evento.duration,
        tipo: evento.name,
        alvo: evento.target ? descreverAlvo(evento.target) : (anterior?.alvo ?? descreverAlvo(null)),
      });
    });
  }

  return {
    drenar() {
      const lote = { longTasks, interacoes: [...interacoes.values()] };
      longTasks = [];
      interacoes = new Map();
      return lote;
    },
    parar() {
      for (const observador of observadores.splice(0)) observador.disconnect();
    },
  };
}
