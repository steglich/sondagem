/**
 * Memória da última seleção de verificações, por contexto (a sessão manual ou,
 * a partir da fase 2, o nome de um cenário). Guarda apenas a seleção: nada da
 * página analisada nem de autenticação.
 */
import type { ContextoSelecao, Selecao } from '../shared/types.ts';
import { normalizarSelecao, selecaoPadrao } from '../shared/verificacoes.ts';

export const CHAVE_SELECOES = 'sondagem:selecoes';

/** O que este módulo usa de `chrome.storage.local`. */
export interface Armazenamento {
  get(chave: string): Promise<Record<string, unknown>>;
  set(itens: Record<string, unknown>): Promise<void>;
}

async function lerTodas(armazenamento: Armazenamento): Promise<Record<string, unknown>> {
  const guardado = (await armazenamento.get(CHAVE_SELECOES))[CHAVE_SELECOES];
  return guardado && typeof guardado === 'object' ? { ...(guardado as Record<string, unknown>) } : {};
}

/** Última seleção do contexto. Sem nada salvo (ou com dado inválido), tudo marcado. */
export async function lerSelecao(armazenamento: Armazenamento, contexto: ContextoSelecao): Promise<Selecao> {
  const todas = await lerTodas(armazenamento);
  if (!Object.hasOwn(todas, contexto) || !Array.isArray(todas[contexto])) return selecaoPadrao();
  return normalizarSelecao(todas[contexto]);
}

export async function salvarSelecao(
  armazenamento: Armazenamento,
  contexto: ContextoSelecao,
  selecao: Selecao,
): Promise<void> {
  const todas = await lerTodas(armazenamento);
  todas[contexto] = normalizarSelecao(selecao);
  await armazenamento.set({ [CHAVE_SELECOES]: todas });
}
