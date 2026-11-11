import { INTERVALO_LOTE_MS, type Lote } from '../shared/types.ts';

export interface OpcoesEmissor {
  /** Recolhe o que foi acumulado desde o lote anterior. */
  drenar: () => Lote;
  enviar: (lote: Lote) => void;
  intervaloMs?: number;
}

export interface Emissor {
  /** Cancela o temporizador. Não envia o que estiver acumulado. */
  parar(): void;
}

/**
 * Envia um lote por intervalo com tudo o que foi acumulado, nunca um evento por
 * mensagem. O lote sai mesmo vazio: a mensagem periódica mantém o service worker
 * acordado enquanto a sessão dura.
 */
export function criarEmissor(opcoes: OpcoesEmissor): Emissor {
  const temporizador = setInterval(() => opcoes.enviar(opcoes.drenar()), opcoes.intervaloMs ?? INTERVALO_LOTE_MS);
  return {
    parar: () => clearInterval(temporizador),
  };
}
