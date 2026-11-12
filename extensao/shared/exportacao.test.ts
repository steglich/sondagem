import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { execucaoDeTeste, guardadaDeTeste, iteracoes } from './apoio-registro.ts';
import { mascararCenario } from './cenario.ts';
import type { Cenario } from './cenario.ts';
import { compararExecucoes } from './comparacao.ts';
import { COLUNAS } from './relatorio.ts';
import { BOM, csvDaComparacao, csvPorIteracao, exportarJson, gerarCsv, nomeDoArquivo, nomeDoArquivoDaComparacao } from './exportacao.ts';

/** Linhas do CSV sem o BOM e sem a linha vazia do fim. */
function linhasDe(csv: string): string[] {
  expect(csv.startsWith(BOM)).toBe(true);
  expect(csv.endsWith('\r\n')).toBe(true);
  return csv.slice(BOM.length, -2).split('\r\n');
}

const INICIO = new Date(2026, 10, 12, 9, 5).getTime();

describe('exportação JSON', () => {
  it('traz a versão do formato, o registro completo e os detalhes', () => {
    const registro = execucaoDeTeste('a', { 'duracao-iteracao': 1000 }, { versaoBuild: '1.5.0' });
    const guardada = guardadaDeTeste(registro, { longTasks: [{ inicio: 1100, duracao: 60, iteracao: 1 }] });
    const exportado = JSON.parse(exportarJson(guardada)) as Record<string, unknown>;
    expect(Object.keys(exportado)).toEqual(['versao_exportacao', 'execucao', 'detalhes']);
    expect(exportado['versao_exportacao']).toBe(1);
    expect(exportado['execucao']).toEqual(registro);
    expect(exportado['detalhes']).toEqual(guardada.dados);
    expect(exportado['execucao']).toMatchObject({ versaoBuild: '1.5.0', condicoes: { perfil: 'padrao', cpu: 4 }, resumo: { cenario: { estatisticas: [{ id: 'duracao-iteracao', mediana: 1000 }] } } });
  });

  it('cenário com login: o que foi digitado não aparece no arquivo', () => {
    const cenario: Cenario = {
      versao_esquema: 1,
      nome: 'com-login',
      url_inicial: 'http://localhost:4300/protegida',
      sessao: {
        url_login: '/login',
        passos_login: [
          { tipo: 'digitar', seletor: '#usuario', texto: 'maria' },
          { tipo: 'digitar', seletor: '#senha', texto: 'senha-muito-secreta' },
        ],
      },
      passos: [{ tipo: 'clicar', seletor: '#abrir' }],
    };
    // O histórico guarda o cenário já mascarado; a exportação não tem outra fonte.
    const registro = execucaoDeTeste('a', {}, { nomeCenario: 'com-login', definicao: mascararCenario(cenario) });
    const texto = exportarJson(guardadaDeTeste(registro));
    expect(texto).not.toContain('senha-muito-secreta');
    expect(texto).not.toContain('maria');
    expect(texto).toContain('"texto": "***"');
  });
});

describe('nome do arquivo', () => {
  it('tem o cenário, a versão do build e a data da execução', () => {
    const registro = { nomeCenario: 'abrir-fechar-modal', versaoBuild: '1.5.0', inicio: INICIO };
    expect(nomeDoArquivo(registro, 'json')).toBe('sondagem_abrir-fechar-modal_1.5.0_2026-11-12_0905.json');
    expect(nomeDoArquivo(registro, 'csv')).toBe('sondagem_abrir-fechar-modal_1.5.0_2026-11-12_0905.csv');
  });

  it('sem build, a parte some; sessão manual tem nome próprio', () => {
    expect(nomeDoArquivo({ nomeCenario: 'abrir-fechar', versaoBuild: null, inicio: INICIO }, 'json')).toBe('sondagem_abrir-fechar_2026-11-12_0905.json');
    expect(nomeDoArquivo({ nomeCenario: null, versaoBuild: null, inicio: INICIO }, 'json')).toBe('sondagem_sessao-manual_2026-11-12_0905.json');
  });

  it('tira do nome o que não é seguro em nome de arquivo', () => {
    expect(nomeDoArquivo({ nomeCenario: 'Página: início/fim', versaoBuild: 'v2 (rc/1)', inicio: INICIO }, 'csv')).toBe('sondagem_Pagina-inicio-fim_v2-rc-1_2026-11-12_0905.csv');
  });

  it('o da comparação tem o cenário e as duas versões', () => {
    const a = execucaoDeTeste('a', {}, { versaoBuild: '1.4.0', inicio: INICIO - 86_400_000 });
    const b = execucaoDeTeste('b', {}, { versaoBuild: '1.5.0', inicio: INICIO });
    const comparacao = compararExecucoes(a, b);
    if (!comparacao.ok) throw new Error(comparacao.mensagem);
    expect(nomeDoArquivoDaComparacao(comparacao)).toBe('sondagem_comparacao_abrir-fechar_1.4.0_vs_1.5.0_2026-11-12_0905.csv');
    const semBuild = compararExecucoes({ ...a, versaoBuild: null }, { ...b, versaoBuild: null });
    expect(semBuild.ok && nomeDoArquivoDaComparacao(semBuild)).toBe('sondagem_comparacao_abrir-fechar_2026-11-11_0905_vs_2026-11-12_0905_2026-11-12_0905.csv');
  });
});

