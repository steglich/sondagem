/**
 * Exportação dos resultados em JSON e CSV. Funções puras: devolvem o texto e o nome
 * do arquivo; quem baixa é a interface. O formato está documentado em
 * `docs/exportacao.md`.
 *
 * Nada aqui acrescenta dado sensível: o cenário guardado no histórico já vem com os
 * textos digitados no login mascarados, e é ele que é exportado.
 */
import type { Comparacao } from './comparacao.ts';
import type { ExecucaoGuardada, RegistroExecucao } from './historico.ts';
import { COLUNAS, medicoesPorIteracao } from './relatorio.ts';
import type { DadosColetados } from './types.ts';

export const VERSAO_EXPORTACAO = 1;

/** Tudo o que está armazenado de uma execução, mais a versão do formato do arquivo. */
export interface ExportacaoJson {
  versao_exportacao: typeof VERSAO_EXPORTACAO;
  /** Metadados, condições, ambiente e estatísticas. */
  execucao: RegistroExecucao;
  /** As listas detalhadas. */
  detalhes: DadosColetados;
}

export function exportarJson(guardada: ExecucaoGuardada): string {
  const exportacao: ExportacaoJson = { versao_exportacao: VERSAO_EXPORTACAO, execucao: guardada.registro, detalhes: guardada.dados };
  return JSON.stringify(exportacao, null, 2);
}

// ---------------------------------------------------------------------------
// Nome do arquivo
// ---------------------------------------------------------------------------

/** Deixa só o que é seguro em nome de arquivo em qualquer sistema. */
function limpar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const dois = (n: number): string => String(n).padStart(2, '0');

/** Data da execução no fuso local, como `2026-11-12_0935`. */
function dataNoNome(instante: number): string {
  const d = new Date(instante);
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}_${dois(d.getHours())}${dois(d.getMinutes())}`;
}

type Identificacao = Pick<RegistroExecucao, 'nomeCenario' | 'versaoBuild' | 'inicio'>;

/** `sondagem_<cenário>_<build>_<data>.<extensão>`; sem build informado, a parte some. */
export function nomeDoArquivo(registro: Identificacao, extensao: 'json' | 'csv'): string {
  const partes = ['sondagem', limpar(registro.nomeCenario ?? 'sessao-manual') || 'cenario'];
  const build = registro.versaoBuild === null ? '' : limpar(registro.versaoBuild);
  if (build) partes.push(build);
  partes.push(dataNoNome(registro.inicio));
  return `${partes.join('_')}.${extensao}`;
}

/** `sondagem_comparacao_<cenário>_<build A>_vs_<build B>_<data de B>.csv`. */
export function nomeDoArquivoDaComparacao(comparacao: Extract<Comparacao, { ok: true }>): string {
  const lado = (versao: string | null, inicio: number): string => (versao === null ? '' : limpar(versao)) || dataNoNome(inicio);
  return [
    'sondagem',
    'comparacao',
    limpar(comparacao.nomeCenario) || 'cenario',
    lado(comparacao.a.versaoBuild, comparacao.a.inicio),
    'vs',
    lado(comparacao.b.versaoBuild, comparacao.b.inicio),
    `${dataNoNome(comparacao.b.inicio)}.csv`,
  ].join('_');
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Vírgula é o padrão (RFC 4180). Ponto e vírgula é para planilhas em localidade que usa vírgula decimal. */
export type SeparadorCsv = ',' | ';';

/** Marca de ordem de bytes: com ela, as planilhas abrem o arquivo como UTF-8. */
export const BOM = '﻿';

export type CelulaCsv = string | number | null;

/**
 * Escape da RFC 4180: o campo com separador, aspas ou quebra de linha vai entre
 * aspas, e as aspas de dentro são dobradas. Número usa ponto decimal com vírgula
 * de separador, e vírgula decimal com ponto e vírgula. `null` vira campo vazio.
 */
function celula(valor: CelulaCsv, separador: SeparadorCsv): string {
  if (valor === null) return '';
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return '';
    // No máximo 3 casas, sem zeros à direita nem notação científica.
    const texto = String(Number(valor.toFixed(3)));
    return separador === ';' ? texto.replace('.', ',') : texto;
  }
  return /[",;\r\n]/.test(valor) ? `"${valor.replaceAll('"', '""')}"` : valor;
}

/** Texto CSV com BOM, linhas terminadas em CRLF e uma linha de cabeçalho. */
export function gerarCsv(cabecalho: readonly string[], linhas: readonly (readonly CelulaCsv[])[], separador: SeparadorCsv = ','): string {
  const linha = (celulas: readonly CelulaCsv[]): string => celulas.map((c) => celula(c, separador)).join(separador);
  return BOM + [cabecalho, ...linhas].map((l) => `${linha(l)}\r\n`).join('');
}

/**
 * Medições por iteração: uma linha por iteração e uma coluna por métrica das
 * verificações que rodaram, com a unidade no cabeçalho. Métrica sem dado na
 * iteração fica vazia.
 */
export function csvPorIteracao(guardada: ExecucaoGuardada, separador: SeparadorCsv = ','): string {
  const { colunas, linhas } = medicoesPorIteracao(guardada.registro, guardada.dados);
  const cabecalho = ['Iteração', 'Completa', ...colunas.map((c) => `${COLUNAS[c].nome} (${COLUNAS[c].unidade})`)];
  return gerarCsv(
    cabecalho,
    linhas.map((linha) => [linha.iteracao, linha.completa ? 'sim' : 'não', ...colunas.map((c) => linha.valores[c])]),
    separador,
  );
}

/** Comparação: uma linha por métrica, com os dois valores, a diferença absoluta e a percentual. */
export function csvDaComparacao(comparacao: Extract<Comparacao, { ok: true }>, separador: SeparadorCsv = ','): string {
  const lado = (letra: string, versao: string | null): string => (versao === null ? letra : `${letra} (build ${versao})`);
  return gerarCsv(
    ['Métrica', 'Unidade', lado('A', comparacao.a.versaoBuild), lado('B', comparacao.b.versaoBuild), 'Diferença', 'Diferença (%)'],
    comparacao.metricas.map((m) => [m.nome, m.unidade, m.a, m.b, m.diferenca, m.percentual]),
    separador,
  );
}
