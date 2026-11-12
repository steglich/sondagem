/**
 * Cenário declarativo (esquema versão 1): tipos, validação e resolução de iterações.
 *
 * A estrutura é conferida pelo validador gerado a partir de `cenario.schema.json`
 * (ver `scripts/gerar-validador.mjs`); o que o schema não expressa bem (versão
 * conhecida, `vezes` válido, rótulos únicos) fica em `checagemComplementar`.
 */
import validarEstrutura, { type ErroBruto } from './gerado/validador-cenario.js';
import type { IdVerificacao } from './types.ts';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export const VERSOES_SUPORTADAS: readonly number[] = [1];
export const ITERACOES_PADRAO = 5;
export const TEMPO_LIMITE_PADRAO_MS = 10_000;
export const INATIVIDADE_PADRAO_MS = 500;
/** Novas tentativas de um passo com `em_erro: "repetir"`. */
export const TENTATIVAS_EXTRAS = 2;

export type PoliticaErro = 'interromper' | 'pular' | 'repetir';

interface CamposComuns {
  tempo_limite_ms?: number;
  em_erro?: PoliticaErro;
}

export interface PassoNavegar extends CamposComuns {
  tipo: 'navegar';
  url: string;
}
export interface PassoClicar extends CamposComuns {
  tipo: 'clicar';
  seletor: string;
}
export interface PassoDigitar extends CamposComuns {
  tipo: 'digitar';
  seletor: string;
  texto: string;
  limpar?: boolean;
}
export interface PassoEsperar extends CamposComuns {
  tipo: 'esperar';
  ms?: number;
  seletor?: string;
}
export interface PassoRolar extends CamposComuns {
  tipo: 'rolar';
  seletor?: string;
  x?: number;
  y?: number;
}
export interface PassoAguardarInatividade extends CamposComuns {
  tipo: 'aguardar_inatividade';
  ms?: number;
}
export interface PassoRepetir {
  tipo: 'repetir';
  vezes: number | 'iteracoes';
  passos: Passo[];
}
export type MetricaMedir = 'heap_usado' | 'nos_dom' | 'listeners';
export interface PassoMedir extends CamposComuns {
  tipo: 'medir';
  metricas: MetricaMedir[];
}
export interface PassoSnapshot extends CamposComuns {
  tipo: 'snapshot';
  rotulo: string;
}
export interface PassoForcarGc extends CamposComuns {
  tipo: 'forcar_gc';
}

export type PassoDeAcao =
  | PassoNavegar
  | PassoClicar
  | PassoDigitar
  | PassoEsperar
  | PassoRolar
  | PassoAguardarInatividade;
export type PassoDeMedicao = PassoMedir | PassoSnapshot | PassoForcarGc;
export type Passo = PassoDeAcao | PassoRepetir | PassoDeMedicao;
export type TipoPasso = Passo['tipo'];

export interface ThrottlingPersonalizado {
  cpu?: number;
  rede?: { latencia_ms?: number; download_kbps?: number; upload_kbps?: number };
}
export type Throttling = string | ThrottlingPersonalizado;

export type TipoStorage = 'cookies' | 'local_storage' | 'session_storage' | 'indexeddb' | 'cache_storage';

