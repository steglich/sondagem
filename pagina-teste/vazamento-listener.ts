// Caso de vazamento: cada abertura registra um listener global que nunca é removido.
// O listener captura um array de dados do ciclo, que fica retido junto com ele.
import { areaDoComponente, criarComponente, iniciarEstado, ligarBotoes } from './comum.ts';

const estado = iniciarEstado();
let componenteAberto: HTMLElement | null = null;

function abrir(): void {
  if (componenteAberto) return;
  const ciclo = estado.ciclos + 1;
  const componente = criarComponente(ciclo);
  const dadosDoCiclo = new Array<number>(10_000).fill(ciclo);
  // Vazamento proposital: este listener nunca é removido.
  window.addEventListener('resize', () => {
    console.debug('resize no ciclo', ciclo, dadosDoCiclo.length);
  });
  estado.listenersAtivos++;
  areaDoComponente().append(componente);
  componenteAberto = componente;
}

function fechar(): void {
  if (!componenteAberto) return;
  componenteAberto.remove();
  componenteAberto = null;
  estado.ciclos++;
}

ligarBotoes(abrir, fechar);
