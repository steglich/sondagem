/**
 * Linha de base por cenário, em `chrome.storage.local`: a execução de referência e
 * os limites de regressão. Fica fora do IndexedDB porque é preferência do usuário,
 * não resultado. A retenção do histórico nunca remove as execuções listadas por
 * `idsDeReferencia`.
 */
import { type LinhaDeBase, normalizarLinhaDeBase } from '../shared/comparacao.ts';
import type { Armazenamento } from './selecao.ts';

export const CHAVE_LINHAS_DE_BASE = 'sondagem:linhas-de-base';

/** Todas as linhas de base, por nome de cenário. O que não é válido fica de fora. */
export async function lerLinhasDeBase(armazenamento: Armazenamento): Promise<Record<string, LinhaDeBase>> {
  const guardado = (await armazenamento.get(CHAVE_LINHAS_DE_BASE))[CHAVE_LINHAS_DE_BASE];
  const linhas: Record<string, LinhaDeBase> = {};
  if (!guardado || typeof guardado !== 'object') return linhas;
  for (const [cenario, valor] of Object.entries(guardado)) {
    const linha = normalizarLinhaDeBase(valor);
    if (linha) linhas[cenario] = linha;
  }
  return linhas;
}

export async function lerLinhaDeBase(armazenamento: Armazenamento, cenario: string): Promise<LinhaDeBase | null> {
  const linhas = await lerLinhasDeBase(armazenamento);
  return Object.hasOwn(linhas, cenario) ? linhas[cenario]! : null;
}

/** Marca (ou troca) a linha de base do cenário. Limite ausente vale o padrão. */
export async function definirLinhaDeBase(armazenamento: Armazenamento, cenario: string, linha: LinhaDeBase): Promise<void> {
  const normalizada = normalizarLinhaDeBase(linha);
  if (!normalizada) throw new Error('A linha de base precisa de uma execução de referência.');
  await armazenamento.set({ [CHAVE_LINHAS_DE_BASE]: { ...(await lerLinhasDeBase(armazenamento)), [cenario]: normalizada } });
}

export async function removerLinhaDeBase(armazenamento: Armazenamento, cenario: string): Promise<void> {
  const linhas = await lerLinhasDeBase(armazenamento);
  if (!Object.hasOwn(linhas, cenario)) return;
  delete linhas[cenario];
  await armazenamento.set({ [CHAVE_LINHAS_DE_BASE]: linhas });
}

/** Ids das execuções de referência de todos os cenários. */
export async function idsDeReferencia(armazenamento: Armazenamento): Promise<string[]> {
  return Object.values(await lerLinhasDeBase(armazenamento)).map((linha) => linha.id);
}