describe('CSV', () => {
  it('começa com BOM UTF-8, termina cada linha com CRLF e tem o cabeçalho', () => {
    expect(gerarCsv(['a', 'b'], [[1, 'x']])).toBe('﻿a,b\r\n1,x\r\n');
  });

  it('valor com vírgula, aspas ou quebra de linha vai entre aspas, com as aspas dobradas (RFC 4180)', () => {
    const [, linha] = linhasDe(gerarCsv(['texto'], [['a, b']]));
    expect(linha).toBe('"a, b"');
    expect(gerarCsv(['t'], [['disse "oi"']])).toBe('﻿t\r\n"disse ""oi"""\r\n');
    expect(gerarCsv(['t'], [['linha 1\nlinha 2']])).toBe('﻿t\r\n"linha 1\nlinha 2"\r\n');
    expect(gerarCsv(['t'], [['volta\rcarro']])).toBe('﻿t\r\n"volta\rcarro"\r\n');
    // O cabeçalho passa pelo mesmo escape.
    expect(linhasDe(gerarCsv(['A (build 1,5)'], []))).toEqual(['"A (build 1,5)"']);
  });

  it('valor sem caractere especial fica como está, e valor ausente vira campo vazio', () => {
    expect(linhasDe(gerarCsv(['a', 'b', 'c'], [['simples', null, 3]]))).toEqual(['a,b,c', 'simples,,3']);
  });

  it('números: ponto decimal com vírgula; com ponto e vírgula, vírgula decimal', () => {
    expect(linhasDe(gerarCsv(['n'], [[1400.5], [0.123456], [1e21], [Number.NaN]]))).toEqual(['n', '1400.5', '0.123', '1e+21', '']);
    expect(linhasDe(gerarCsv(['a', 'b'], [[1400.5, 'x;y']], ';'))).toEqual(['a;b', '1400,5;"x;y"']);
  });

  it('medições por iteração: cabeçalho com nome e unidade, e uma linha por iteração (20 iterações → 20 linhas)', () => {
    const registro = execucaoDeTeste('a', {}, { selecao: ['processamento', 'erros-pagina'] }, { iteracoes: iteracoes(20) });
    const linhas = linhasDe(
      csvPorIteracao(
        guardadaDeTeste(registro, {
          longTasks: [{ inicio: 1100, duracao: 60.25, iteracao: 1 }],
          interacoes: [{ id: 1, documento: 'd', inicio: 2100, duracao: 48, tipo: 'click', alvo: 'button', iteracao: 2 }],
        }),
      ),
    );
    expect(linhas).toHaveLength(21);
    expect(linhas[0]).toBe(
      'Iteração,Completa,Duração da iteração (ms),Tempo em long tasks (ms),Long tasks (quantidade),Pior interação (ms),Interações (quantidade),Erros da página (quantidade)',
    );
    expect(linhas[1]).toBe('1,sim,1000,60.25,1,,0,0');
    // Métrica ausente na iteração (nenhuma interação): campo vazio.
    expect(linhas[2]).toBe('2,sim,1000,0,0,48,1,0');
    expect(linhas[20]).toBe('20,sim,1000,0,0,,0,0');
  });

  it('medições por iteração com ponto e vírgula', () => {
    const registro = execucaoDeTeste('a', {}, { selecao: ['processamento'] }, { iteracoes: iteracoes(1) });
    const linhas = linhasDe(csvPorIteracao(guardadaDeTeste(registro, { longTasks: [{ inicio: 1100, duracao: 60.25, iteracao: 1 }] }), ';'));
    expect(linhas[1]).toBe('1;sim;1000;60,25;1;;0');
  });

  it('comparação: uma linha por métrica, com os valores, a diferença absoluta e a percentual', () => {
    const a = execucaoDeTeste('a', { 'duracao-iteracao': 1000, 'tempo-long-tasks': 200 }, { versaoBuild: '1.4.0' });
    const b = execucaoDeTeste('b', { 'duracao-iteracao': 1100, 'tempo-long-tasks': 150, 'pior-interacao': 90 }, { versaoBuild: '1.5.0, rc' });
    const comparacao = compararExecucoes(a, b);
    if (!comparacao.ok) throw new Error(comparacao.mensagem);
    expect(linhasDe(csvDaComparacao(comparacao))).toEqual([
      'Métrica,Unidade,A (build 1.4.0),"B (build 1.5.0, rc)",Diferença,Diferença (%)',
      'Duração da iteração,ms,1000,1100,100,10',
      'Tempo em long tasks por iteração,ms,200,150,-50,-25',
      'Pior interação por iteração,ms,,90,,',
    ]);
  });
});

