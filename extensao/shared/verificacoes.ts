import type { Coletor, IdVerificacao, Selecao, Verificacao } from './types.ts';

/**
 * Registro central de verificações. A tela de confirmação lista o que estiver
 * registrado aqui.
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
  {
    id: 'erros-pagina',
    nome: 'Erros da página',
    descricao: 'Exceções JavaScript e promises rejeitadas (usa o debugger)',
    exige: 'debugger',
    // Coletada pelo service worker via CDP: nada é instalado na página.
    coleta: [],
  },
  {
    id: 'memoria',
    nome: 'Memória',
    descricao: 'Heap por iteração e snapshots de início e fim, com coleta de lixo forçada (usa o debugger)',
    exige: 'debugger',
    coleta: [],
  },
  {
    id: 'dom-listeners',
    nome: 'DOM e listeners',
    descricao: 'Nós DOM desanexados e listeners acumulados (usa o debugger)',
    exige: 'debugger',
    coleta: [],
  },
  {
    id: 'cpu',
    nome: 'CPU',
    descricao: 'Tempo de processamento por função; o perfil deixa a página mais lenta (usa o debugger)',
    exige: 'debugger',
    coleta: [],
  },
];

/**
 * Seleção usada quando ainda não há uma escolha salva. Na sessão manual ficam
 * marcadas só as verificações que não exigem o debugger, para que a análise não
 * abra a barra de depuração sem o usuário pedir. Em cenários o debugger já é
 * anexado para executar os passos, então tudo vem marcado.
 */
export function selecaoPadrao(comDebugger = false): Selecao {
  return VERIFICACOES.filter((v) => comDebugger || v.exige === 'pagina').map((v) => v.id);
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

/** Verificações da seleção que só rodam com o debugger anexado à aba. */
export function verificacoesComDebugger(selecao: readonly IdVerificacao[]): Verificacao[] {
  return VERIFICACOES.filter((v) => v.exige === 'debugger' && selecao.includes(v.id));
}