export interface Cenario {
  versao_esquema: 1;
  nome: string;
  descricao?: string;
  url_inicial: string;
  execucao?: { iteracoes?: number; throttling?: Throttling; manter_cache?: boolean };
  aquecimento?: PassoDeAcao[];
  sessao?: { url_login?: string; passos_login?: PassoDeAcao[] };
  limpar_storage?: TipoStorage[];
  passos: Passo[];
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

export interface ErroValidacao {
  /** JSON Pointer do campo (ex.: `/passos/3/passos/0/seletor`); vazio para o documento inteiro. */
  caminho: string;
  mensagem: string;
  /** Só em erros de sintaxe do JSON. */
  linha?: number;
  coluna?: number;
}

export type ResultadoValidacao = { ok: true; cenario: Cenario } | { ok: false; erros: ErroValidacao[] };

const TIPOS_JSON: Record<string, string> = {
  string: 'um texto',
  integer: 'um número inteiro',
  number: 'um número',
  boolean: 'verdadeiro ou falso',
  array: 'uma lista',
  object: 'um objeto',
};

function ultimoSegmento(caminho: string): string {
  return caminho.slice(caminho.lastIndexOf('/') + 1);
}

function lista(valores: unknown): string {
  return (Array.isArray(valores) ? valores : [valores]).map((v) => `"${String(v)}"`).join(', ');
}

/** Converte um erro do validador gerado em caminho mais mensagem em português. */
function traduzir(erro: ErroBruto): ErroValidacao | null {
  // Erros internos de `if`/`oneOf`/`anyOf` repetem, com menos clareza, o erro do próprio campo.
  if (erro.keyword === 'if' || /\/(oneOf|anyOf)\/\d+\//.test(erro.schemaPath)) return null;

  const caminho = erro.instancePath;
  const campo = ultimoSegmento(caminho);
  const p = erro.params;
  switch (erro.keyword) {
    case 'required':
      return {
        caminho: `${caminho}/${String(p['missingProperty'])}`,
        mensagem: `Campo obrigatório "${String(p['missingProperty'])}" ausente.`,
      };
    case 'additionalProperties':
      return {
        caminho: `${caminho}/${String(p['additionalProperty'])}`,
        mensagem: `Campo "${String(p['additionalProperty'])}" desconhecido.`,
      };
    case 'enum':
      return {
        caminho,
        mensagem:
          campo === 'tipo'
            ? `Tipo de passo desconhecido. Use um de: ${lista(p['allowedValues'])}.`
            : `Valor inválido para "${campo}". Use um de: ${lista(p['allowedValues'])}.`,
      };
    case 'const':
      return { caminho, mensagem: `"${campo}" deve ser ${lista(p['allowedValue'])}.` };
    case 'type': {
      const tipos = (Array.isArray(p['type']) ? p['type'] : [p['type']]).map((t) => TIPOS_JSON[String(t)] ?? String(t));
      return { caminho, mensagem: `"${campo || 'cenário'}" deve ser ${tipos.join(' ou ')}.` };
    }
    case 'minimum':
      return { caminho, mensagem: `"${campo}" deve ser maior ou igual a ${String(p['limit'])}.` };
    case 'minItems':
      return { caminho, mensagem: `"${campo}" deve ter ao menos ${String(p['limit'])} item(ns).` };
    case 'pattern':
      return {
        caminho,
        mensagem:
          campo === 'url_inicial' ? '"url_inicial" deve começar com http:// ou https://.' : `"${campo}" não pode ficar vazio.`,
      };
    case 'oneOf':
      return { caminho, mensagem: 'Informe "ms" ou "seletor", apenas um dos dois.' };
    case 'anyOf':
      return { caminho, mensagem: 'Informe "x", "y" ou os dois.' };
    default:
      return { caminho, mensagem: erro.message ?? 'Valor inválido.' };
  }
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Percorre os passos, inclusive os de dentro de `repetir`, com o caminho de cada um. */
function percorrer(passos: unknown, caminho: string, visitar: (passo: Record<string, unknown>, caminho: string) => void): void {
  if (!Array.isArray(passos)) return;
  passos.forEach((passo, indice) => {
    if (!ehObjeto(passo)) return;
    const aqui = `${caminho}/${indice}`;
    visitar(passo, aqui);
    if (passo['tipo'] === 'repetir') percorrer(passo['passos'], `${aqui}/passos`, visitar);
  });
}

/** Regras que o schema não expressa bem: `vezes` válido, rótulos de snapshot únicos e login com `url_login`. */
export function checagemComplementar(valor: unknown): ErroValidacao[] {
  if (!ehObjeto(valor)) return [];
  const erros: ErroValidacao[] = [];
  const sessao = valor['sessao'];
  if (ehObjeto(sessao) && 'passos_login' in sessao && typeof sessao['url_login'] !== 'string') {
    erros.push({
      caminho: '/sessao/url_login',
      mensagem: '"passos_login" exige "url_login": é ela que diz quando a aplicação pediu o login.',
    });
  }
  const rotulos = new Map<string, string[]>();

  percorrer(valor['passos'], '/passos', (passo, caminho) => {
    if (passo['tipo'] === 'repetir' && 'vezes' in passo) {
      const vezes = passo['vezes'];
      const valido = vezes === 'iteracoes' || (typeof vezes === 'number' && Number.isInteger(vezes) && vezes > 0);
      if (!valido) {
        erros.push({
          caminho: `${caminho}/vezes`,
          mensagem: '"vezes" deve ser um número inteiro maior que zero ou a referência "iteracoes".',
        });
      }
    }
    if (passo['tipo'] === 'snapshot' && typeof passo['rotulo'] === 'string') {
      const caminhos = rotulos.get(passo['rotulo']) ?? [];
      caminhos.push(`${caminho}/rotulo`);
      rotulos.set(passo['rotulo'], caminhos);
    }
  });

  for (const [rotulo, caminhos] of rotulos) {
    if (caminhos.length < 2) continue;
    for (const caminho of caminhos) {
      const outros = caminhos.filter((c) => c !== caminho).join(', ');
      erros.push({ caminho, mensagem: `Rótulo de snapshot "${rotulo}" repetido (também em ${outros}).` });
    }
  }
  return erros;
}

/** Valida um cenário já convertido de JSON. Nenhum passo roda com cenário inválido. */
export function validarCenario(valor: unknown): ResultadoValidacao {
  if (ehObjeto(valor) && 'versao_esquema' in valor && !VERSOES_SUPORTADAS.includes(valor['versao_esquema'] as number)) {
    return {
      ok: false,
      erros: [
        {
          caminho: '/versao_esquema',
          mensagem: `Versão de esquema ${JSON.stringify(valor['versao_esquema'])} desconhecida. Versões suportadas: ${VERSOES_SUPORTADAS.join(', ')}.`,
        },
      ],
    };
  }

  const erros: ErroValidacao[] = [];
  if (!validarEstrutura(valor)) {
    for (const bruto of validarEstrutura.errors ?? []) {
      const erro = traduzir(bruto);
      if (erro && !erros.some((e) => e.caminho === erro.caminho && e.mensagem === erro.mensagem)) erros.push(erro);
    }
  }
  for (const erro of checagemComplementar(valor)) {
    // A regra complementar é mais clara do que o erro estrutural do mesmo campo.
    const repetido = erros.findIndex((e) => e.caminho === erro.caminho);
    if (repetido !== -1) erros.splice(repetido, 1);
    erros.push(erro);
  }
  return erros.length ? { ok: false, erros } : { ok: true, cenario: valor as Cenario };
}

/** Linha e coluna (a partir de 1) de uma posição no texto. */
function linhaEColuna(texto: string, posicao: number): { linha: number; coluna: number } {
  const antes = texto.slice(0, posicao).split('\n');
  return { linha: antes.length, coluna: antes[antes.length - 1]!.length + 1 };
}

/** Valida o texto de um cenário. JSON malformado vira um erro com linha e coluna. */
export function analisarTextoCenario(texto: string): ResultadoValidacao {
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch (erro) {
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    const posicao = /position (\d+)/.exec(detalhe);
    // Sem posição na mensagem, o texto acabou antes da hora: o erro está no fim.
    const { linha, coluna } = linhaEColuna(texto, posicao ? Number(posicao[1]) : texto.length);
    return {
      ok: false,
      erros: [{ caminho: '', mensagem: `JSON malformado na linha ${linha}, coluna ${coluna}: ${detalhe}`, linha, coluna }],
    };
  }
  return validarCenario(valor);
}

// ---------------------------------------------------------------------------
// Iterações
// ---------------------------------------------------------------------------

function inteiroPositivo(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor > 0;
}

/** Ordem: valor informado na execução, `execucao.iteracoes` do cenário, padrão de 5. */
export function resolverIteracoes(cenario: Pick<Cenario, 'execucao'>, informado?: number | null): number {
  if (inteiroPositivo(informado)) return informado;
  if (inteiroPositivo(cenario.execucao?.iteracoes)) return cenario.execucao.iteracoes;
  return ITERACOES_PADRAO;
}

/** Resolve `repetir.vezes`: a referência `"iteracoes"` vira o número de iterações da execução. */
export function resolverVezes(vezes: number | 'iteracoes', iteracoes: number): number {
  return vezes === 'iteracoes' ? iteracoes : vezes;
}

// ---------------------------------------------------------------------------
// Passos de medição
// ---------------------------------------------------------------------------

/** Verificação de que cada passo de medição depende. */
export const VERIFICACAO_DO_PASSO: Readonly<Record<PassoDeMedicao['tipo'], IdVerificacao>> = {
  medir: 'memoria',
  snapshot: 'memoria',
  forcar_gc: 'memoria',
};

function ehMedicao(passo: Passo): passo is PassoDeMedicao {
  return Object.hasOwn(VERIFICACAO_DO_PASSO, passo.tipo);
}

/**
 * `false` para um passo de medição cuja verificação não está marcada: o runner não
 * o executa. Passos de ação e `repetir` estão sempre ativos.
 */
export function passoAtivo(passo: Passo, verificacoesAtivas: readonly string[]): boolean {
  return !ehMedicao(passo) || verificacoesAtivas.includes(VERIFICACAO_DO_PASSO[passo.tipo]);
}

/**
 * Lista dos passos que de fato rodam: sem os de medição cuja verificação não está
 * ativa. Os passos de ação ficam sempre: a ação é o que o cenário mede. Um `repetir`
 * que fica vazio é mantido, para que o número de iterações não mude com a seleção.
 * O runner usa `passoAtivo` direto, para que os caminhos dos erros continuem
 * apontando para o documento original.
 */
export function filtrarPassosDeMedicao(passos: readonly Passo[], verificacoesAtivas: readonly string[]): Passo[] {
  const filtrados: Passo[] = [];
  for (const passo of passos) {
    if (!passoAtivo(passo, verificacoesAtivas)) continue;
    if (passo.tipo === 'repetir') {
      filtrados.push({ ...passo, passos: filtrarPassosDeMedicao(passo.passos, verificacoesAtivas) });
    } else {
      filtrados.push(passo);
    }
  }
  return filtrados;
}

/** `true` se o cenário tem algum passo que depende da verificação dada (inclusive dentro de `repetir`). */
export function temPassoDe(passos: readonly Passo[], verificacao: IdVerificacao): boolean {
  return passos.some((passo) =>
    passo.tipo === 'repetir' ? temPassoDe(passo.passos, verificacao) : ehMedicao(passo) && VERIFICACAO_DO_PASSO[passo.tipo] === verificacao,
  );
}

/** Texto que substitui o que foi digitado nos passos de login em tudo o que é gravado. */
export const TEXTO_MASCARADO = '***';

/**
 * Cópia do cenário sem os textos digitados nos passos de login. É esta cópia que vai
 * para o estado da sessão e para o histórico: as credenciais ficam só no arquivo do cenário.
 */
export function mascararCenario(cenario: Cenario): Cenario {
  const passos = cenario.sessao?.passos_login;
  if (!passos) return cenario;
  return {
    ...cenario,
    sessao: {
      ...cenario.sessao,
      passos_login: passos.map((passo) => (passo.tipo === 'digitar' ? { ...passo, texto: TEXTO_MASCARADO } : passo)),
    },
  };
}

/** Tipos de `limpar_storage` que apagam dados de sessão: só saem com confirmação específica. */
export function storageAConfirmar(cenario: Pick<Cenario, 'limpar_storage'>): TipoStorage[] {
  // O Cache Storage já é limpo antes de toda execução e não guarda a sessão do usuário.
  return [...new Set(cenario.limpar_storage ?? [])].filter((tipo) => tipo !== 'cache_storage');
}

/** Texto curto do throttling para a confirmação e o resultado. */
export function descreverThrottling(throttling: Throttling | undefined): string {
  if (throttling === undefined) return 'nenhum';
  if (typeof throttling === 'string') return throttling;
  const partes: string[] = [];
  if (throttling.cpu !== undefined) partes.push(`CPU ${throttling.cpu}×`);
  if (throttling.rede) partes.push('rede personalizada');
  return partes.length ? partes.join(', ') : 'nenhum';
}
