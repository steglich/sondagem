import type { Cenario } from '../../../../shared/cenario';
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
  execucao: null,
  resultado: null,
};

export function visaoAtiva(status: Partial<StatusResumido> = {}): VisaoSessao {
  return {
    fase: 'ativa',
    alvo: { idAba: 5, url: URL_TESTE },
    selecao: ['processamento', 'carregamento'],
    inicio: 1000,
    status: { longTasks: 0, interacoes: 0, piorLongTask: null, carregamentos: 1, errosPagina: 0, ...status },
    execucao: null,
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
    errosPagina: [],
  },
  limpeza: [
    { recurso: 'script-registrado', quantidade: 1 },
    { recurso: 'observador', quantidade: 7 },
    { recurso: 'listener', quantidade: 5 },
    { recurso: 'porta', quantidade: 1 },
    { recurso: 'temporizador', quantidade: 2 },
  ],
  paginaRespondeu: true,
  conexaoPerdida: null,
  cenario: null,
};

export const CENARIO_TESTE: Cenario = {
  versao_esquema: 1,
  nome: 'abrir-fechar',
  url_inicial: 'http://localhost:4300/limpa',
  execucao: { iteracoes: 20, throttling: 'padrao' },
  passos: [
    {
      tipo: 'repetir',
      vezes: 'iteracoes',
      passos: [
        { tipo: 'clicar', seletor: "[data-testid='abrir-componente']" },
        { tipo: 'clicar', seletor: "[data-testid='fechar-componente']" },
      ],
    },
  ],
};

/** Execução de 20 iterações, uma delas com passo pulado, e dois erros da página. */
export const RESULTADO_CENARIO_FIXO: ResultadoSessao = {
  tipo: 'cenario',
  desfecho: 'concluida',
  url: CENARIO_TESTE.url_inicial,
  selecao: ['processamento', 'erros-pagina'],
  inicio: 1000,
  fim: 31_000,
  dados: {
    longTasks: [{ inicio: 3000, duracao: 120, iteracao: 1 }],
    interacoes: [],
    documentos: [],
    errosPagina: [
      { tipo: 'excecao', mensagem: 'Error: falha de propósito', arquivo: 'http://localhost:4300/erros.ts', linha: 12, coluna: 9, instante: 6000, iteracao: 5 },
      { tipo: 'rejeicao', mensagem: 'pedido recusado', arquivo: null, linha: null, coluna: null, instante: 9500, iteracao: null },
    ],
  },
  limpeza: [
    { recurso: 'script-registrado', quantidade: 1 },
    { recurso: 'depurador', quantidade: 1 },
  ],
  paginaRespondeu: true,
  conexaoPerdida: null,
  cenario: {
    configuracao: { nome: 'abrir-fechar', urlInicial: CENARIO_TESTE.url_inicial, iteracoes: 20, throttling: 'padrao', versaoBuild: '1.4.2' },
    estadoFinal: 'concluida',
    ambiente: { versaoNavegador: '158.0.8127.18', userAgent: 'Mozilla/5.0 Chrome/158.0.0.0', janela: { largura: 1280, altura: 720 }, dpr: 2 },
    iteracoes: [],
    iteracoesCompletas: 19,
    iteracoesIncompletas: 1,
    passosExecutados: 39,
    falhas: [
      { caminho: '/passos/0/passos/1', tipoPasso: 'clicar', iteracao: 4, motivo: 'Tempo limite de 200 ms: nenhum elemento corresponde a "#x".', acao: 'pulou' },
    ],
    estatisticas: [
      { id: 'duracao-iteracao', amostras: 19, mediana: 1400, p75: 1450.5, p95: 1600 },
      { id: 'tempo-long-tasks', amostras: 19, mediana: 0, p75: 60, p95: 118.25 },
      { id: 'pior-interacao', amostras: 0, mediana: null, p75: null, p95: null },
    ],
  },
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
  readonly cenarios = new Map<string, Cenario>();
  cenarioSelecionado: string | null = null;
  private readonly ouvintes = new Set<(visao: VisaoSessao) => void>();

  override async enviar(comando: ComandoInterface): Promise<RespostaComando> {
    this.comandos.push(comando);
    if (comando.tipo === 'iniciar') {
      if (this.recusaAoIniciar) return this.recusaAoIniciar;
      this.visao = {
        ...visaoAtiva(),
        selecao: comando.selecao,
        execucao: comando.cenario
          ? { nome: (comando.cenario.definicao as Cenario).nome, estado: 'preparando', iteracao: 0, totalIteracoes: comando.cenario.iteracoes ?? 5 }
          : null,
      };
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
    return this.selecoes.get(contexto) ?? selecaoPadrao(contexto !== 'manual');
  }

  override async salvarSelecao(contexto: ContextoSelecao, selecao: Selecao): Promise<void> {
    this.selecoes.set(contexto, [...selecao]);
  }

  override abrirRelatorio(): void {
    this.relatoriosAbertos++;
  }

  override async listarCenarios(): Promise<Cenario[]> {
    return [...this.cenarios.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  }

  override async salvarCenario(cenario: Cenario): Promise<void> {
    this.cenarios.set(cenario.nome, cenario);
  }

  override async removerCenario(nome: string): Promise<void> {
    this.cenarios.delete(nome);
    if (this.cenarioSelecionado === nome) this.cenarioSelecionado = null;
  }

  override async lerCenarioSelecionado(): Promise<string | null> {
    return this.cenarioSelecionado;
  }

  override async selecionarCenario(nome: string | null): Promise<void> {
    this.cenarioSelecionado = nome;
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
