/**
 * Histórico de análises: o formato do que é guardado, os limites de tamanho, a
 * retenção e a conversão entre o resultado e o registro. Funções puras; quem lê e
 * grava é `storage/repository.ts`.
 *
 * Cada análise vira dois registros com o mesmo `id`: o `RegistroExecucao`
 * (metadados e estatísticas, leve, usado para listar) e os `DetalhesExecucao`
 * (as listas grandes). Só resumos são guardados: não há heap snapshot nem perfil
 * de CPU bruto em nenhum dos dois.
 */
import type { Cenario } from './cenario.ts';
import { chaveDasCondicoes } from './condicoes.ts';
import { concluir } from './sessao-estado.ts';
import {
  type Ambiente,
  type AndamentoExecucao,
  CONTEXTO_MANUAL,
  type CondicoesDeTeste,
  type ConfiguracaoExecucao,
  type DadosColetados,
  type Desfecho,
  type ExtensaoAtiva,
  type ListaTruncavel,
  type Navegador,
  type ResultadoSessao,
  type Selecao,
  type SessaoEmAndamento,
  type TipoAnalise,
  contextoDoCenario,
} from './types.ts';

export type EstadoRegistro = 'em-andamento' | Desfecho;

/** O resultado sem as listas detalhadas, que ficam em `DetalhesExecucao`. */
export type ResumoResultado = Omit<ResultadoSessao, 'dados'>;

/** Versão do formato do registro e dos detalhes. Sobe quando o que é guardado muda de forma incompatível. */
export const VERSAO_DO_FORMATO = 1;

export interface RegistroExecucao {
  id: string;
  /** Versão do formato em que foi gravado; ausente nos registros anteriores ao campo, que são da versão 1. */
  versaoFormato?: number;
  tipo: TipoAnalise;
  estado: EstadoRegistro;
  /** Agrupa as execuções do mesmo cenário (`cenario:<nome>`) ou as sessões manuais (`manual`). */
  grupo: string;
  nomeCenario: string | null;
  url: string;
  /** Data da análise, em ms desde a época. */
  inicio: number;
  fim: number | null;
  selecao: Selecao;
  /** Versão do build da aplicação, informada pelo usuário. */
  versaoBuild: string | null;
  navegador: Navegador | null;
  ambiente: Ambiente | null;
  condicoes: CondicoesDeTeste;
  /** Condições em texto, para achar execuções comparáveis. */
  chaveCondicoes: string;
  extensoes: ExtensaoAtiva[];
  /** Cenário executado, sem os textos digitados no login. */
  definicao: Cenario | null;
  configuracao: ConfiguracaoExecucao | null;
  /** Andamento gravado ao fim de cada iteração; `null` depois de terminada. */
  andamento: AndamentoExecucao | null;
  /** `null` enquanto a análise está em andamento. */
  resumo: ResumoResultado | null;
  /** Tamanho estimado do registro mais os detalhes, em bytes. */
  tamanho: number;
  truncado: ListaTruncavel[];
}

export interface DetalhesExecucao {
  id: string;
  dados: DadosColetados;
}

export interface ExecucaoGuardada {
  registro: RegistroExecucao;
  dados: DadosColetados;
}

// ---------------------------------------------------------------------------
// Limites e retenção
// ---------------------------------------------------------------------------

export interface PoliticaRetencao {
  /** Quantas execuções manter por cenário; `null`: sem limite de quantidade. */
  maximoPorCenario: number | null;
  /** Idade máxima em dias; `null`: sem limite de idade. */
  idadeMaximaDias: number | null;
}

export interface ConfiguracaoArmazenamento {
  limiteExecucaoMb: number;
  limiteHistoricoMb: number;
  retencao: PoliticaRetencao;
  /** Coeficiente de variação, em %, acima do qual uma métrica é sinalizada como instável. */
  limiteVariacao: number;
}

export const CONFIGURACAO_PADRAO: ConfiguracaoArmazenamento = {
  limiteExecucaoMb: 20,
  limiteHistoricoMb: 500,
  retencao: { maximoPorCenario: 50, idadeMaximaDias: null },
  limiteVariacao: 10,
};

