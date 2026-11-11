/**
 * Service worker da Sondagem.
 *
 * Nesta fase ele só configura a abertura do side panel pelo ícone da extensão.
 * Não injeta código, não anexa o debugger e não inicia medições.
 */
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((erro: unknown) => console.error('Sondagem: falha ao configurar o side panel', erro));
