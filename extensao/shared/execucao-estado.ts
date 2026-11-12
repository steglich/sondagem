/**
 * Máquina de estados do runner de cenários, sem efeitos colaterais:
 *
 *   ociosa → preparando → [aquecendo →] executando ⇄ coletando → concluida
 *                 └──────────────┴────────────┴───────────┴────▶ erro | cancelada
 *
 * `coletando` é o fecho de cada iteração (e da execução): o runner marca o fim e
 * recolhe o que foi medido antes de seguir. Estados finais só voltam a `ociosa`.
 */
import type { AndamentoExecucao, EstadoExecucao } from './types.ts';

export const TRANSICOES: Readonly<Record<EstadoExecucao, readonly EstadoExecucao[]>> = {
  ociosa: ['preparando'],
  preparando: ['aquecendo', 'executando', 'erro', 'cancelada'],
  aquecendo: ['executando', 'erro', 'cancelada'],
  executando: ['coletando', 'erro', 'cancelada'],
  coletando: ['executando', 'concluida', 'erro', 'cancelada'],
  concluida: ['ociosa'],
  erro: ['ociosa'],
  cancelada: ['ociosa'],
};

export const ESTADOS_FINAIS: readonly EstadoExecucao[] = ['concluida', 'erro', 'cancelada'];

export function podeTransitar(de: EstadoExecucao, para: EstadoExecucao): boolean {
  return TRANSICOES[de].includes(para);
}

export class TransicaoInvalida extends Error {
  constructor(
    readonly de: EstadoExecucao,
    readonly para: EstadoExecucao,
  ) {
    super(`Transição inválida da execução: ${de} → ${para}`);
    this.name = 'TransicaoInvalida';
  }
}

/** Devolve o novo estado, ou lança `TransicaoInvalida` se a tabela não permitir. */
export function transitar(de: EstadoExecucao, para: EstadoExecucao): EstadoExecucao {
  if (!podeTransitar(de, para)) throw new TransicaoInvalida(de, para);
  return para;
}

export function andamentoInicial(totalIteracoes: number): AndamentoExecucao {
  return {
    estado: 'ociosa',
    iteracao: 0,
    totalIteracoes,
    aquecimento: null,
    iteracoes: [],
    passosExecutados: 0,
    falhas: [],
    ambiente: null,
    falhaDeSessao: null,
  };
}
