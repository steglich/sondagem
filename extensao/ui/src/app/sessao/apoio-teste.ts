import type { Cenario } from '../../../../shared/cenario';
import { dadosVazios } from '../../../../shared/agregacao';
import { type PerfilThrottling, SEM_CONDICOES } from '../../../../shared/condicoes';
import { CONFIGURACAO_PADRAO, type ConfiguracaoArmazenamento, type RegistroExecucao, registroFinal } from '../../../../shared/historico';
import type {
  ComandoInterface,
  ContextoSelecao,
  ExtensaoAtiva,
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
    status: { longTasks: 0, interacoes: 0, piorLongTask: null, carregamentos: 1, errosPagina: 0, heapUsado: null, snapshots: 0, cpu: null, ...status },
    execucao: null,
    resultado: null,
  };
}

export const RESULTADO_FIXO: ResultadoSessao = {
  id: 'manual-1',
  tipo: 'sessao-manual',
  desfecho: 'concluida',
  url: URL_TESTE,
  selecao: ['processamento', 'carregamento'],
  inicio: 1000,
  fim: 13_500,
  dados: {
    ...dadosVazios(),
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
  memoria: null,
  condicoes: SEM_CONDICOES,
  extensoes: [],
  navegador: { versao: '158.0.8127.18', userAgent: 'Mozilla/5.0 Chrome/158.0.0.0' },
  truncado: [],
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
  id: 'cenario-1',
  tipo: 'cenario',
  desfecho: 'concluida',
  url: CENARIO_TESTE.url_inicial,
  selecao: ['processamento', 'erros-pagina'],
  inicio: 1000,
  fim: 31_000,
  dados: {
    ...dadosVazios(),
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
    falhaDeSessao: null,
    estatisticas: [
      { id: 'duracao-iteracao', amostras: 19, mediana: 1400, p75: 1450.5, p95: 1600 },
      { id: 'tempo-long-tasks', amostras: 19, mediana: 0, p75: 60, p95: 118.25 },
      { id: 'pior-interacao', amostras: 0, mediana: null, p75: null, p95: null },
    ],
  },
  memoria: null,
  condicoes: {
    perfil: 'padrao',
    cpu: 4,
    rede: { latenciaMs: 150, downloadKbps: 1600, uploadKbps: 750 },
    cacheDesligado: true,
    cacheLimpo: true,
    storageLimpo: [],
  },
  extensoes: [],
  navegador: { versao: '158.0.8127.18', userAgent: 'Mozilla/5.0 Chrome/158.0.0.0' },
  truncado: [],
};

/** Registro do histórico a partir de um resultado, com os campos que o teste quiser trocar. */
export function registroDe(resultado: ResultadoSessao, parcial: Partial<RegistroExecucao> = {}): RegistroExecucao {
  const registro = registroFinal(resultado, null, Infinity).registro;
  return { ...registro, ...parcial, resumo: registro.resumo ? { ...registro.resumo, id: parcial.id ?? registro.id } : null };
}

const KB = 1024;

/**
 * Cenário de vazamento de DOM com "Memória" e "DOM e listeners": 6 iterações, heap
 * subindo 60 KB por iteração, censos de início e fim e 22 construtores na comparação.
 */
export const RESULTADO_MEMORIA_FIXO: ResultadoSessao = {
  ...RESULTADO_CENARIO_FIXO,
  selecao: ['memoria', 'dom-listeners'],
  dados: {
    ...dadosVazios(),
    medicoes: Array.from({ length: 6 }, (_, i) => ({
      instante: 2000 + i * 1000,
      heapUsado: 2000 * KB + i * 60 * KB,
      nosDom: 850 + i * 404,
      listeners: 15,
      iteracao: i + 1,
    })),
    snapshots: [
      { rotulo: 'inicio', instante: 1500, iteracao: null, totalObjetos: 1434, construtores: [], outros: null },
      { rotulo: 'fim', instante: 9000, iteracao: null, totalObjetos: 2652, construtores: [], outros: null },
    ],
    contadoresDom: { inicio: { nosDom: 850, listeners: 15, nosDesanexados: 203 }, fim: { nosDom: 3274, listeners: 15, nosDesanexados: 1421 } },
  },
  memoria: {
    classificacao: 'vazamento-provavel',
    series: [
      {
        metrica: 'heap_usado',
        pontos: Array.from({ length: 6 }, (_, i) => ({ iteracao: i + 1, valor: 2000 * KB + i * 60 * KB })),
        crescimentoMedio: 60 * KB,
        transicoesCrescentes: 5,
        classificacao: 'vazamento-provavel',
      },
      {
        metrica: 'nos_dom',
        pontos: Array.from({ length: 6 }, (_, i) => ({ iteracao: i + 1, valor: 850 + i * 404 })),
        crescimentoMedio: 404,
        transicoesCrescentes: 5,
        classificacao: 'vazamento-provavel',
      },
      {
        metrica: 'listeners',
        pontos: Array.from({ length: 6 }, (_, i) => ({ iteracao: i + 1, valor: 15 })),
        crescimentoMedio: 0,
        transicoesCrescentes: 0,
        classificacao: 'sem-indicio',
      },
    ],
    comparacao: {
      de: 'inicio',
      para: 'fim',
      construtores: [
        { nome: 'HTMLLIElement', situacao: 'ambos', contagem: { antes: 200, depois: 1400, variacao: 1200 } },
        // 20 construtores que cresceram cada vez menos, um novo entre eles, e um que diminuiu.
        ...Array.from({ length: 20 }, (_, i) => ({
          nome: `Classe${i + 1}`,
          situacao: i === 0 ? ('novo' as const) : ('ambos' as const),
          contagem: { antes: i === 0 ? 0 : 10, depois: 30 - i, variacao: i === 0 ? 30 : 20 - i },
        })),
        { nome: 'Temporario', situacao: 'removido', contagem: { antes: 5, depois: 0, variacao: -5 } },
      ],
    },
    domListeners: {
      nosDesanexados: { antes: 203, depois: 1421, variacao: 1218 },
      listeners: { antes: 15, depois: 15, variacao: 0 },
    },
  },
};

/** Ponte em memória: faz o papel do service worker e do `chrome.storage.local`. */
/** Sessão manual com "CPU": 35 funções no resumo (a interface lista 30) e mais 12 em "outras". */
export const RESULTADO_CPU_FIXO: ResultadoSessao = {
  ...RESULTADO_FIXO,
  selecao: ['processamento', 'cpu'],
  dados: {
    ...RESULTADO_FIXO.dados,
    cpu: {
      estado: 'concluida',
      ativo: true,
      falha: null,
      incompleto: false,
      limiteAtingido: false,
      resumo: {
        tempoAmostrado: 2000,
        tempoAtivo: 500,
        amostras: 12_000,
        categorias: { ocioso: 1500, coletaDeLixo: 20, programa: 50, extensoes: 10 },
        funcoes: [
          { nome: 'calculoPesado', arquivo: `${URL_TESTE}.ts`, linha: 4, coluna: 23, tempoProprio: 300, tempoTotal: 310.5, percentual: 60 },
          { nome: '(anônima)', arquivo: `${URL_TESTE}.ts`, linha: 15, coluna: 34, tempoProprio: 40, tempoTotal: 350.5, percentual: 8 },
          { nome: 'sort', arquivo: null, linha: null, coluna: null, tempoProprio: 12.25, tempoTotal: 12.25, percentual: 2.45 },
          ...Array.from({ length: 32 }, (_, i) => ({
            nome: `auxiliar${i + 1}`,
            arquivo: 'http://localhost:4300/comum.ts',
            linha: i + 1,
            coluna: 1,
            tempoProprio: 1,
            tempoTotal: 1,
            percentual: 0.2,
          })),
        ],
        outras: { quantidade: 12, tempoProprio: 3, percentual: 0.6 },
      },
    },
  },
};

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
  readonly perfis = new Map<string, PerfilThrottling>();
  extensoes: ExtensaoAtiva[] = [];
  /** Histórico: o registro de cada execução e, se houver, o resultado completo. */
  historico: RegistroExecucao[] = [];
  readonly resultados = new Map<string, ResultadoSessao>();
  configuracao: ConfiguracaoArmazenamento = CONFIGURACAO_PADRAO;
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
    } else if (comando.tipo === 'tirar-snapshot') {
      const status = this.visao.status;
      if (status) this.visao = { ...this.visao, status: { ...status, snapshots: status.snapshots + 1 } };
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

  override async listarPerfis(): Promise<PerfilThrottling[]> {
    return [...this.perfis.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  }

  override async salvarPerfil(perfil: PerfilThrottling): Promise<void> {
    this.perfis.set(perfil.nome, perfil);
  }

  override async removerPerfil(nome: string): Promise<void> {
    this.perfis.delete(nome);
  }

  override async outrasExtensoes(): Promise<ExtensaoAtiva[]> {
    return this.extensoes;
  }

  override async listarHistorico(): Promise<RegistroExecucao[]> {
    return [...this.historico].sort((a, b) => b.inicio - a.inicio);
  }

  override async lerResultado(id: string): Promise<ResultadoSessao | null> {
    return this.resultados.get(id) ?? null;
  }

  override async removerExecucao(id: string): Promise<void> {
    this.historico = this.historico.filter((registro) => registro.id !== id);
    this.resultados.delete(id);
  }

  override async lerConfiguracaoArmazenamento(): Promise<ConfiguracaoArmazenamento> {
    return this.configuracao;
  }

  override async salvarConfiguracaoArmazenamento(configuracao: ConfiguracaoArmazenamento): Promise<void> {
    this.configuracao = configuracao;
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
