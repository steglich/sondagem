/**
 * Service worker da Sondagem.
 *
 * Liga os eventos do Chrome à orquestração da sessão (`sessao.ts`). Não injeta
 * código nem inicia medições por conta própria: uma sessão só começa com o
 * comando `iniciar`, enviado pela interface depois da confirmação do usuário.
 */
import {
  type ComandoInterface,
  type EstadoSessao,
  type EventoParaInterface,
  type MensagemDaPagina,
  NOME_PORTA_PAGINA,
} from '../shared/types.ts';
import { outrasExtensoesAtivas } from '../shared/extensoes.ts';
import { lerConfiguracao } from '../storage/configuracao.ts';
import { idsDeReferencia } from '../storage/linha-de-base.ts';
import { listarPerfis } from '../storage/perfis.ts';
import { criarRepositorio } from '../storage/repository.ts';
import { type TransporteCdp, criarConexaoCdp } from './cdp.ts';
import { criarOrquestrador } from './sessao.ts';

const CHAVE_ESTADO = 'sondagem:sessao';
const ARQUIVO_INJETADO = 'injected.js';
/**
 * Só para os testes de integração: o Playwright é um cliente de depuração de toda
 * página que controla, e sem esta chave a consulta prévia bloquearia toda análise
 * com debugger. Não tem interface; ver o design da fase 2.
 */
const CHAVE_IGNORAR_DEPURADOR = 'sondagem:teste:ignorar-depurador-anexado';

/** Único ponto que toca `chrome.debugger`. */
const transporteCdp: TransporteCdp = {
  async alvoJaDepurado(idAba) {
    const itens = await chrome.storage.local.get(CHAVE_IGNORAR_DEPURADOR);
    if (itens[CHAVE_IGNORAR_DEPURADOR] === true) return false;
    const alvos = await chrome.debugger.getTargets();
    return alvos.some((alvo) => alvo.tabId === idAba && alvo.attached);
  },
  anexar: (idAba, versao) => chrome.debugger.attach({ tabId: idAba }, versao),
  desanexar: (idAba) => chrome.debugger.detach({ tabId: idAba }),
  enviar: (idAba, metodo, parametros) => chrome.debugger.sendCommand({ tabId: idAba }, metodo, parametros),
  aoEvento(ouvinte) {
    const receber = (origem: chrome.debugger.Debuggee, metodo: string, parametros?: object): void => {
      if (origem.tabId !== undefined) ouvinte(origem.tabId, metodo, parametros);
    };
    chrome.debugger.onEvent.addListener(receber);
    return () => chrome.debugger.onEvent.removeListener(receber);
  },
  aoDesanexar(ouvinte) {
    const receber = (origem: chrome.debugger.Debuggee, motivo: string): void => {
      if (origem.tabId !== undefined) ouvinte(origem.tabId, motivo);
    };
    chrome.debugger.onDetach.addListener(receber);
    return () => chrome.debugger.onDetach.removeListener(receber);
  },
};

const orquestrador = criarOrquestrador({
  async lerEstado() {
    const itens = await chrome.storage.session.get(CHAVE_ESTADO);
    return itens[CHAVE_ESTADO] as EstadoSessao | undefined;
  },
  gravarEstado: (estado) => chrome.storage.session.set({ [CHAVE_ESTADO]: estado }),
  async urlDaAba(idAba) {
    try {
      return (await chrome.tabs.get(idAba)).url;
    } catch {
      return null;
    }
  },
  registrarScript: (id, padroes) =>
    chrome.scripting.registerContentScripts([
      {
        id,
        js: [ARQUIVO_INJETADO],
        matches: padroes,
        runAt: 'document_start',
        world: 'ISOLATED',
        // Reiniciar o navegador nunca pode trazer o script de volta.
        persistAcrossSessions: false,
      },
    ]),
  async removerScripts(ids) {
    const registrados = await chrome.scripting.getRegisteredContentScripts(ids ? { ids } : undefined);
    if (registrados.length === 0) return 0;
    await chrome.scripting.unregisterContentScripts({ ids: registrados.map((script) => script.id) });
    return registrados.length;
  },
  async injetar(idAba) {
    await chrome.scripting.executeScript({ target: { tabId: idAba }, files: [ARQUIVO_INJETADO], world: 'ISOLATED' });
  },
  publicar(visao) {
    const evento: EventoParaInterface = { tipo: 'visao', visao };
    // Sem interface aberta não há quem receba, e o envio rejeita: é esperado.
    chrome.runtime.sendMessage(evento).catch(() => undefined);
  },
  agora: Date.now,
  criarCdp: () => criarConexaoCdp(transporteCdp),
  async soltarDepurador(idAba) {
    try {
      await chrome.debugger.detach({ tabId: idAba });
      return true;
    } catch {
      return false;
    }
  },
  repositorio: criarRepositorio(),
  lerPerfis: () => listarPerfis(chrome.storage.local),
  lerConfiguracao: () => lerConfiguracao(chrome.storage.local),
  lerProtegidos: () => idsDeReferencia(chrome.storage.local),
  // Só o nome e o estado de cada extensão são lidos, para registrar no resultado.
  outrasExtensoes: async () => outrasExtensoesAtivas(await chrome.management.getAll(), chrome.runtime.id),
  navegador() {
    const userAgent = navigator.userAgent;
    return { versao: /Chrom(?:e|ium)\/([\d.]+)/.exec(userAgent)?.[1] ?? 'desconhecida', userAgent };
  },
});

// Ao acordar (instalação, início do navegador ou depois de suspenso), confere o estado gravado.
void orquestrador.recuperar();

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((erro: unknown) => console.error('Sondagem: falha ao configurar o side panel', erro));

const TIPOS_DE_COMANDO: readonly string[] = [
  'obter-visao',
  'iniciar',
  'parar',
  'cancelar',
  'tirar-snapshot',
] satisfies ComandoInterface['tipo'][];

function ehComando(mensagem: unknown): mensagem is ComandoInterface {
  const tipo = (mensagem as { tipo?: unknown } | null)?.tipo;
  return typeof tipo === 'string' && TIPOS_DE_COMANDO.includes(tipo);
}

chrome.runtime.onMessage.addListener((mensagem: unknown, remetente, responder) => {
  // Comandos só valem quando vêm de uma página da própria extensão.
  const daInterface = remetente.id === chrome.runtime.id && remetente.url?.startsWith(chrome.runtime.getURL(''));
  if (!daInterface || !ehComando(mensagem)) return false;
  void orquestrador
    .comando(mensagem)
    .then(responder)
    .catch((erro: unknown) => console.error('Sondagem: comando falhou', erro));
  return true;
});

chrome.runtime.onConnect.addListener((porta) => {
  if (porta.name !== NOME_PORTA_PAGINA) return;
  orquestrador.portaConectada({
    idAba: porta.sender?.tab?.id,
    idQuadro: porta.sender?.frameId,
    enviar: (mensagem) => porta.postMessage(mensagem),
    desconectar: () => porta.disconnect(),
    aoReceber: (ouvinte) => porta.onMessage.addListener((mensagem: MensagemDaPagina) => ouvinte(mensagem)),
    aoDesconectar: (ouvinte) => porta.onDisconnect.addListener(() => ouvinte()),
  });
});

chrome.tabs.onRemoved.addListener((idAba) => void orquestrador.abaRemovida(idAba));
