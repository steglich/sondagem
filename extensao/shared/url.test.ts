import { describe, expect, it } from 'vitest';
import { avaliarUrl } from './url.ts';

describe('avaliarUrl', () => {
  it('aceita http e https e devolve o padrão do host, sem porta', () => {
    expect(avaliarUrl('http://localhost:4300/cpu-pesada')).toEqual({ suportada: true, padrao: 'http://localhost/*' });
    expect(avaliarUrl('https://app.exemplo.com/a?b=1#c')).toEqual({
      suportada: true,
      padrao: 'https://app.exemplo.com/*',
    });
  });

  it.each([
    'chrome://extensions',
    'chrome-extension://abc/index.html',
    'about:blank',
    'file:///tmp/pagina.html',
    'devtools://devtools/bundled/inspector.html',
  ])('recusa %s', (url) => {
    const avaliacao = avaliarUrl(url);
    expect(avaliacao.suportada).toBe(false);
  });

  it('recusa a loja de extensões', () => {
    expect(avaliarUrl('https://chromewebstore.google.com/detail/x').suportada).toBe(false);
  });

  it('recusa aba sem URL ou com endereço inválido, com motivo', () => {
    expect(avaliarUrl(undefined)).toEqual({ suportada: false, motivo: expect.any(String) });
    expect(avaliarUrl('não é url')).toEqual({ suportada: false, motivo: expect.any(String) });
  });
});
