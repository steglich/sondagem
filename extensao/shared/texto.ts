/** Formata uma duração em milissegundos para exibição, com uma casa decimal. */
export function formatarMs(ms: number): string {
  return `${ms.toFixed(1)} ms`;
}
