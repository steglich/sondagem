/** Textos e formatos comuns às telas de relatório. */
import type { EstadoRegistro, RegistroExecucao } from '../../../../shared/historico';
import { formatarBytes, formatarMs } from '../../../../shared/texto';
import type { ClassificacaoVazamento, ListaTruncavel } from '../../../../shared/types';

export const ESTADOS: Record<EstadoRegistro, string> = {
  'em-andamento': 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
  interrompida: 'Interrompida',
  erro: 'Erro na execução',
};

export const CLASSIFICACOES: Record<ClassificacaoVazamento, string> = {
  'vazamento-provavel': 'Vazamento provável',
  'sem-indicio': 'Sem indício de vazamento',
  'dados-insuficientes': 'Dados insuficientes',
};

export const LISTAS: Record<ListaTruncavel, string> = {
  longTasks: 'long tasks',
  interacoes: 'interações',
  errosPagina: 'erros da página',
  documentos: 'carregamentos',
  snapshots: 'construtores de cada snapshot',
  funcoesCpu: 'funções do perfil de CPU',
};

/** Estado como é exibido: a falha de sessão tem nome próprio, mesmo com a execução "concluída". */
export function estadoExibido(registro: Pick<RegistroExecucao, 'estado' | 'resumo'>): string {
  return registro.resumo?.cenario?.falhaDeSessao ? 'Falha de sessão' : ESTADOS[registro.estado];
}

export function dataHora(instante: number): string {
  return new Date(instante).toLocaleString('pt-BR');
}

/** Identificação curta de uma execução, para listas e seletores. */
export function rotuloDaExecucao(registro: Pick<RegistroExecucao, 'nomeCenario' | 'versaoBuild' | 'inicio'>): string {
  const build = registro.versaoBuild ? ` · build ${registro.versaoBuild}` : '';
  return `${registro.nomeCenario ?? 'Sessão manual'}${build} · ${dataHora(registro.inicio)}`;
}

/** Valor com a unidade da métrica; `null` vira "sem dado". */
export function valorComUnidade(valor: number | null, unidade: string): string {
  if (valor === null) return 'sem dado';
  if (unidade === 'ms') return formatarMs(valor);
  if (unidade === 'bytes') return formatarBytes(valor);
  return String(valor);
}

export function comSinal(texto: string, valor: number): string {
  return valor > 0 ? `+${texto}` : texto;
}

export function percentual(valor: number | null): string {
  return valor === null ? '—' : `${valor > 0 ? '+' : ''}${valor.toFixed(1)}%`;
}

/** Instante relativo ao início da análise, em segundos. */
export function segundosDesde(inicio: number, instante: number): string {
  return `${((instante - inicio) / 1000).toFixed(2)} s`;
}

export function iteracaoExibida(iteracao: number | null | undefined): string {
  return typeof iteracao === 'number' ? String(iteracao) : '—';
}
