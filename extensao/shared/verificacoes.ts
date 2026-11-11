import type { Coletor, IdVerificacao, Selecao, Verificacao } from './types.ts';

/**
 * Registro central de verificações. As fases seguintes acrescentam entradas aqui
 * (memória, CPU), e a tela de confirmação lista o que estiver registrado.
 */
export const VERIFICACOES: readonly Verificacao[] = [
  {
    id: 'processamento',
    nome: 'Processamento',
    descricao: 'Long tasks, interações lentas e INP',
    exige: 'pagina',
    coleta: ['long-tasks', 'interacoes', 'inp'],
  },
  {
    id: 'carregamento',
    nome: 'Carregamento',
    descricao: 'LCP, CLS, FCP e TTFB',
    exige: 'pagina',
    coleta: ['metricas-carregamento'],
  },
];

/** Seleção usada quando ainda não há uma escolha salva: tudo marcado. */
export function selecaoPadrao(): Selecao {
  return VERIFICACOES.map((v) => v.id);
}

/** Descarta o que não é verificação conhecida, remove repetições e ordena como o registro. */
export function normalizarSelecao(valor: unknown): Selecao {
  if (!Array.isArray(valor)) return [];
  const marcadas = new Set<unknown>(valor);
  return VERIFICACOES.filter((v) => marcadas.has(v.id)).map((v) => v.id);
}

/** O que coletar na página para a seleção dada. Seleção vazia não coleta nada. */
export function coletoresDaSelecao(selecao: readonly IdVerificacao[]): Coletor[] {
  const coletores = new Set<Coletor>();
  for (const verificacao of VERIFICACOES) {
    if (selecao.includes(verificacao.id)) verificacao.coleta.forEach((c) => coletores.add(c));
  }
  return [...coletores];
}
