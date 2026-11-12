/**
 * O que a página de relatório mostra de uma execução do histórico: as seções, o
 * ponto em que uma execução parcial parou e as medições por iteração (usadas nos
 * gráficos e na exportação CSV). Funções puras.
 */
import { type RegistroExecucao, VERSAO_DO_FORMATO } from './historico.ts';
import type { DadosColetados, IdMetricaIteracao } from './types.ts';

export const METRICAS_DE_ITERACAO: Record<IdMetricaIteracao, { nome: string; unidade: string }> = {
  'duracao-iteracao': { nome: 'Duração da iteração', unidade: 'ms' },
  'tempo-long-tasks': { nome: 'Tempo em long tasks por iteração', unidade: 'ms' },
  'pior-interacao': { nome: 'Pior interação por iteração', unidade: 'ms' },
};

// ---------------------------------------------------------------------------
// Seções
// ---------------------------------------------------------------------------

export type IdSecao = 'processamento' | 'carregamento' | 'memoria' | 'cpu' | 'erros';

export const NOMES_DAS_SECOES: Record<IdSecao, string> = {
  processamento: 'Processamento',
  carregamento: 'Carregamento',
  memoria: 'Memória',
  cpu: 'CPU',
  erros: 'Erros da página',
};

/**
 * Seções do relatório: uma para cada verificação que rodou ("Memória" e "DOM e
 * listeners" dividem a mesma). Execução cancelada não tem nenhuma, porque as
 * medições foram descartadas; análise ainda em andamento também não.
 */
export function secoesDoRelatorio(registro: Pick<RegistroExecucao, 'selecao' | 'estado' | 'resumo'>): IdSecao[] {
  if (!registro.resumo || registro.estado === 'cancelada') return [];
  const marcada = (id: RegistroExecucao['selecao'][number]): boolean => registro.selecao.includes(id);
  const secoes: IdSecao[] = [];
  if (marcada('processamento')) secoes.push('processamento');
  if (marcada('carregamento')) secoes.push('carregamento');
  if ((marcada('memoria') || marcada('dom-listeners')) && registro.resumo.memoria) secoes.push('memoria');
  if (marcada('cpu')) secoes.push('cpu');
  if (marcada('erros-pagina')) secoes.push('erros');
  return secoes;
}

/** `true` se o registro foi gravado por uma versão mais nova da extensão, com um formato que esta não conhece. */
export function formatoDesconhecido(registro: Pick<RegistroExecucao, 'versaoFormato'>): boolean {
  return (registro.versaoFormato ?? 1) > VERSAO_DO_FORMATO;
}

// ---------------------------------------------------------------------------
// Ponto de parada
// ---------------------------------------------------------------------------

export interface PontoDeParada {
  /** Iteração em que a execução parou; `null` em sessão manual ou se parou antes da primeira. */
  iteracao: number | null;
  totalIteracoes: number | null;
  iteracoesCompletas: number;
  motivo: string | null;
}

/** Onde uma execução que não terminou bem parou. `null` para a concluída sem falha de sessão. */
export function pontoDeParada(registro: Pick<RegistroExecucao, 'estado' | 'resumo' | 'configuracao'>): PontoDeParada | null {
  const resumo = registro.resumo;
  if (!resumo) return null;
  const cenario = resumo.cenario;
  if (registro.estado === 'concluida' && !cenario?.falhaDeSessao) return null;
  const desconexao = resumo.conexaoPerdida ? `O debugger foi desanexado (${resumo.conexaoPerdida}).` : null;
  if (!cenario) return { iteracao: null, totalIteracoes: null, iteracoesCompletas: 0, motivo: desconexao };

  const falha = [...cenario.falhas].reverse().find((f) => f.acao === 'interrompeu');
  const incompleta = [...cenario.iteracoes].reverse().find((i) => !i.completa);
  const iteracao = cenario.falhaDeSessao?.iteracao ?? falha?.iteracao ?? incompleta?.numero ?? cenario.iteracoes.at(-1)?.numero ?? null;
  const motivo = cenario.falhaDeSessao
    ? `A aplicação pediu o login (${cenario.falhaDeSessao.url}).`
    : (falha?.motivo ?? desconexao ?? (registro.estado === 'cancelada' ? 'Cancelada pelo usuário.' : null));
  return {
    iteracao,
    totalIteracoes: registro.configuracao?.iteracoes ?? cenario.configuracao.iteracoes,
    iteracoesCompletas: cenario.iteracoesCompletas,
    motivo,
  };
}

// ---------------------------------------------------------------------------
// Medições por iteração
// ---------------------------------------------------------------------------

export type IdColuna =
  | 'duracao'
  | 'tempoLongTasks'
  | 'longTasks'
  | 'piorInteracao'
  | 'interacoes'
  | 'heapUsado'
  | 'nosDom'
  | 'listeners'
  | 'erros';

