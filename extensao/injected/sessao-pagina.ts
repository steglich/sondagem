import type { Desconectados, Lote, MensagemDaPagina, MensagemParaPagina, Selecao } from '../shared/types.ts';
import type { Instalacao } from './instalacao.ts';
import { type Emissor, criarEmissor } from './lotes.ts';

/** O que este módulo usa de uma `chrome.runtime.Port`. */
export interface PortaPagina {
  postMessage(mensagem: MensagemDaPagina): void;
  disconnect(): void;
  onMessage: { addListener(ouvinte: (mensagem: MensagemParaPagina) => void): void };
  onDisconnect: { addListener(ouvinte: () => void): void };
}

export interface AmbientePagina {
  /** Abre a porta com o service worker. Pode lançar se a extensão foi recarregada. */
  conectar: () => PortaPagina;
  instalar: (selecao: Selecao) => Instalacao;
  /**
   * Avisa quando o documento está saindo (recarga, navegação, aba fechada), para
   * que o que foi acumulado desde o último lote não se perca.
   */
  aoSair?: (ouvinte: () => void) => void;
  intervaloMs?: number;
}

/**
 * Ciclo de vida do código injetado:
 *
 * 1. Abre a porta e espera `configurar`. Sem essa mensagem (não há sessão para
 *    esta aba), nada é instalado.
 * 2. Com `configurar`, instala os observadores da seleção e envia um lote por segundo.
 * 3. Com `encerrar`, desliga tudo e responde `encerrado` com o último lote e a
 *    contagem do que foi desconectado.
 *
 * Se a porta cair depois de configurada (service worker suspenso), tenta uma nova
 * conexão: o service worker retoma a sessão ou recusa, e a recusa desliga tudo.
 */
export function iniciarNaPagina(ambiente: AmbientePagina): void {
  let porta: PortaPagina | null = null;
  let instalacao: Instalacao | null = null;
  let emissor: Emissor | null = null;
  let encerrado = false;

  function desligar(): { lote: Lote | null; desconectados: Desconectados } {
    encerrado = true;
    const temporizadores = emissor ? 1 : 0;
    emissor?.parar();
    emissor = null;
    const lote = instalacao?.drenar() ?? null;
    const contagem = instalacao?.desinstalar() ?? { observadores: 0, listeners: 0 };
    instalacao = null;
    return { lote, desconectados: { ...contagem, temporizadores } };
  }

  function ligar(): void {
    let configurada = false;
    let estaPorta: PortaPagina;
    try {
      estaPorta = ambiente.conectar();
    } catch {
      desligar();
      return;
    }
    porta = estaPorta;

    estaPorta.onMessage.addListener((mensagem) => {
      if (encerrado) return;
      if (mensagem.tipo === 'configurar') {
        configurada = true;
        if (!instalacao) {
          const nova = ambiente.instalar(mensagem.selecao);
          instalacao = nova;
          // Registrado depois da instalação: entra na contagem e na limpeza do rastreador.
          ambiente.aoSair?.(() => {
            if (!encerrado && instalacao === nova) porta?.postMessage({ tipo: 'lote', lote: nova.drenar() });
          });
        }
        emissor ??= criarEmissor({
          drenar: () => instalacao!.drenar(),
          enviar: (lote) => porta?.postMessage({ tipo: 'lote', lote }),
          intervaloMs: ambiente.intervaloMs,
        });
      } else if (mensagem.tipo === 'encerrar') {
        const { lote, desconectados } = desligar();
        if (lote) estaPorta.postMessage({ tipo: 'encerrado', lote, desconectados });
        estaPorta.disconnect();
        porta = null;
      }
    });

    estaPorta.onDisconnect.addListener(() => {
      if (encerrado || porta !== estaPorta) return;
      porta = null;
      if (configurada) ligar();
      else desligar();
    });
  }

  ligar();
}
