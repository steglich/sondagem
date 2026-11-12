/**
 * Limpeza de storage a pedido do cenário (`limpar_storage`).
 *
 * `TiposConfirmados` é o único argumento que a função de limpeza aceita, e só
 * `confirmarLimpeza` o produz: a partir do que o cenário declara e do que o usuário
 * marcou na confirmação específica. Sem a confirmação de todos os tipos declarados
 * não há valor desse tipo, e portanto não há como chamar a limpeza.
 */
import { type Cenario, type TipoStorage, storageAConfirmar } from './cenario.ts';

declare const MARCA: unique symbol;

/** Tipos de storage que o cenário declara e o usuário confirmou na tela. */
export type TiposConfirmados = readonly TipoStorage[] & { readonly [MARCA]: true };

export const NOMES_STORAGE: Readonly<Record<TipoStorage, string>> = {
  cookies: 'cookies',
  local_storage: 'localStorage',
  session_storage: 'sessionStorage',
  indexeddb: 'IndexedDB',
  cache_storage: 'Cache Storage',
};

export type Confirmacao = { ok: true; tipos: TiposConfirmados } | { ok: false; faltando: TipoStorage[] };

/**
 * Cruza o que o cenário declara com o que o usuário confirmou. Só dá certo se
 * todos os tipos declarados foram confirmados; o que foi confirmado a mais é ignorado.
 */
export function confirmarLimpeza(cenario: Pick<Cenario, 'limpar_storage'>, confirmados: readonly unknown[] | undefined): Confirmacao {
  const declarados = storageAConfirmar(cenario);
  const marcados = new Set<unknown>(confirmados ?? []);
  const faltando = declarados.filter((tipo) => !marcados.has(tipo));
  if (faltando.length > 0) return { ok: false, faltando };
  return { ok: true, tipos: declarados as unknown as TiposConfirmados };
}

/** Lista legível dos tipos, para o aviso e para o resultado. */
export function descreverStorage(tipos: readonly TipoStorage[]): string {
  return tipos.map((tipo) => NOMES_STORAGE[tipo]).join(', ');
}
