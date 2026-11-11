import type { Coletor, Lote, MetricasParciais, Selecao } from '../shared/types.ts';
import { coletoresDaSelecao } from '../shared/verificacoes.ts';
import { criarColeta } from './observers.ts';
import { type EscopoRastreavel, obterRastreador } from './rastreador.ts';
import type { AoMedir } from './vitals.ts';

export interface AmbienteInstalacao {
  /** Objeto global do mundo isolado. */
  escopo: EscopoRastreavel;
  /** `performance.timeOrigin` do documento. */
  origemTempo: number;
  urlAtual: () => string;
  instalarVitals: (coletores: readonly Coletor[], aoMedir: AoMedir) => void;
}

export interface Instalacao {
  /** Monta o próximo lote com o que foi acumulado. */
  drenar(): Lote;
  /** Desconecta tudo o que foi instalado e devolve as contagens. */
  desinstalar(): { observadores: number; listeners: number };
}

/**
 * Instala na página somente os observadores das verificações marcadas. Uma
 * verificação desmarcada não cria observador nenhum.
 */
export function instalarObservadores(selecao: Selecao, ambiente: AmbienteInstalacao): Instalacao {
  const coletores = coletoresDaSelecao(selecao);
  const rastreador = obterRastreador(ambiente.escopo);
  const idDocumento = String(ambiente.origemTempo);

  const coleta = criarColeta({
    coletores,
    // Lido depois de `obterRastreador`, para já ser o construtor rastreado.
    Observador: ambiente.escopo.PerformanceObserver,
    origemTempo: ambiente.origemTempo,
    documento: idDocumento,
  });

  let ativo = true;
  let metricas: MetricasParciais = {};
  ambiente.instalarVitals(coletores, (nome, valor) => {
    if (ativo) metricas[nome] = valor;
  });

  return {
    drenar() {
      const lote: Lote = {
        documento: { id: idDocumento, url: ambiente.urlAtual(), inicio: ambiente.origemTempo },
        ...coleta.drenar(),
        metricas,
      };
      metricas = {};
      return lote;
    },
    desinstalar() {
      ativo = false;
      // A coleta desconecta os seus; o rastreador conta e desliga todos, inclusive os da web-vitals.
      const contagem = rastreador.desconectarTudo();
      coleta.parar();
      return contagem;
    },
  };
}