/** A partir desta fração do limite do histórico a interface avisa. */
export const FRACAO_DE_AVISO = 0.8;

const MB = 1024 * 1024;

function positivo(valor: unknown, padrao: number): number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? valor : padrao;
}

function inteiroOuNulo(valor: unknown, padrao: number | null): number | null {
  if (valor === null) return null;
  return typeof valor === 'number' && Number.isInteger(valor) && valor > 0 ? valor : padrao;
}

/** Completa com os padrões o que foi salvo (ou não) pelo usuário. */
export function normalizarConfiguracao(valor: unknown): ConfiguracaoArmazenamento {
  const v = (valor && typeof valor === 'object' ? valor : {}) as Partial<ConfiguracaoArmazenamento>;
  const retencao = (v.retencao && typeof v.retencao === 'object' ? v.retencao : {}) as Partial<PoliticaRetencao>;
  const padrao = CONFIGURACAO_PADRAO;
  return {
    limiteExecucaoMb: positivo(v.limiteExecucaoMb, padrao.limiteExecucaoMb),
    limiteHistoricoMb: positivo(v.limiteHistoricoMb, padrao.limiteHistoricoMb),
    retencao: {
      maximoPorCenario: inteiroOuNulo(retencao.maximoPorCenario, padrao.retencao.maximoPorCenario),
      idadeMaximaDias: inteiroOuNulo(retencao.idadeMaximaDias, padrao.retencao.idadeMaximaDias),
    },
    limiteVariacao: positivo(v.limiteVariacao, padrao.limiteVariacao),
  };
}

/** Tamanho estimado pelo JSON serializado. É uma aproximação: o aviso em 80% dá a margem. */
export function estimarTamanho(valor: unknown): number {
  return JSON.stringify(valor)?.length ?? 0;
}

/** Ordem em que as listas detalhadas saem quando a execução passa do limite. */
export const ORDEM_DE_TRUNCAMENTO: readonly ListaTruncavel[] = ['longTasks', 'interacoes', 'errosPagina', 'documentos', 'snapshots', 'funcoesCpu'];

function semALista(dados: DadosColetados, lista: ListaTruncavel): DadosColetados {
  if (lista === 'funcoesCpu') {
    const resumo = dados.cpu?.resumo;
    return resumo ? { ...dados, cpu: { ...dados.cpu!, resumo: { ...resumo, funcoes: [] } } } : dados;
  }
  if (lista === 'snapshots') return { ...dados, snapshots: dados.snapshots.map((s) => ({ ...s, construtores: [] })) };
  return { ...dados, [lista]: [] };
}

function temItens(dados: DadosColetados, lista: ListaTruncavel): boolean {
  if (lista === 'funcoesCpu') return (dados.cpu?.resumo?.funcoes.length ?? 0) > 0;
  if (lista === 'snapshots') return dados.snapshots.some((s) => s.construtores.length > 0);
  return dados[lista].length > 0;
}

/**
 * Reduz os detalhes até caberem em `limiteBytes`, contando `tamanhoFixo` (o
 * registro com as estatísticas, que nunca é cortado). Sai uma lista inteira por
 * vez, na ordem de `ORDEM_DE_TRUNCAMENTO`. As medições por iteração ficam sempre.
 */
export function truncarDados(
  dados: DadosColetados,
  tamanhoFixo: number,
  limiteBytes: number,
): { dados: DadosColetados; truncado: ListaTruncavel[]; tamanho: number } {
  let atual = dados;
  const truncado: ListaTruncavel[] = [];
  let tamanho = tamanhoFixo + estimarTamanho(atual);
  for (const lista of ORDEM_DE_TRUNCAMENTO) {
    if (tamanho <= limiteBytes) break;
    if (!temItens(atual, lista)) continue;
    atual = semALista(atual, lista);
    truncado.push(lista);
    tamanho = tamanhoFixo + estimarTamanho(atual);
  }
  return { dados: atual, truncado, tamanho };
}

export interface UsoDoHistorico {
  bytes: number;
  limiteBytes: number;
  /** De 0 a 1 (ou mais, se passou do limite). */
  fracao: number;
  /** `true` a partir de 80% do limite: a interface avisa e oferece a remoção de execuções antigas. */
  aviso: boolean;
  cheio: boolean;
}

