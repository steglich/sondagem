export interface Limitador {
  /** Executa agora se o intervalo já passou; senão agenda uma única execução para o fim do intervalo. */
  solicitar(): void;
  /** Executa já, descartando o que estava agendado (para mudanças que não podem esperar). */
  imediato(): void;
  /** Cancela a execução agendada. Devolve `true` se havia um temporizador pendente. */
  cancelar(): boolean;
}

/**
 * Limita `acao` a no máximo uma execução por `intervaloMs`. Pedidos feitos dentro
 * do intervalo são fundidos em uma execução ao final dele, para que o último
 * estado nunca se perca.
 */
export function criarLimitador(intervaloMs: number, acao: () => void, agora: () => number = Date.now): Limitador {
  let ultima = Number.NEGATIVE_INFINITY;
  let temporizador: ReturnType<typeof setTimeout> | null = null;

  function executar(): void {
    temporizador = null;
    ultima = agora();
    acao();
  }

  function cancelar(): boolean {
    if (temporizador === null) return false;
    clearTimeout(temporizador);
    temporizador = null;
    return true;
  }

  return {
    solicitar() {
      if (temporizador !== null) return;
      const espera = ultima + intervaloMs - agora();
      if (espera <= 0) executar();
      else temporizador = setTimeout(executar, espera);
    },
    imediato() {
      cancelar();
      executar();
    },
    cancelar,
  };
}
