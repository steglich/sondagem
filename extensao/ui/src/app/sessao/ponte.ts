import { Injectable } from '@angular/core';
import type {
  ComandoInterface,
  ContextoSelecao,
  EventoParaInterface,
  RespostaComando,
  Selecao,
  VisaoSessao,
} from '../../../../shared/types';
import { lerSelecao, salvarSelecao } from '../../../../storage/selecao';

export interface AbaAlvo {
  id: number;
  url: string | undefined;
}

/**
 * Tudo o que a interface usa de `chrome.*`, atrás de uma classe injetável para
 * que os componentes sejam testados sem o navegador.
 */
export abstract class PonteExtensao {
  /** Envia um comando ao service worker. */
  abstract enviar(comando: ComandoInterface): Promise<RespostaComando>;
  /** Assina as visões publicadas pelo service worker. Devolve a função que cancela a assinatura. */
  abstract aoReceberVisao(ouvinte: (visao: VisaoSessao) => void): () => void;
  /** Aba que será analisada, ou `null` se não foi possível identificá-la. */
  abstract abaAlvo(): Promise<AbaAlvo | null>;
  abstract lerSelecao(contexto: ContextoSelecao): Promise<Selecao>;
  abstract salvarSelecao(contexto: ContextoSelecao, selecao: Selecao): Promise<void>;
  abstract abrirRelatorio(): void;
}

@Injectable()
export class PonteChrome extends PonteExtensao {
  override enviar(comando: ComandoInterface): Promise<RespostaComando> {
    return chrome.runtime.sendMessage<ComandoInterface, RespostaComando>(comando);
  }

  override aoReceberVisao(ouvinte: (visao: VisaoSessao) => void): () => void {
    const receber = (mensagem: unknown): void => {
      const evento = mensagem as Partial<EventoParaInterface> | null;
      if (evento?.tipo === 'visao' && evento.visao) ouvinte(evento.visao);
    };
    chrome.runtime.onMessage.addListener(receber);
    return () => chrome.runtime.onMessage.removeListener(receber);
  }

  /**
   * No side panel, a aba alvo é a aba ativa da janela. Quando o painel é aberto
   * em uma aba própria (`index.html?aba=<id>#/painel`), o parâmetro `aba` diz
   * qual analisar; os testes de integração usam esse caminho.
   */
  override async abaAlvo(): Promise<AbaAlvo | null> {
    try {
      const pedida = Number(new URLSearchParams(location.search).get('aba'));
      const aba =
        Number.isInteger(pedida) && pedida > 0
          ? await chrome.tabs.get(pedida)
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      return aba?.id === undefined ? null : { id: aba.id, url: aba.url };
    } catch {
      return null;
    }
  }

  override lerSelecao(contexto: ContextoSelecao): Promise<Selecao> {
    return lerSelecao(chrome.storage.local, contexto);
  }

  override salvarSelecao(contexto: ContextoSelecao, selecao: Selecao): Promise<void> {
    return salvarSelecao(chrome.storage.local, contexto, selecao);
  }

  override abrirRelatorio(): void {
    void chrome.tabs.create({ url: chrome.runtime.getURL('index.html#/relatorio') });
  }
}