export function usoDoHistorico(bytes: number, configuracao: Pick<ConfiguracaoArmazenamento, 'limiteHistoricoMb'>): UsoDoHistorico {
  const limiteBytes = configuracao.limiteHistoricoMb * MB;
  const fracao = bytes / limiteBytes;
  return { bytes, limiteBytes, fracao, aviso: fracao >= FRACAO_DE_AVISO, cheio: fracao >= 1 };
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Execuções que a política de retenção manda remover: as mais antigas além da
 * quantidade por cenário e as mais velhas que a idade máxima. Uma análise em
 * andamento nunca é removida, nem as de `protegidos` (as execuções de referência
 * das linhas de base), que também não contam para a quantidade por cenário.
 */
export function idsARemover(
  registros: readonly RegistroExecucao[],
  retencao: PoliticaRetencao,
  agora: number,
  protegidos: readonly string[] = [],
): string[] {
  const remover = new Set<string>();
  const terminados = registros.filter((r) => r.estado !== 'em-andamento' && !protegidos.includes(r.id));
  if (retencao.idadeMaximaDias !== null) {
    const corte = agora - retencao.idadeMaximaDias * DIA_MS;
    for (const registro of terminados) if (registro.inicio < corte) remover.add(registro.id);
  }
  if (retencao.maximoPorCenario !== null) {
    const porGrupo = new Map<string, RegistroExecucao[]>();
    for (const registro of terminados) porGrupo.set(registro.grupo, [...(porGrupo.get(registro.grupo) ?? []), registro]);
    for (const grupo of porGrupo.values()) {
      const maisNovosPrimeiro = [...grupo].sort((a, b) => b.inicio - a.inicio);
      for (const registro of maisNovosPrimeiro.slice(retencao.maximoPorCenario)) remover.add(registro.id);
    }
  }
  return [...remover];
}

// ---------------------------------------------------------------------------
// Resultado ↔ registro
// ---------------------------------------------------------------------------

function grupoDe(nomeCenario: string | null): string {
  return nomeCenario === null ? CONTEXTO_MANUAL : contextoDoCenario(nomeCenario);
}

/** Registro de uma análise que ainda está rodando, com o que já foi coletado. */
export function registroEmAndamento(sessao: SessaoEmAndamento): ExecucaoGuardada {
  const cenario = sessao.cenario;
  const registro: RegistroExecucao = {
    id: sessao.id,
    versaoFormato: VERSAO_DO_FORMATO,
    tipo: sessao.tipo,
    estado: 'em-andamento',
    grupo: grupoDe(cenario?.configuracao.nome ?? null),
    nomeCenario: cenario?.configuracao.nome ?? null,
    url: sessao.url,
    inicio: sessao.inicio,
    fim: null,
    selecao: sessao.selecao,
    versaoBuild: cenario?.configuracao.versaoBuild ?? null,
    navegador: sessao.navegador,
    ambiente: cenario?.andamento.ambiente ?? null,
    condicoes: sessao.condicoes,
    chaveCondicoes: chaveDasCondicoes(sessao.condicoes),
    extensoes: sessao.extensoes,
    definicao: cenario?.definicao ?? null,
    configuracao: cenario?.configuracao ?? null,
    andamento: cenario?.andamento ?? null,
    resumo: null,
    tamanho: 0,
    truncado: [],
  };
  registro.tamanho = estimarTamanho(registro) + estimarTamanho(sessao.dados);
  return { registro, dados: sessao.dados };
}

/**
 * Registro de uma análise terminada. Se passar de `limiteBytes`, as listas
 * detalhadas são cortadas e o resultado passa a dizer quais (`truncado`); as
 * estatísticas, que estão no resumo, ficam inteiras.
 */
export function registroFinal(resultado: ResultadoSessao, definicao: Cenario | null, limiteBytes: number): ExecucaoGuardada & { resultado: ResultadoSessao } {
  const { dados, ...resumo } = resultado;
  const configuracao = resultado.cenario?.configuracao ?? null;
  const registro: RegistroExecucao = {
    id: resultado.id,
    versaoFormato: VERSAO_DO_FORMATO,
    tipo: resultado.tipo,
    estado: resultado.desfecho,
    grupo: grupoDe(configuracao?.nome ?? null),
    nomeCenario: configuracao?.nome ?? null,
    url: resultado.url,
    inicio: resultado.inicio,
    fim: resultado.fim,
    selecao: resultado.selecao,
    versaoBuild: configuracao?.versaoBuild ?? null,
    navegador: resultado.navegador,
    ambiente: resultado.cenario?.ambiente ?? null,
    condicoes: resultado.condicoes,
    chaveCondicoes: chaveDasCondicoes(resultado.condicoes),
    extensoes: resultado.extensoes,
    definicao,
    configuracao,
    andamento: null,
    resumo,
    tamanho: 0,
    truncado: [],
  };
  const corte = truncarDados(dados, estimarTamanho(registro), limiteBytes);
  registro.truncado = corte.truncado;
  registro.resumo = { ...resumo, truncado: corte.truncado };
  registro.tamanho = corte.tamanho;
  return { registro, dados: corte.dados, resultado: { ...registro.resumo, dados: corte.dados } };
}

/** Remonta o resultado a partir do que foi guardado. `null` se a análise não terminou. */
export function resultadoDoRegistro(guardada: ExecucaoGuardada): ResultadoSessao | null {
  return guardada.registro.resumo ? { ...guardada.registro.resumo, dados: guardada.dados } : null;
}

/**
 * Fecha como interrompida uma análise que ficou "em andamento" (a extensão foi
 * suspensa ou o navegador fechou). O que já estava gravado é mantido.
 */
export function interromperRegistro(guardada: ExecucaoGuardada, agora: number, limiteBytes: number): ExecucaoGuardada {
  const { registro, dados } = guardada;
  const cenario =
    registro.definicao && registro.configuracao && registro.andamento
      ? { definicao: registro.definicao, configuracao: registro.configuracao, andamento: registro.andamento }
      : null;
  if (cenario && !['concluida', 'erro', 'cancelada'].includes(cenario.andamento.estado)) {
    cenario.andamento = {
      ...cenario.andamento,
      estado: 'erro',
      falhas: [
        ...cenario.andamento.falhas,
        {
          caminho: '',
          tipoPasso: '',
          iteracao: cenario.andamento.iteracoes.find((i) => i.fim === null)?.numero ?? null,
          motivo: 'A extensão foi suspensa durante a execução.',
          acao: 'interrompeu',
        },
      ],
    };
  }
  const sessao: SessaoEmAndamento = {
    id: registro.id,
    tipo: registro.tipo,
    idAba: -1,
    url: registro.url,
    selecao: registro.selecao,
    inicio: registro.inicio,
    idsScripts: [],
    dados,
    usaDebugger: false,
    conexaoPerdida: null,
    condicoes: registro.condicoes,
    extensoes: registro.extensoes,
    navegador: registro.navegador,
    cenario,
  };
  const transicao = concluir(
    { fase: 'ativa', sessao, resultado: null, idResultado: null },
    { desfecho: 'interrompida', fim: agora, limpeza: [], paginaRespondeu: false },
  );
  // `concluir` só recusa sem sessão, o que não acontece aqui.
  if (!transicao.ok || !transicao.estado.resultado) return guardada;
  const final = registroFinal(transicao.estado.resultado, registro.definicao, limiteBytes);
  return { registro: final.registro, dados: final.dados };
}

/** `true` para o que não terminou bem: interrompida, cancelada, com erro ou ainda em andamento. */
export function ehParcial(registro: Pick<RegistroExecucao, 'estado'>): boolean {
  return registro.estado !== 'concluida';
}

/**
 * Só uma execução de cenário concluída serve de referência de comparação. Resultado
 * parcial ou com falha de sessão nunca serve.
 */
export function podeSerReferencia(registro: Pick<RegistroExecucao, 'estado' | 'tipo' | 'resumo'>): boolean {
  return registro.tipo === 'cenario' && registro.estado === 'concluida' && !registro.resumo?.cenario?.falhaDeSessao;
}

export const BYTES_POR_MB = MB;
