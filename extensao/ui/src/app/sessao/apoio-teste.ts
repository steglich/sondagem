import type {
  ComandoInterface,
  ContextoSelecao,
  RespostaComando,
  ResultadoSessao,
  Selecao,
  StatusResumido,
  VisaoSessao,
} from '../../../../shared/types';
import { selecaoPadrao } from '../../../../shared/verificacoes';
import { type AbaAlvo, PonteExtensao } from './ponte';

export const URL_TESTE = 'http://localhost:4300/cpu-pesada';

export const VISAO_OCIOSA: VisaoSessao = {
  fase: 'ociosa',
  alvo: null,
  selecao: [],
  inicio: null,
  status: null,
  resultado: null,
};

export function visaoAtiva(status: Partial<StatusResumido> = {}): VisaoSessao {
  return {
    fase: 'ativa',
    alvo: { idAba: 5, url: URL_TESTE },
    selecao: ['processamento', 'carregamento'],
    inicio: 1000,
    status: { longTasks: 0, interacoes: 0, piorLongTask: null, carregamentos: 1, ...status },
    resultado: null,
  };
}

export const RESULTADO_FIXO: ResultadoSessao = {
  tipo: 'sessao-manual',
  desfecho: 'concluida',
  url: URL_TESTE,
  selecao: ['processamento', 'carregamento'],
  inicio: 1000,
  fim: 13_500,
  dados: {
    longTasks: [
      { inicio: 3000, duracao: 312.4 },
      { inicio: 6500, duracao: 75 },
    ],
    interacoes: [
      {
        id: 41,
        documento: 'doc-1',
        inicio: 2990,
        duracao: 328,
        tipo: 'click',
        alvo: 'button[data-testid="acao-pesada"]',
      },
    ],
    documentos: [{ id: 'doc-1', url: URL_TESTE, inicio: 900, metricas: { FCP: 120, CLS: 0, TTFB: 35.5, INP: 328 } }],
  },
  limpeza: [
    { recurso: 'script-registrado', quantidade: 1 },
    { recurso: 'observador', quantidade: 7 },
    { recurso: 'listener', quantidade: 5 },
    { recurso: 'porta', quantidade: 1 },
    { recurso: 'temporizador', quantidade: 2 },
  ],
  paginaRespondeu: true,
};

/** Ponte em memória: faz o papel do service worker e do `chrome.storage.local`. */
export class PonteSimulada extends PonteExtensao {
  visao: VisaoSessao = VISAO_OCIOSA;
  aba: AbaAlvo | null = { id: 5, url: URL_TESTE };
  comandos: ComandoInterface[] = [];
  relatoriosAbertos = 0;
  /** Resposta forçada para o próximo comando `iniciar`. */
  recusaAoIniciar: Extract<RespostaComando, { ok: false }> | null = null;
  readonly selecoes = new Map<ContextoSelecao, Selecao>();
  private readonly ouvintes = new Set<(visao: VisaoSessao) => void>();

  override async enviar(comando: ComandoInterface): Promise<RespostaComando> {
    this.comandos.push(comando);
    if (comando.tipo === 'iniciar') {
      if (this.recusaAoIniciar) return this.recusaAoIniciar;
      this.visao = { ...visaoAtiva(), selecao: comando.selecao };
    } else if (comando.tipo === 'parar' || comando.tipo === 'cancelar') {
      const desfecho = comando.tipo === 'parar' ? 'concluida' : 'cancelada';
      this.visao = { ...VISAO_OCIOSA, resultado: { ...RESULTADO_FIXO, desfecho } };
    }
    return { ok: true, visao: this.visao };
  }

  override aoReceberVisao(ouvinte: (visao: VisaoSessao) => void): () => void {
    this.ouvintes.add(ouvinte);
    return () => this.ouvintes.delete(ouvinte);
  }

  override async abaAlvo(): Promise<AbaAlvo | null> {
    return this.aba;
  }

  override async lerSelecao(contexto: ContextoSelecao): Promise<Selecao> {
    return this.selecoes.get(contexto) ?? selecaoPadrao();
  }

  override async salvarSelecao(contexto: ContextoSelecao, selecao: Selecao): Promise<void> {
    this.selecoes.set(contexto, [...selecao]);
  }

  override abrirRelatorio(): void {
    this.relatoriosAbertos++;
  }

  /** Publica uma visão, como o service worker faria. */
  publicar(visao: VisaoSessao): void {
    this.visao = visao;
    this.ouvintes.forEach((ouvinte) => ouvinte(visao));
  }

  get assinantes(): number {
    return this.ouvintes.size;
  }
}
