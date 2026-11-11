/**
 * Máquina de estados da sessão, sem efeitos colaterais:
 *
 *   ociosa ──iniciar──▶ ativa ──comecarParada──▶ parando ──concluir──▶ ociosa (com resultado)
 *                         └────────────concluir (interrompida)────────▶ ociosa (com resultado)
 */
import { dadosVazios, estatisticasDaExecucao, resumir } from './agregacao.ts';
import type { Cenario } from './cenario.ts';
import { andamentoInicial } from './execucao-estado.ts';
import type {
  ConfiguracaoExecucao,
  Desfecho,
  EstadoSessao,
  ItemLimpeza,
  ResultadoCenario,
  ResultadoSessao,
  Selecao,
  SessaoEmAndamento,
  VisaoSessao,
} from './types.ts';

export function estadoInicial(): EstadoSessao {
  return { fase: 'ociosa', sessao: null, resultado: null };
}

export type Transicao = { ok: true; estado: EstadoSessao } | { ok: false; motivo: 'sessao-ativa' | 'sem-sessao' };

export interface DadosInicio {
  idAba: number;
  url: string;
  selecao: Selecao;
  inicio: number;
  idsScripts: string[];
  /** `true` se o debugger foi anexado à aba para esta sessão. */
  usaDebugger?: boolean;
  /** Presente em execuções de cenário. */
  cenario?: { definicao: Cenario; configuracao: ConfiguracaoExecucao };
}

/** Só uma análise por vez: recusa o início se já houver uma ativa ou parando. */
export function iniciar(estado: EstadoSessao, inicio: DadosInicio): Transicao {
  if (estado.fase !== 'ociosa') return { ok: false, motivo: 'sessao-ativa' };
  const { cenario, usaDebugger = false, ...comum } = inicio;
  const sessao: SessaoEmAndamento = {
    tipo: cenario ? 'cenario' : 'sessao-manual',
    ...comum,
    dados: dadosVazios(),
    usaDebugger,
    conexaoPerdida: null,
    cenario: cenario ? { ...cenario, andamento: andamentoInicial(cenario.configuracao.iteracoes) } : null,
  };
  return { ok: true, estado: { fase: 'ativa', sessao, resultado: estado.resultado } };
}

export function comecarParada(estado: EstadoSessao): Transicao {
  if (estado.fase !== 'ativa' || !estado.sessao) return { ok: false, motivo: 'sem-sessao' };
  return { ok: true, estado: { ...estado, fase: 'parando' } };
}

export interface DadosFim {
  desfecho: Desfecho;
  fim: number;
  limpeza: ItemLimpeza[];
  paginaRespondeu: boolean;
}

/** Encerra a sessão (ativa ou parando) e guarda o resultado. Cancelamento descarta as medições. */
export function concluir(estado: EstadoSessao, fim: DadosFim): Transicao {
  if (estado.fase === 'ociosa' || !estado.sessao) return { ok: false, motivo: 'sem-sessao' };
  const { tipo, url, selecao, inicio, dados, conexaoPerdida } = estado.sessao;
  const cancelada = fim.desfecho === 'cancelada';
  let cenario: ResultadoCenario | null = null;
  if (estado.sessao.cenario) {
    const { configuracao, andamento } = estado.sessao.cenario;
    // Uma iteração que não chegou ao fim (erro, cancelamento, conexão perdida) é incompleta.
    const iteracoes = andamento.iteracoes.map((i) => (i.fim === null ? { ...i, fim: fim.fim, completa: false } : i));
    const completas = iteracoes.filter((i) => i.completa).length;
    cenario = {
      configuracao,
      estadoFinal: andamento.estado,
      ambiente: andamento.ambiente,
      iteracoes,
      iteracoesCompletas: completas,
      iteracoesIncompletas: iteracoes.length - completas,
      passosExecutados: andamento.passosExecutados,
      falhas: andamento.falhas,
      estatisticas: cancelada ? [] : estatisticasDaExecucao(dados, iteracoes, selecao),
    };
  }
  const resultado: ResultadoSessao = {
    tipo,
    desfecho: fim.desfecho,
    url,
    selecao,
    inicio,
    fim: fim.fim,
    dados: cancelada ? dadosVazios() : dados,
    limpeza: fim.limpeza,
    paginaRespondeu: fim.paginaRespondeu,
    conexaoPerdida,
    cenario,
  };
  return { ok: true, estado: { fase: 'ociosa', sessao: null, resultado } };
}

/** Recorte enviado à interface: status resumido durante a análise, resultado completo só depois. */
export function visaoDe(estado: EstadoSessao): VisaoSessao {
  const { fase, sessao } = estado;
  if (fase === 'ociosa' || !sessao) {
    return {
      fase: 'ociosa',
      alvo: null,
      selecao: [],
      inicio: null,
      status: null,
      execucao: null,
      resultado: estado.resultado,
    };
  }
  return {
    fase,
    alvo: { idAba: sessao.idAba, url: sessao.url },
    selecao: sessao.selecao,
    inicio: sessao.inicio,
    status: resumir(sessao.dados),
    execucao: sessao.cenario
      ? {
          nome: sessao.cenario.configuracao.nome,
          estado: sessao.cenario.andamento.estado,
          iteracao: sessao.cenario.andamento.iteracao,
          totalIteracoes: sessao.cenario.andamento.totalIteracoes,
        }
      : null,
    resultado: null,
  };
}
