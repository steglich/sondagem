/**
 * Ponto de entrada do bundle injetado na página testada (`injected.js`). Roda no
 * mundo isolado, só durante uma sessão: é injetado pelo service worker no início
 * e registrado como content script dinâmico até o fim dela.
 *
 * Não altera o DOM, os estilos nem o objeto global da página.
 */
import { NOME_PORTA_PAGINA } from '../shared/types.ts';
import { instalarObservadores } from './instalacao.ts';
import type { EscopoRastreavel } from './rastreador.ts';
import { type PortaPagina, iniciarNaPagina } from './sessao-pagina.ts';
import { instalarVitals } from './vitals.ts';

iniciarNaPagina({
  conectar() {
    const porta = chrome.runtime.connect({ name: NOME_PORTA_PAGINA });
    // Ler lastError evita o aviso "Unchecked runtime.lastError" quando o service worker recusa a porta.
    porta.onDisconnect.addListener(() => void chrome.runtime.lastError);
    return porta as PortaPagina;
  },
  instalar: (selecao) =>
    instalarObservadores(selecao, {
      escopo: globalThis as unknown as EscopoRastreavel,
      origemTempo: performance.timeOrigin,
      urlAtual: () => location.href,
      instalarVitals,
    }),
  aoSair: (ouvinte) => addEventListener('pagehide', ouvinte),
});
