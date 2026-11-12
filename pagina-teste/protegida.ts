// Página atrás do login simulado. Abrir e fechar se comportam como no caso de
// controle (/limpa); a diferença é a sessão, que pode expirar no meio do uso.
import { areaDoComponente, criarComponente, iniciarEstado, ligarBotoes } from './comum.ts';
import { CHAVE_PREFERENCIA, COOKIE_SESSAO } from './sessao.ts';

const estado = iniciarEstado();
let aberto: HTMLElement | null = null;

/** Ciclo em que a sessão expira, ou `null` se não expira. */
const expira = Number(new URLSearchParams(location.search).get('expira')) || null;

function encerrarSessao(): void {
  document.cookie = `${COOKIE_SESSAO}=; path=/; max-age=0`;
  // Sem o cookie, o servidor responde a esta mesma URL com o redirecionamento para o login.
  location.reload();
}

function abrir(): void {
  if (aberto) return;
  aberto = criarComponente(estado.ciclos + 1);
  areaDoComponente().append(aberto);
}

function fechar(): void {
  if (!aberto) return;
  aberto.remove();
  aberto = null;
  estado.ciclos++;
  if (expira !== null && estado.ciclos >= expira) encerrarSessao();
}

ligarBotoes(abrir, fechar);
document.querySelector('[data-testid="sair"]')?.addEventListener('click', encerrarSessao);

const usuario = document.querySelector<HTMLElement>('[data-testid="usuario-logado"]');
if (usuario) usuario.textContent = localStorage.getItem(CHAVE_PREFERENCIA) ?? '(sem preferência salva)';
