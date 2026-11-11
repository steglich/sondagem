// Caso de erros: uma exceção não tratada e uma promise rejeitada sem tratamento.
// Nenhum dos dois é capturado pela página, de propósito.
import { iniciarEstado } from './comum.ts';

iniciarEstado();
const estado = { excecoes: 0, rejeicoes: 0 };
window.errosProduzidos = estado;

function atualizarContador(): void {
  const contador = document.querySelector('[data-testid="contador-erros"]');
  if (contador) contador.textContent = String(estado.excecoes + estado.rejeicoes);
}

function lancarExcecao(): void {
  estado.excecoes++;
  atualizarContador();
  throw new Error(`Exceção de teste ${estado.excecoes}`);
}

function rejeitarPromise(): void {
  estado.rejeicoes++;
  atualizarContador();
  void Promise.reject(new Error(`Rejeição de teste ${estado.rejeicoes}`));
}

document.querySelector('[data-testid="lancar-excecao"]')?.addEventListener('click', lancarExcecao);
document.querySelector('[data-testid="rejeitar-promise"]')?.addEventListener('click', rejeitarPromise);
