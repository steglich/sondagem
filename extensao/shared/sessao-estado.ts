/**
 * Máquina de estados da sessão, sem efeitos colaterais:
 *
 *   ociosa ──iniciar──▶ ativa ──comecarParada──▶ parando ──concluir──▶ ociosa (com resultado)
 *                         └────────────concluir (interrompida)────────▶ ociosa (com resultado)
 */
import { dadosVazios, estatisticasDaExecucao, resumir } from './agregacao.ts';
import type { Cenario } from './cenario.ts';
import { SEM_CONDICOES } from './condicoes.ts';
import { FALHA_CPU_SEM_LEITURA } from './cpu.ts';
import { andamentoInicial } from './execucao-estado.ts';
import { analisarMemoria } from './memoria.ts';
import type {
  CondicoesDeTeste,
  ConfiguracaoExecucao,
  Desfecho,
  EstadoSessao,
  ExtensaoAtiva,
  ItemLimpeza,
  Navegador,
  ResultadoCenario,
  ResultadoSessao,
  Selecao,
  SessaoEmAndamento,
  VisaoSessao,
} from './types.ts';

export function estadoInicial(): EstadoSessao {
  return { fase: 'ociosa', sessao: null, resultado: null, idResultado: null };
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
  /** Identificador da análise no histórico. Sem ele, é derivado do instante de início. */
  id?: string;
  /** Condições aplicadas. Sem o campo, nenhuma (sessão manual sem escolha de throttling). */
  condicoes?: CondicoesDeTeste;
  extensoes?: ExtensaoAtiva[];
  navegador?: Navegador | null;
}

/** Só uma análise por vez: recusa o início se já houver uma ativa ou parando. */
export function iniciar(estado: EstadoSessao, inicio: DadosInicio): Transicao {
  if (estado.fase !== 'ociosa') return { ok: false, motivo: 'sessao-ativa' };
  const { cenario, usaDebugger = false, id, condicoes, extensoes = [], navegador = null, ...comum } = inicio;
  const sessao: SessaoEmAndamento = {
    id: id ?? `analise-${inicio.inicio}`,
    tipo: cenario ? 'cenario' : 'sessao-manual',
    ...comum,
    condicoes: condicoes ?? SEM_CONDICOES,
    extensoes,
    navegador,
    dados: dadosVazios(),
    usaDebugger,
    conexaoPerdida: null,
    cenario: cenario ? { ...cenario, andamento: andamentoInicial(cenario.configuracao.iteracoes) } : null,
  };
  return { ok: true, estado: { fase: 'ativa', sessao, resultado: estado.resultado, idResultado: estado.idResultado } };
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
  const { id, tipo, url, selecao, inicio, dados, conexaoPerdida, condicoes, extensoes, navegador } = estado.sessao;
  const cancelada = fim.desfecho === 'cancelada';
  // A análise acabou com o perfil de CPU ainda aberto (conexão perdida, extensão suspensa): não há resumo.
  if (dados.cpu?.estado === 'coletando') dados.cpu = { ...dados.cpu, estado: 'falhou', falha: FALHA_CPU_SEM_LEITURA };
  let cenario: ResultadoCenario | null = null;
  // Sessão manual: sem iterações comparáveis, a memória sai sem série e sem classificação.
  let iteracoesDaAnalise: ResultadoCenario['iteracoes'] | null = null;
  if (estado.sessao.cenario) {
    const { configuracao, andamento } = estado.sessao.cenario;
    // Uma iteração que não chegou ao fim (erro, cancelamento, conexão perdida) é incompleta.
    const iteracoes = andamento.iteracoes.map((i) => (i.fim === null ? { ...i, fim: fim.fim, completa: false } : i));
    const completas = iteracoes.filter((i) => i.completa).length;
    iteracoesDaAnalise = iteracoes;
    cenario = {
      configuracao,
      estadoFinal: andamento.estado,
      ambiente: andamento.ambiente,
      iteracoes,
      iteracoesCompletas: completas,
      iteracoesIncompletas: iteracoes.length - completas,
      passosExecutados: andamento.passosExecutados,
      falhas: andamento.falhas,
      falhaDeSessao: andamento.falhaDeSessao ?? null,
      // Sessão expirada não é resultado de performance: nenhuma estatística é apresentada.
      estatisticas: cancelada || andamento.falhaDeSessao ? [] : estatisticasDaExecucao(dados, iteracoes, selecao),
    };
  }
  const resultado: ResultadoSessao = {
    id,
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
    memoria: cancelada ? null : analisarMemoria(dados, selecao, iteracoesDaAnalise),
    condicoes,
    extensoes,
    navegador,
    truncado: [],
  };
  return { ok: true, estado: { fase: 'ociosa', sessao: null, resultado, idResultado: id } };
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
