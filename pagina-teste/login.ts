// Login simulado: serve para conferir que a extensão não desloga o usuário e que
// percebe quando a aplicação pede o login de novo.
import { CHAVE_PREFERENCIA, COOKIE_SESSAO } from './sessao.ts';

const usuario = document.querySelector<HTMLInputElement>('[data-testid="campo-usuario"]');
const senha = document.querySelector<HTMLInputElement>('[data-testid="campo-senha"]');
const entrar = document.querySelector<HTMLButtonElement>('[data-testid="entrar"]');
const motivo = document.querySelector<HTMLElement>('[data-testid="motivo-login"]');
if (!usuario || !senha || !entrar || !motivo) throw new Error('Formulário de login não encontrado');

const parametros = new URLSearchParams(location.search);
if (parametros.has('voltar')) motivo.textContent = 'Você precisa entrar para ver a página protegida.';

entrar.addEventListener('click', () => {
  // Cookie de sessão (sem validade): some ao fechar o navegador, como o de uma aplicação real.
  document.cookie = `${COOKIE_SESSAO}=ativa; path=/`;
  localStorage.setItem(CHAVE_PREFERENCIA, usuario.value || 'anônimo');
  // Só caminhos da própria página de teste.
  const voltar = parametros.get('voltar');
  location.assign(voltar?.startsWith('/') && !voltar.startsWith('//') ? voltar : '/protegida');
});
