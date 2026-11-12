/**
 * Perfil de CPU pelo CDP. Usado pelo runner de cenários e pela sessão manual. Não
 * usa `chrome.*`: os comandos e os eventos chegam por `CanalCpu`.
 *
 * O `chrome.debugger` recusa todo o domínio `Profiler` a extensões, então o perfil
 * vem do `Tracing`: `Tracing.start` liga o amostrador do V8 e `Tracing.end` faz o
 * navegador entregar o que gravou, em eventos `Tracing.dataCollected`, fechando com
 * `Tracing.tracingComplete`. Cada entrega é somada por `criarAgregadorCpu` e
 * descartada: o perfil bruto nunca fica inteiro na memória, e só o resumo é guardado.
 *
 * `COMANDOS_DE_CPU` lista o que é enviado, e um teste de integração confere cada
 * comando no navegador.
 */
import { CATEGORIA_PERFIL_CPU, FALHA_CPU_SEM_LEITURA, type IntervaloTrace, criarAgregadorCpu, mensagemFalhaCpu } from '../shared/cpu.ts';
import type { ColetaCpu, DadosColetados } from '../shared/types.ts';
import type { ConexaoCdp } from './cdp.ts';

export type CanalCpu = Pick<ConexaoCdp, 'enviar' | 'aoEvento'>;

/** Todo comando de CDP que este módulo envia. */
export const COMANDOS_DE_CPU = ['Tracing.start', 'Tracing.end', 'Performance.enable', 'Performance.getMetrics'] as const;

/** Quanto esperar, depois de `Tracing.end`, pela entrega completa do perfil. */
export const TEMPO_LIMITE_ENTREGA_MS = 30_000;
const INTERVALO_ESPERA_MS = 50;

export interface RelogioCpu {
  agora(): number;
  esperar(ms: number): Promise<void>;
}

export interface ContextoCpu {
  cdp: CanalCpu;
  /** Dados da sessão: o andamento e o resumo do perfil ficam em `dados.cpu`. */
  dados: DadosColetados;
  relogio: RelogioCpu;
  /** Quantas funções o resumo guarda. O padrão é `LIMITE_FUNCOES_CPU`. */
  limiteFuncoes?: number;
}

export interface PerfilCpu {
  /** `true` entre `iniciar` e `encerrar` (ou `abandonar`): há um trace aberto no navegador. */
  readonly coletando: boolean;
  /** Liga o perfil. Rejeita se o navegador recusar; quem chama decide se registra a falha com `falhar`. */
  iniciar(): Promise<void>;
  /** Registra que o perfil não foi coletado; a análise segue sem ele. */
  falhar(erro: unknown): void;
  /**
   * Roda a operação e deixa fora do resumo as amostras do período dela (censo de
   * objetos, coleta de lixo forçada). Sem perfil aberto, só roda a operação.
   */
  excluir<T>(operacao: () => Promise<T>): Promise<T>;
  /** Para o perfil, espera a entrega e guarda o resumo. Não rejeita. */
  encerrar(opcoes?: { limiteAtingido?: boolean }): Promise<void>;
  /** Para o perfil sem ler nada (cancelamento, conexão perdida). Não rejeita. */
  abandonar(): Promise<void>;
}

function coleta(parcial: Partial<ColetaCpu>): ColetaCpu {
  return { estado: 'coletando', ativo: true, resumo: null, falha: null, incompleto: false, limiteAtingido: false, ...parcial };
}

export function criarPerfilCpu(contexto: ContextoCpu): PerfilCpu {
  const { cdp, dados, relogio } = contexto;
  const excluidos: IntervaloTrace[] = [];
  const agregador = criarAgregadorCpu({ excluidos, limite: contexto.limiteFuncoes });
  let coletando = false;
  let abandonado = false;
  let completo = false;
  let perda = false;
  let assinaturas: (() => void)[] = [];

  function soltar(): void {
    assinaturas.forEach((cancelar) => cancelar());
    assinaturas = [];
  }

  /**
   * Instante atual no relógio do trace, em µs. O `Timestamp` de `Performance.getMetrics`
   * usa o mesmo relógio monotônico dos eventos do trace; o relógio do service worker, não.
   */
  async function instanteDoTrace(): Promise<number | null> {
    await cdp.enviar('Performance.enable');
    const { metrics = [] } = await cdp.enviar<{ metrics?: { name: string; value: number }[] }>('Performance.getMetrics');
    const segundos = metrics.find((m) => m.name === 'Timestamp')?.value;
    return segundos === undefined ? null : segundos * 1_000_000;
  }

  return {
    get coletando() {
      return coletando;
    },

    async iniciar() {
      assinaturas = [
        cdp.aoEvento('Tracing.dataCollected', (parametros) => {
          const eventos = (parametros as { value?: unknown[] } | undefined)?.value;
          if (Array.isArray(eventos)) agregador.receber(eventos);
        }),
        cdp.aoEvento('Tracing.tracingComplete', (parametros) => {
          perda = (parametros as { dataLossOccurred?: boolean } | undefined)?.dataLossOccurred === true;
          completo = true;
        }),
      ];
      try {
        await cdp.enviar('Tracing.start', { traceConfig: { includedCategories: [CATEGORIA_PERFIL_CPU] }, transferMode: 'ReportEvents' });
      } catch (erro) {
        soltar();
        throw erro;
      }
      // Quem pediu o início já desistiu (cancelamento): o trace não fica aberto.
      if (abandonado) {
        soltar();
        await cdp.enviar('Tracing.end').catch(() => undefined);
        return;
      }
      coletando = true;
      dados.cpu = coleta({});
    },

    falhar(erro) {
      dados.cpu = coleta({ estado: 'falhou', ativo: false, falha: mensagemFalhaCpu(erro) });
    },

    async excluir(operacao) {
      if (!coletando) return operacao();
      const inicio = await instanteDoTrace();
      if (inicio === null) return operacao();
      const intervalo: IntervaloTrace = { inicio, fim: null };
      excluidos.push(intervalo);
      try {
        return await operacao();
      } finally {
        // Sem a leitura do fim (conexão perdida), o intervalo fica aberto: o que vier depois não conta.
        intervalo.fim = await instanteDoTrace().catch(() => null);
      }
    },

    async encerrar(opcoes = {}) {
      if (!coletando) return;
      coletando = false;
      const limiteAtingido = opcoes.limiteAtingido === true;
      try {
        await cdp.enviar('Tracing.end');
        const prazo = relogio.agora() + TEMPO_LIMITE_ENTREGA_MS;
        while (!completo && !abandonado && relogio.agora() < prazo) await relogio.esperar(INTERVALO_ESPERA_MS);
      } catch {
        abandonado = true;
      }
      soltar();
      if (abandonado) {
        dados.cpu = coleta({ estado: 'falhou', falha: FALHA_CPU_SEM_LEITURA, limiteAtingido });
        return;
      }
      // A partir daqui só existe o resumo: os pedaços do perfil já foram somados e soltos.
      dados.cpu = coleta({ estado: 'concluida', resumo: agregador.resumir(), incompleto: perda || !completo, limiteAtingido });
    },

    async abandonar() {
      abandonado = true;
      if (!coletando) return;
      coletando = false;
      soltar();
      await cdp.enviar('Tracing.end').catch(() => undefined);
    },
  };
}
