/**
 * Utilitários compartilhados pelos casos da página de teste.
 *
 * Cada caso expõe `window.estadoTeste`, lido pelos testes automatizados para
 * conferir que o problema controlado aconteceu como esperado.
 */

export interface EstadoTeste {
  /** Ciclos de abrir e fechar concluídos. */
  ciclos: number;
  /** Listeners globais registrados pelo caso e ainda não removidos. */
  listenersAtivos: number;
}

declare global {
  interface Window {
    estadoTeste: EstadoTeste;
    nosRetidos?: HTMLElement[];
  }
}

/** Quantidade de itens de cada componente, para que o vazamento de nós seja visível. */
export const ITENS_POR_COMPONENTE = 200;

export function iniciarEstado(): EstadoTeste {
  window.estadoTeste = { ciclos: 0, listenersAtivos: 0 };
  return window.estadoTeste;
}

/** Cria um componente com uma lista de itens, sem anexá-lo ao documento. */
export function criarComponente(ciclo: number): HTMLElement {
  const componente = document.createElement('section');
  componente.className = 'componente';
  const titulo = document.createElement('h2');
  titulo.textContent = `Componente do ciclo ${ciclo}`;
  const lista = document.createElement('ul');
  for (let i = 0; i < ITENS_POR_COMPONENTE; i++) {
    const item = document.createElement('li');
    item.textContent = `Item ${i}`;
    lista.append(item);
  }
  componente.append(titulo, lista);
  return componente;
}

/** Liga os botões de abrir e fechar do caso. */
export function ligarBotoes(abrir: () => void, fechar: () => void): void {
  const botaoAbrir = document.querySelector<HTMLButtonElement>('[data-testid="abrir-componente"]');
  const botaoFechar = document.querySelector<HTMLButtonElement>('[data-testid="fechar-componente"]');
  if (!botaoAbrir || !botaoFechar) throw new Error('Botões de abrir e fechar não encontrados');
  botaoAbrir.addEventListener('click', abrir);
  botaoFechar.addEventListener('click', fechar);
}

export function areaDoComponente(): HTMLElement {
  const area = document.querySelector<HTMLElement>('#area');
  if (!area) throw new Error('#area não encontrada');
  return area;
}
