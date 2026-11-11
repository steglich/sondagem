/**
 * Máquina de estados da sessão, sem efeitos colaterais:
 *
 *   ociosa ──iniciar──▶ ativa ──comecarParada──▶ parando ──concluir──▶ ociosa (com resultado)
 *                         └────────────concluir (interrompida)────────▶ ociosa (com resultado)
 */
import { dadosVazios, resumir } from './agregacao.ts';
import type {
  Desfecho,
  EstadoSessao,
  ItemLimpeza,
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
}

/** Só uma análise por vez: recusa o início se já houver uma ativa ou parando. */
export function iniciar(estado: EstadoSessao, inicio: DadosInicio): Transicao {
  if (estado.fase !== 'ociosa') return { ok: false, motivo: 'sessao-ativa' };
  const sessao: SessaoEmAndamento = { tipo: 'sessao-manual', ...inicio, dados: dadosVazios() };
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
  const { tipo, url, selecao, inicio, dados } = estado.sessao;
  const resultado: ResultadoSessao = {
    tipo,
    desfecho: fim.desfecho,
    url,
    selecao,
    inicio,
    fim: fim.fim,
    dados: fim.desfecho === 'cancelada' ? dadosVazios() : dados,
    limpeza: fim.limpeza,
    paginaRespondeu: fim.paginaRespondeu,
  };
  return { ok: true, estado: { fase: 'ociosa', sessao: null, resultado } };
}

/** Recorte enviado à interface: status resumido durante a análise, resultado completo só depois. */
export function visaoDe(estado: EstadoSessao): VisaoSessao {
  const { fase, sessao } = estado;
  if (fase === 'ociosa' || !sessao) {
    return { fase: 'ociosa', alvo: null, selecao: [], inicio: null, status: null, resultado: estado.resultado };
  }
  return {
    fase,
    alvo: { idAba: sessao.idAba, url: sessao.url },
    selecao: sessao.selecao,
    inicio: sessao.inicio,
    status: resumir(sessao.dados),
    resultado: null,
  };
}
