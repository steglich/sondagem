/**
 * Preferências de armazenamento do histórico (limites, retenção e limite de
 * variação), em `chrome.storage.local`. Os resultados ficam no repositório.
 */
import { type ConfiguracaoArmazenamento, normalizarConfiguracao } from '../shared/historico.ts';
import type { Armazenamento } from './selecao.ts';

export const CHAVE_CONFIGURACAO = 'sondagem:armazenamento';

/** Sem nada salvo (ou com valor inválido), valem os padrões. */
export async function lerConfiguracao(armazenamento: Armazenamento): Promise<ConfiguracaoArmazenamento> {
  return normalizarConfiguracao((await armazenamento.get(CHAVE_CONFIGURACAO))[CHAVE_CONFIGURACAO]);
}

export async function salvarConfiguracao(armazenamento: Armazenamento, configuracao: ConfiguracaoArmazenamento): Promise<void> {
  await armazenamento.set({ [CHAVE_CONFIGURACAO]: normalizarConfiguracao(configuracao) });
}
