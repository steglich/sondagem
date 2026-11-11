// Caso de CPU: um clique dispara uma função nomeada que bloqueia a thread principal
// por um tempo fixo. O nome calculoPesado é preservado (sem minificação) para ser
// reconhecido no perfil de CPU.
import { iniciarEstado } from './comum.ts';

/** Duração do bloqueio, acima do limite de 200 ms usado nas detecções. */
export const DURACAO_BLOQUEIO_MS = 300;

iniciarEstado();

export function calculoPesado(duracaoMs: number = DURACAO_BLOQUEIO_MS): number {
  const inicio = performance.now();
  let acumulado = 0;
  let i = 0;
  while (performance.now() - inicio < duracaoMs) {
    acumulado += Math.sqrt(i++) % 7;
  }
  return acumulado;
}

const botao = document.querySelector<HTMLButtonElement>('[data-testid="acao-pesada"]');
const saida = document.querySelector<HTMLOutputElement>('[data-testid="resultado-pesado"]');
botao?.addEventListener('click', () => {
  const resultado = calculoPesado();
  if (saida) saida.value = resultado.toFixed(0);
});