describe('docs/exportacao.md', () => {
  const documento = readFileSync('docs/exportacao.md', 'utf8');
  /** Campos documentados em uma seção: o que está entre crases na primeira coluna das tabelas. */
  function documentados(titulo: string): string[] {
    const inicio = documento.indexOf(`${titulo}\n`);
    expect(inicio, `seção "${titulo}"`).toBeGreaterThanOrEqual(0);
    const secao = documento.slice(inicio + titulo.length).split(/\n#{2,3} /)[0]!;
    return secao
      .split('\n')
      .filter((linha) => linha.startsWith('| `'))
      .flatMap((linha) => [...linha.split('|')[1]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!));
  }

  it('um arquivo JSON exportado tem exatamente os campos documentados', () => {
    const todas = ['processamento', 'carregamento', 'erros-pagina', 'memoria', 'dom-listeners', 'cpu'] as const;
    const exportado = JSON.parse(exportarJson(guardadaDeTeste(execucaoDeTeste('a', { 'duracao-iteracao': 1000 }, { selecao: [...todas] })))) as Record<string, Record<string, unknown>>;
    expect(Object.keys(exportado)).toEqual(documentados('## JSON'));
    expect(Object.keys(exportado['execucao']!).sort()).toEqual(documentados('### `execucao`').sort());
    expect(Object.keys(exportado['detalhes']!).sort()).toEqual(documentados('### `detalhes`').sort());
    expect(documento).toContain(`| \`versao_exportacao\` | Versão do formato deste arquivo. Hoje, \`${exportado['versao_exportacao']}\`. |`);
  });

  it('os CSVs exportados têm as colunas documentadas, na ordem', () => {
    const registro = execucaoDeTeste('a', {}, { selecao: ['processamento', 'erros-pagina', 'memoria'] }, { iteracoes: iteracoes(2) });
    const ponto = (valor: number) => [1, 2].map((iteracao) => ({ iteracao, valor }));
    const serie = (metrica: 'heap_usado' | 'nos_dom' | 'listeners') => ({ metrica, pontos: ponto(1), crescimentoMedio: 0, transicoesCrescentes: 0, classificacao: 'dados-insuficientes' as const });
    registro.resumo!.memoria = { classificacao: 'dados-insuficientes', series: [serie('heap_usado'), serie('nos_dom'), serie('listeners')], comparacao: null, domListeners: null };
    const cabecalho = linhasDe(csvPorIteracao(guardadaDeTeste(registro)))[0]!.split(',');
    expect(cabecalho).toEqual(documentados('## CSV das medições por iteração'));
    // Toda coluna que o código conhece está no documento.
    expect(cabecalho).toHaveLength(2 + Object.keys(COLUNAS).length);

    const a = execucaoDeTeste('a', { 'duracao-iteracao': 1 }, { versaoBuild: 'X' });
    const b = execucaoDeTeste('b', { 'duracao-iteracao': 2 }, { versaoBuild: 'Y' });
    const comparacao = compararExecucoes(a, b);
    if (!comparacao.ok) throw new Error(comparacao.mensagem);
    const daComparacao = linhasDe(csvDaComparacao(comparacao))[0]!.split(',');
    expect(daComparacao).toEqual(documentados('## CSV da comparação').map((coluna) => coluna.replace('<versão>', coluna.startsWith('A') ? 'X' : 'Y')));
  });

  it('o exemplo de nome de arquivo é o que o código gera', () => {
    const nome = nomeDoArquivo({ nomeCenario: 'abrir-fechar-modal', versaoBuild: '1.5.0', inicio: INICIO }, 'json');
    expect(documento).toContain(`Exemplo: \`${nome}\`.`);
  });
});
