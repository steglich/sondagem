import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARQUIVO_VALIDADOR, gerarValidador } from '../../scripts/gerar-validador.mjs';
import {
  type Cenario,
  type Passo,
  analisarTextoCenario,
  filtrarPassosDeMedicao,
  resolverIteracoes,
  resolverVezes,
  validarCenario,
} from './cenario.ts';

/** Exemplo da seção 4.1 do plano, o mesmo de docs/cenario.md. */
function exemplo(): Cenario {
  return {
    versao_esquema: 1,
    nome: 'abrir-fechar-modal',
    url_inicial: 'http://localhost:4200/produtos',
    execucao: { iteracoes: 20, throttling: 'padrao' },
    aquecimento: [
      { tipo: 'clicar', seletor: "[data-testid='abrir-modal']" },
      { tipo: 'clicar', seletor: "[data-testid='fechar-modal']" },
    ],
    passos: [
      { tipo: 'forcar_gc' },
      { tipo: 'forcar_gc' },
      { tipo: 'snapshot', rotulo: 'inicio' },
      {
        tipo: 'repetir',
        vezes: 'iteracoes',
        passos: [
          { tipo: 'clicar', seletor: "[data-testid='abrir-modal']", tempo_limite_ms: 5000, em_erro: 'interromper' },
          { tipo: 'esperar', seletor: "[data-testid='modal']" },
          { tipo: 'clicar', seletor: "[data-testid='fechar-modal']" },
          { tipo: 'aguardar_inatividade', ms: 300 },
          { tipo: 'forcar_gc' },
          { tipo: 'forcar_gc' },
          { tipo: 'medir', metricas: ['heap_usado', 'nos_dom', 'listeners'] },
        ],
      },
      { tipo: 'forcar_gc' },
      { tipo: 'forcar_gc' },
      { tipo: 'snapshot', rotulo: 'fim' },
    ],
  };
}

