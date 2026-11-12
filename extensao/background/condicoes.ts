/**
 * Condições de teste pelo CDP: throttling de CPU e de rede, cache desligado e as
 * limpezas feitas antes da execução. Sem `chrome.*`: a conexão chega por parâmetro.
 *
 * A limpeza padrão nunca toca nos dados de sessão do usuário: só o cache HTTP e o
 * Cache Storage da origem. Cookies e os outros tipos de storage só saem por
 * `limparStorage`, que exige um `TiposConfirmados`.
 */
import type { TipoStorage } from '../shared/cenario.ts';
import type { TiposConfirmados } from '../shared/limpeza-storage.ts';
import type { CondicoesDeTeste } from '../shared/types.ts';
import type { ConexaoCdp } from './cdp.ts';
import type { Efeito } from './efeitos.ts';

type Envio = Pick<ConexaoCdp, 'enviar'>;

/**
 * Todo comando de CDP usado aqui. `testes/extensao/condicoes.spec.ts` envia cada um
 * pelo `chrome.debugger` real: o transporte falso dos testes unitários aceita qualquer coisa.
 */
export const COMANDOS_DE_CONDICOES: readonly string[] = [
  'Emulation.setCPUThrottlingRate',
  'Network.emulateNetworkConditions',
  'Network.setCacheDisabled',
  'Network.clearBrowserCache',
  'Storage.clearDataForOrigin',
];

/** Taxa em kbps para bytes por segundo; `null` (sem limite) vira -1, como o CDP espera. */
function bytesPorSegundo(kbps: number | null): number {
  return kbps === null ? -1 : (kbps * 1000) / 8;
}

/**
 * Efeitos das condições, na ordem de aplicação. `aplicar` e `desfazer` usam envios
 * diferentes: a aplicação pode ser solta por um cancelamento, mas a restauração
 * tem de chegar ao navegador mesmo depois dele.
 */
export function efeitosDasCondicoes(condicoes: CondicoesDeTeste, aplicar: Envio, desfazer: Envio = aplicar): Efeito[] {
  const efeitos: Efeito[] = [];
  if (condicoes.cpu !== 1) {
    efeitos.push({
      nome: 'throttling de CPU',
      aplicar: () => aplicar.enviar('Emulation.setCPUThrottlingRate', { rate: condicoes.cpu }),
      desfazer: () => desfazer.enviar('Emulation.setCPUThrottlingRate', { rate: 1 }),
    });
  }
  const rede = condicoes.rede;
  if (rede) {
    efeitos.push({
      nome: 'throttling de rede',
      aplicar: () =>
        aplicar.enviar('Network.emulateNetworkConditions', {
          offline: false,
          latency: rede.latenciaMs,
          downloadThroughput: bytesPorSegundo(rede.downloadKbps),
          uploadThroughput: bytesPorSegundo(rede.uploadKbps),
        }),
      desfazer: () =>
        desfazer.enviar('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }),
    });
  }
  if (condicoes.cacheDesligado) {
    efeitos.push({
      nome: 'cache desligado',
      aplicar: () => aplicar.enviar('Network.setCacheDisabled', { cacheDisabled: true }),
      desfazer: () => desfazer.enviar('Network.setCacheDisabled', { cacheDisabled: false }),
    });
  }
  return efeitos;
}

/** Origem (`https://exemplo.com`) de uma URL http(s). */
export function origemDe(url: string): string {
  return new URL(url).origin;
}

/**
 * Limpeza feita antes de toda execução de cenário: o cache HTTP do navegador e o
 * Cache Storage da origem. Não aceita outros tipos, de propósito.
 */
export async function limparCache(cdp: Envio, origem: string): Promise<void> {
  await cdp.enviar('Network.clearBrowserCache');
  await cdp.enviar('Storage.clearDataForOrigin', { origin: origem, storageTypes: 'cache_storage' });
}

/**
 * Tipos apagados pelo domínio `Storage` do CDP. O `localStorage` e o `sessionStorage`
 * ficam de fora de propósito: no Chrome, `Storage.clearDataForOrigin` com
 * `local_storage` apaga também o `sessionStorage` da aba, que o usuário não
 * confirmou. Os dois são limpos na página, um de cada vez.
 */
const TIPO_NO_CDP: Readonly<Partial<Record<TipoStorage, string>>> = {
  cookies: 'cookies',
  indexeddb: 'indexeddb',
  cache_storage: 'cache_storage',
};

const OBJETO_NA_PAGINA: Readonly<Partial<Record<TipoStorage, string>>> = {
  local_storage: 'localStorage',
  session_storage: 'sessionStorage',
};

/**
 * Expressão que limpa o storage na página carregada, e só se ela for da origem do
 * cenário (a URL inicial pode ter redirecionado para outro lugar). Devolve `true` se limpou.
 */
function expressaoLimpar(objeto: string, origem: string): string {
  return `(() => { if (location.origin !== ${JSON.stringify(origem)}) return false; ${objeto}.clear(); return true; })()`;
}

/**
 * Apaga da origem os tipos de storage confirmados pelo usuário, e só eles. Devolve
 * as expressões que ainda têm de rodar na página da origem, depois de carregada
 * (`localStorage` e `sessionStorage`); cada uma devolve `false` se não pôde limpar.
 */
export async function limparStorage(cdp: Envio, origem: string, confirmados: TiposConfirmados): Promise<string[]> {
  const noCdp = confirmados.flatMap((tipo) => TIPO_NO_CDP[tipo] ?? []);
  if (noCdp.length > 0) await cdp.enviar('Storage.clearDataForOrigin', { origin: origem, storageTypes: noCdp.join(',') });
  return confirmados.flatMap((tipo) => (OBJETO_NA_PAGINA[tipo] ? [expressaoLimpar(OBJETO_NA_PAGINA[tipo], origem)] : []));
}