export const COLUNAS: Record<IdColuna, { nome: string; unidade: string }> = {
  duracao: { nome: 'Duração da iteração', unidade: 'ms' },
  tempoLongTasks: { nome: 'Tempo em long tasks', unidade: 'ms' },
  longTasks: { nome: 'Long tasks', unidade: 'quantidade' },
  piorInteracao: { nome: 'Pior interação', unidade: 'ms' },
  interacoes: { nome: 'Interações', unidade: 'quantidade' },
  heapUsado: { nome: 'Heap usado', unidade: 'bytes' },
  nosDom: { nome: 'Nós DOM', unidade: 'quantidade' },
  listeners: { nome: 'Listeners', unidade: 'quantidade' },
  erros: { nome: 'Erros da página', unidade: 'quantidade' },
};

export interface LinhaIteracao {
  iteracao: number;
  completa: boolean;
  /** `null`: sem dado para a iteração (não medido, ou a lista foi truncada). */
  valores: Record<IdColuna, number | null>;
}

export interface MedicoesPorIteracao {
  /** Só as colunas das verificações que rodaram. */
  colunas: IdColuna[];
  linhas: LinhaIteracao[];
}

const SERIE_DA_COLUNA = { heapUsado: 'heap_usado', nosDom: 'nos_dom', listeners: 'listeners' } as const;

/**
 * Uma linha por iteração do cenário, com o que foi medido em cada uma. Long tasks
 * causadas pela medição ficam de fora, como nas estatísticas. Sessão manual não tem
 * iterações: devolve zero linhas.
 */
export function medicoesPorIteracao(
  registro: Pick<RegistroExecucao, 'selecao' | 'resumo' | 'truncado'>,
  dados: Pick<DadosColetados, 'longTasks' | 'interacoes' | 'errosPagina'>,
): MedicoesPorIteracao {
  const iteracoes = registro.resumo?.cenario?.iteracoes ?? [];
  const marcada = (id: RegistroExecucao['selecao'][number]): boolean => registro.selecao.includes(id);
  const series = registro.resumo?.memoria?.series ?? [];
  const serie = (coluna: keyof typeof SERIE_DA_COLUNA) => series.find((s) => s.metrica === SERIE_DA_COLUNA[coluna]);

  const colunas: IdColuna[] = ['duracao'];
  if (marcada('processamento')) colunas.push('tempoLongTasks', 'longTasks', 'piorInteracao', 'interacoes');
  for (const coluna of ['heapUsado', 'nosDom', 'listeners'] as const) if ((serie(coluna)?.pontos.length ?? 0) > 0) colunas.push(coluna);
  if (marcada('erros-pagina')) colunas.push('erros');

  const temLongTasks = marcada('processamento') && !registro.truncado.includes('longTasks');
  const temInteracoes = marcada('processamento') && !registro.truncado.includes('interacoes');
  const temErros = marcada('erros-pagina') && !registro.truncado.includes('errosPagina');

  // Uma passada por lista, e não uma por iteração: as listas podem ter milhares de itens.
  const tempoLongTasks = new Map<number, number>();
  const quantidadeLongTasks = new Map<number, number>();
  for (const tarefa of dados.longTasks) {
    if (typeof tarefa.iteracao !== 'number' || tarefa.causadaPelaMedicao) continue;
    tempoLongTasks.set(tarefa.iteracao, (tempoLongTasks.get(tarefa.iteracao) ?? 0) + tarefa.duracao);
    quantidadeLongTasks.set(tarefa.iteracao, (quantidadeLongTasks.get(tarefa.iteracao) ?? 0) + 1);
  }
  const piorInteracao = new Map<number, number>();
  const quantidadeInteracoes = new Map<number, number>();
  for (const interacao of dados.interacoes) {
    if (typeof interacao.iteracao !== 'number') continue;
    piorInteracao.set(interacao.iteracao, Math.max(piorInteracao.get(interacao.iteracao) ?? 0, interacao.duracao));
    quantidadeInteracoes.set(interacao.iteracao, (quantidadeInteracoes.get(interacao.iteracao) ?? 0) + 1);
  }
  const erros = new Map<number, number>();
  for (const erro of dados.errosPagina) {
    if (typeof erro.iteracao === 'number') erros.set(erro.iteracao, (erros.get(erro.iteracao) ?? 0) + 1);
  }
  const ponto = (coluna: keyof typeof SERIE_DA_COLUNA, numero: number): number | null =>
    serie(coluna)?.pontos.find((p) => p.iteracao === numero)?.valor ?? null;

  const linhas = iteracoes.map((iteracao): LinhaIteracao => {
    const n = iteracao.numero;
    return {
      iteracao: n,
      completa: iteracao.completa,
      valores: {
        duracao: iteracao.fim === null ? null : iteracao.fim - iteracao.inicio,
        tempoLongTasks: temLongTasks ? (tempoLongTasks.get(n) ?? 0) : null,
        longTasks: temLongTasks ? (quantidadeLongTasks.get(n) ?? 0) : null,
        // Iteração sem interação não tem "pior interação": fica sem dado, não zero.
        piorInteracao: temInteracoes ? (piorInteracao.get(n) ?? null) : null,
        interacoes: temInteracoes ? (quantidadeInteracoes.get(n) ?? 0) : null,
        heapUsado: ponto('heapUsado', n),
        nosDom: ponto('nosDom', n),
        listeners: ponto('listeners', n),
        erros: temErros ? (erros.get(n) ?? 0) : null,
      },
    };
  });
  return { colunas, linhas };
}