/** Cópia do exemplo com uma alteração, sem tipos (para montar cenários inválidos). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cenários inválidos de propósito
function alterado(alterar: (cenario: any) => void): unknown {
  const copia = structuredClone(exemplo());
  alterar(copia);
  return copia;
}

function errosDe(valor: unknown) {
  const resultado = validarCenario(valor);
  return resultado.ok ? [] : resultado.erros;
}

describe('validarCenario', () => {
  it('aceita o exemplo do plano', () => {
    expect(validarCenario(exemplo())).toEqual({ ok: true, cenario: exemplo() });
  });

  it('aceita o cenário mínimo', () => {
    const minimo = { versao_esquema: 1, nome: 'm', url_inicial: 'http://localhost/', passos: [{ tipo: 'esperar', ms: 10 }] };
    expect(validarCenario(minimo).ok).toBe(true);
  });

  it('aceita todos os tipos de passo e os campos opcionais do cenário', () => {
    const completo = {
      versao_esquema: 1,
      nome: 'completo',
      descricao: 'todos os campos',
      url_inicial: 'https://exemplo.test/',
      execucao: { iteracoes: 3, throttling: { cpu: 4, rede: { latencia_ms: 150, download_kbps: 1600, upload_kbps: 750 } } },
      aquecimento: [{ tipo: 'esperar', ms: 5 }],
      sessao: { url_login: 'https://exemplo.test/login' },
      limpar_storage: ['local_storage'],
      passos: [
        { tipo: 'navegar', url: '/lista' },
        { tipo: 'digitar', seletor: '#busca', texto: 'abc', limpar: true },
        { tipo: 'rolar', y: 400 },
        { tipo: 'rolar', seletor: '#lista', x: 10, y: -20 },
        { tipo: 'esperar', seletor: '#pronto', em_erro: 'pular' },
        { tipo: 'aguardar_inatividade' },
        { tipo: 'repetir', vezes: 2, passos: [{ tipo: 'repetir', vezes: 3, passos: [{ tipo: 'clicar', seletor: 'button' }] }] },
        { tipo: 'medir', metricas: ['nos_dom'] },
        { tipo: 'snapshot', rotulo: 'a' },
        { tipo: 'forcar_gc', em_erro: 'repetir', tempo_limite_ms: 100 },
      ],
    };
    expect(errosDe(completo)).toEqual([]);
  });

  it('seletor ausente: aponta o caminho do campo dentro do repetir', () => {
    const erros = errosDe(alterado((c) => delete c.passos[3].passos[0].seletor));
    expect(erros).toEqual([{ caminho: '/passos/3/passos/0/seletor', mensagem: 'Campo obrigatório "seletor" ausente.' }]);
  });

  it('seletor ausente em digitar', () => {
    const erros = errosDe(alterado((c) => (c.passos[0] = { tipo: 'digitar', texto: 'x' })));
    expect(erros.map((e) => e.caminho)).toEqual(['/passos/0/seletor']);
  });

  it.each([0, -3, 1.5, 'muitas', null])('vezes inválido (%j): aponta o campo vezes do passo', (vezes) => {
    const erros = errosDe(alterado((c) => (c.passos[3].vezes = vezes)));
    expect(erros).toHaveLength(1);
    expect(erros[0]!.caminho).toBe('/passos/3/vezes');
    expect(erros[0]!.mensagem).toContain('maior que zero');
  });

  it('rótulo repetido: aponta os dois snapshots', () => {
    const erros = errosDe(alterado((c) => (c.passos[6].rotulo = 'inicio')));
    expect(erros.map((e) => e.caminho)).toEqual(['/passos/2/rotulo', '/passos/6/rotulo']);
    expect(erros[0]!.mensagem).toContain('/passos/6/rotulo');
    expect(erros[1]!.mensagem).toContain('/passos/2/rotulo');
  });

  it('em_erro inválido: aponta o campo e lista os valores aceitos', () => {
    const erros = errosDe(alterado((c) => (c.passos[3].passos[0].em_erro = 'ignorar')));
    expect(erros).toHaveLength(1);
    expect(erros[0]!.caminho).toBe('/passos/3/passos/0/em_erro');
    expect(erros[0]!.mensagem).toContain('"interromper", "pular", "repetir"');
  });

  it('tipo de passo desconhecido: aponta o passo', () => {
    const erros = errosDe(alterado((c) => (c.passos[1] = { tipo: 'arrastar', seletor: '#a' })));
    expect(erros).toHaveLength(1);
    expect(erros[0]!.caminho).toBe('/passos/1/tipo');
    expect(erros[0]!.mensagem).toContain('Tipo de passo desconhecido');
  });

  it('passo sem tipo', () => {
    expect(errosDe(alterado((c) => (c.passos[1] = { seletor: '#a' }))).map((e) => e.caminho)).toEqual(['/passos/1/tipo']);
  });

  it('versão de esquema desconhecida: informa as suportadas', () => {
    const erros = errosDe(alterado((c) => (c.versao_esquema = 2)));
    expect(erros).toEqual([
      { caminho: '/versao_esquema', mensagem: 'Versão de esquema 2 desconhecida. Versões suportadas: 1.' },
    ]);
  });

  it('campos obrigatórios do cenário ausentes', () => {
    expect(errosDe({}).map((e) => e.caminho).sort()).toEqual(['/nome', '/passos', '/url_inicial', '/versao_esquema']);
  });

  it('lista de passos vazia, campo desconhecido e URL sem http', () => {
    const erros = errosDe(
      alterado((c) => {
        c.passos = [];
        c.extra = 1;
        c.url_inicial = 'localhost:4200';
      }),
    );
    expect(erros.map((e) => e.caminho).sort()).toEqual(['/extra', '/passos', '/url_inicial']);
  });

  it('esperar exige ms ou seletor, não os dois nem nenhum', () => {
    expect(errosDe(alterado((c) => (c.passos[0] = { tipo: 'esperar' }))).map((e) => e.caminho)).toEqual(['/passos/0']);
    expect(errosDe(alterado((c) => (c.passos[0] = { tipo: 'esperar', ms: 1, seletor: '#a' })))).toHaveLength(1);
  });

  it('aquecimento não aceita passos de medição nem repetir', () => {
    expect(errosDe(alterado((c) => c.aquecimento.push({ tipo: 'forcar_gc' }))).map((e) => e.caminho)).toEqual([
      '/aquecimento/2/tipo',
    ]);
  });

  it('documento que não é objeto', () => {
    expect(errosDe([1, 2])).toEqual([{ caminho: '', mensagem: '"cenário" deve ser um objeto.' }]);
  });
});

describe('analisarTextoCenario', () => {
  it('aceita o texto de um cenário válido', () => {
    expect(analisarTextoCenario(JSON.stringify(exemplo(), null, 2)).ok).toBe(true);
  });

  it('JSON malformado: informa linha e coluna', () => {
    const texto = '{\n  "versao_esquema": 1,\n  "nome": "x",,\n  "passos": []\n}';
    const resultado = analisarTextoCenario(texto);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.erros).toHaveLength(1);
    expect(resultado.erros[0]).toMatchObject({ caminho: '', linha: 3, coluna: 15 });
    expect(resultado.erros[0]!.mensagem).toContain('JSON malformado na linha 3, coluna 15');
  });

  it('JSON cortado: aponta o fim do texto', () => {
    const resultado = analisarTextoCenario('{\n  "nome": "x"');
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.erros[0]).toMatchObject({ linha: 2, coluna: 14 });
  });

  it('texto que não é JSON', () => {
    const resultado = analisarTextoCenario('nome: x');
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erros[0]!.linha).toBe(1);
  });
});

describe('iterações', () => {
  it('sem valor na execução nem no cenário: 5', () => {
    expect(resolverIteracoes({})).toBe(5);
    expect(resolverIteracoes({ execucao: {} }, null)).toBe(5);
  });

  it('usa o valor do cenário quando a execução não informa', () => {
    expect(resolverIteracoes({ execucao: { iteracoes: 20 } })).toBe(20);
  });

  it('o valor informado na execução tem prioridade', () => {
    expect(resolverIteracoes({ execucao: { iteracoes: 20 } }, 10)).toBe(10);
  });

  it('valor informado inválido é ignorado', () => {
    expect(resolverIteracoes({ execucao: { iteracoes: 20 } }, 0)).toBe(20);
    expect(resolverIteracoes({}, 2.5)).toBe(5);
  });

  it('a referência "iteracoes" resolve para as iterações da execução', () => {
    expect(resolverVezes('iteracoes', 10)).toBe(10);
    expect(resolverVezes(3, 10)).toBe(3);
  });
});

describe('filtrarPassosDeMedicao', () => {
  it('sem a verificação de memória, remove medir, snapshot e forcar_gc e mantém as ações', () => {
    const tipos = (passos: Passo[]): unknown[] =>
      passos.map((p) => (p.tipo === 'repetir' ? { repetir: tipos(p.passos) } : p.tipo));
    expect(tipos(filtrarPassosDeMedicao(exemplo().passos, ['processamento']))).toEqual([
      { repetir: ['clicar', 'esperar', 'clicar', 'aguardar_inatividade'] },
    ]);
  });

  it('com a verificação ativa, mantém tudo', () => {
    expect(filtrarPassosDeMedicao(exemplo().passos, ['memoria'])).toEqual(exemplo().passos);
  });
});

describe('documentação e validador gerado', () => {
  it('os exemplos completos de docs/cenario.md passam no validador', () => {
    const documento = readFileSync(new URL('../../docs/cenario.md', import.meta.url), 'utf8');
    const blocos = [...documento.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!).filter((b) => b.includes('versao_esquema'));
    expect(blocos.length).toBeGreaterThan(0);
    for (const bloco of blocos) expect(analisarTextoCenario(bloco)).toMatchObject({ ok: true });
    expect(JSON.parse(blocos[0]!)).toEqual(exemplo());
  });

  it('o cenário da página de teste é válido', () => {
    const texto = readFileSync(new URL('../../pagina-teste/cenarios/abrir-fechar.json', import.meta.url), 'utf8');
    expect(analisarTextoCenario(texto)).toMatchObject({ ok: true, cenario: { nome: 'abrir-fechar' } });
  });

  it('o validador versionado está em dia com o schema', async () => {
    expect(readFileSync(ARQUIVO_VALIDADOR, 'utf8')).toBe(await gerarValidador());
  });
});
