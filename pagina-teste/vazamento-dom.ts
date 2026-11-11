// Caso de vazamento: nós removidos do documento continuam referenciados por um array global.
import { areaDoComponente, criarComponente, iniciarEstado, ligarBotoes } from './comum.ts';

const estado = iniciarEstado();
// Vazamento proposital: este array nunca é esvaziado.
const nosRetidos: HTMLElement[] = [];
window.nosRetidos = nosRetidos;
let componenteAberto: HTMLElement | null = null;

function abrir(): void {
  if (componenteAberto) return;
  componenteAberto = criarComponente(estado.ciclos + 1);
  areaDoComponente().append(componenteAberto);
}

function fechar(): void {
  if (!componenteAberto) return;
  componenteAberto.remove();
  nosRetidos.push(componenteAberto);
  componenteAberto = null;
  estado.ciclos++;
}

ligarBotoes(abrir, fechar);
