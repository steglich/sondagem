import { Injectable } from '@angular/core';
import type { Cenario } from '../../../../shared/cenario';
import type { PerfilThrottling } from '../../../../shared/condicoes';
import { outrasExtensoesAtivas } from '../../../../shared/extensoes';
import { type ConfiguracaoArmazenamento, type RegistroExecucao, resultadoDoRegistro } from '../../../../shared/historico';
import type {
  ComandoInterface,
  ContextoSelecao,
  EventoParaInterface,
  ExtensaoAtiva,
  RespostaComando,
  ResultadoSessao,
  Selecao,
  VisaoSessao,
} from '../../../../shared/types';
import {
  lerCenarioSelecionado,
  listarCenarios,
  removerCenario,
  salvarCenario,
  selecionarCenario,
} from '../../../../storage/cenarios';
import { lerConfiguracao, salvarConfiguracao } from '../../../../storage/configuracao';
import { listarPerfis, removerPerfil, salvarPerfil } from '../../../../storage/perfis';
import { type RepositorioResultados, criarRepositorio } from '../../../../storage/repository';
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
  /** Cenários salvos na extensão, em ordem alfabética. */
  abstract listarCenarios(): Promise<Cenario[]>;
  /** Salva um cenário já validado; outro com o mesmo nome é substituído. */
  abstract salvarCenario(cenario: Cenario): Promise<void>;
  abstract removerCenario(nome: string): Promise<void>;
  /** Nome do cenário escolhido para a próxima análise, ou `null` (sessão manual). */
  abstract lerCenarioSelecionado(): Promise<string | null>;
  abstract selecionarCenario(nome: string | null): Promise<void>;
  /** Perfis de throttling salvos pelo usuário, em ordem alfabética. */
  abstract listarPerfis(): Promise<PerfilThrottling[]>;
  /** Salva um perfil já conferido; outro com o mesmo nome é substituído. */
  abstract salvarPerfil(perfil: PerfilThrottling): Promise<void>;
  abstract removerPerfil(nome: string): Promise<void>;
  /** Outras extensões ativas no perfil do navegador. Lista vazia se não foi possível consultar. */
  abstract outrasExtensoes(): Promise<ExtensaoAtiva[]>;
  /** Execuções do histórico, da mais recente para a mais antiga, sem os detalhes. */
  abstract listarHistorico(): Promise<RegistroExecucao[]>;
  /** Resultado completo de uma execução do histórico, ou `null` se ela não existe ou não terminou. */
  abstract lerResultado(id: string): Promise<ResultadoSessao | null>;
  abstract removerExecucao(id: string): Promise<void>;
  abstract lerConfiguracaoArmazenamento(): Promise<ConfiguracaoArmazenamento>;
  abstract salvarConfiguracaoArmazenamento(configuracao: ConfiguracaoArmazenamento): Promise<void>;
}

@Injectable()
export class PonteChrome extends PonteExtensao {
  /** O histórico é lido direto do IndexedDB, que a interface divide com o service worker. */
  private readonly repositorio: RepositorioResultados = criarRepositorio();

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

  override listarCenarios(): Promise<Cenario[]> {
    return listarCenarios(chrome.storage.local);
  }

  override salvarCenario(cenario: Cenario): Promise<void> {
    return salvarCenario(chrome.storage.local, cenario);
  }

  override removerCenario(nome: string): Promise<void> {
    return removerCenario(chrome.storage.local, nome);
  }

  override lerCenarioSelecionado(): Promise<string | null> {
    return lerCenarioSelecionado(chrome.storage.local);
  }

  override selecionarCenario(nome: string | null): Promise<void> {
    return selecionarCenario(chrome.storage.local, nome);
  }

  override listarPerfis(): Promise<PerfilThrottling[]> {
    return listarPerfis(chrome.storage.local);
  }

  override salvarPerfil(perfil: PerfilThrottling): Promise<void> {
    return salvarPerfil(chrome.storage.local, perfil);
  }

  override removerPerfil(nome: string): Promise<void> {
    return removerPerfil(chrome.storage.local, nome);
  }

  override async outrasExtensoes(): Promise<ExtensaoAtiva[]> {
    try {
      return outrasExtensoesAtivas(await chrome.management.getAll(), chrome.runtime.id);
    } catch {
      return [];
    }
  }

  override listarHistorico(): Promise<RegistroExecucao[]> {
    return this.repositorio.listar();
  }

  override async lerResultado(id: string): Promise<ResultadoSessao | null> {
    const guardada = await this.repositorio.ler(id);
    return guardada ? resultadoDoRegistro(guardada) : null;
  }

  override removerExecucao(id: string): Promise<void> {
    return this.repositorio.remover(id);
  }

  override lerConfiguracaoArmazenamento(): Promise<ConfiguracaoArmazenamento> {
    return lerConfiguracao(chrome.storage.local);
  }

  override salvarConfiguracaoArmazenamento(configuracao: ConfiguracaoArmazenamento): Promise<void> {
    return salvarConfiguracao(chrome.storage.local, configuracao);
  }
}
