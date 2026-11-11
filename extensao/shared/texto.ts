/** Formata uma duração em milissegundos para exibição, com uma casa decimal. */
export function formatarMs(ms: number): string {
  return `${ms.toFixed(1)} ms`;
}

/** Formata um tamanho em bytes com a unidade que couber (B, KB ou MB). */
export function formatarBytes(bytes: number): string {
  const absoluto = Math.abs(bytes);
  if (absoluto < 1024) return `${bytes} B`;
  if (absoluto < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Como `formatarBytes`, com sinal explícito: para variações. */
export function formatarVariacaoBytes(bytes: number): string {
  return `${bytes > 0 ? '+' : ''}${formatarBytes(bytes)}`;
}
