// Caso de controle: abrir e fechar não retém listeners, nós nem memória.
import { areaDoComponente, criarComponente, iniciarEstado, ligarBotoes } from './comum.ts';

const estado = iniciarEstado();
let aberto: { componente: HTMLElement; aoRedimensionar: () => void } | null = null;

function abrir(): void {
  if (aberto) return;
  const componente = criarComponente(estado.ciclos + 1);
  const aoRedimensionar = (): void => {
    componente.dataset['largura'] = String(window.innerWidth);
  };
  window.addEventListener('resize', aoRedimensionar);
  estado.listenersAtivos++;
  areaDoComponente().append(componente);
  aberto = { componente, aoRedimensionar };
}

function fechar(): void {
  if (!aberto) return;
  window.removeEventListener('resize', aberto.aoRedimensionar);
  estado.listenersAtivos--;
  aberto.componente.remove();
  aberto = null;
  estado.ciclos++;
}

ligarBotoes(abrir, fechar);
