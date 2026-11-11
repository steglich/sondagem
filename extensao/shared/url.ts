export type AvaliacaoUrl =
  | { suportada: true; /** Padrão de correspondência para registrar o content script. */ padrao: string }
  | { suportada: false; motivo: string };

/** Páginas da loja de extensões não aceitam injeção de scripts. */
const LOJAS = [/^chromewebstore\.google\.com$/, /^chrome\.google\.com$/];

/**
 * Diz se a extensão consegue injetar os observadores na URL. Só páginas http(s)
 * são aceitas: `chrome://`, páginas de extensões, a Web Store e arquivos locais ficam de fora.
 */
export function avaliarUrl(url: string | undefined | null): AvaliacaoUrl {
  if (!url) return { suportada: false, motivo: 'Não foi possível identificar a aba a analisar.' };

  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    return { suportada: false, motivo: `Endereço inválido: ${url}` };
  }

  if (destino.protocol !== 'http:' && destino.protocol !== 'https:') {
    return {
      suportada: false,
      motivo: `Páginas ${destino.protocol}// não podem ser analisadas. Abra uma página http ou https.`,
    };
  }
  if (LOJAS.some((loja) => loja.test(destino.hostname))) {
    return { suportada: false, motivo: 'O Chrome não permite analisar a loja de extensões.' };
  }

  // Padrões de correspondência não levam porta: o padrão cobre o host inteiro.
  return { suportada: true, padrao: `${destino.protocol}//${destino.hostname}/*` };
}
