import { describe, expect, it } from 'vitest';
import { type IntervaloTrace, NOME_ANONIMA, criarAgregadorCpu, mensagemFalhaCpu } from './cpu.ts';

const PAGINA = 'http://localhost:4300/app.js';

interface NoTeste {
  id: number;
  parent?: number;
  nome: string;
  url?: string;
  linha?: number;
  coluna?: number;
}

const no = ({ id, parent, nome, url, linha, coluna }: NoTeste) => ({
  id,
  ...(parent === undefined ? {} : { parent }),
  callFrame: { functionName: nome, ...(url ? { url, lineNumber: linha ?? 0, columnNumber: coluna ?? 0 } : {}), scriptId: 1 },
});

const abertura = (inicio: number, id = '0x1') => ({ name: 'Profile', id, pid: 1, ts: inicio, args: { data: { startTime: inicio } } });

const pedaco = (nos: NoTeste[], amostras: number[], deltas: number[], id = '0x1') => ({
  name: 'ProfileChunk',
  id,
  pid: 1,
  args: { data: { cpuProfile: { nodes: nos.map(no), samples: amostras }, timeDeltas: deltas } },
});

/**
 * Árvore usada nos testes:
 *   (root) 1 ─ (program) 2
 *          ├─ (idle) 3
 *          ├─ principal 4 ─ pesada 5 ─ (garbage collector) 6
 *          │              └─ anônima 7
 *          └─ fatorial 8 ─ fatorial 9 ─ fatorial 10
 */
const ARVORE: NoTeste[] = [
  { id: 1, nome: '(root)' },
  { id: 2, parent: 1, nome: '(program)' },
  { id: 3, parent: 1, nome: '(idle)' },
  { id: 4, parent: 1, nome: 'principal', url: PAGINA, linha: 9, coluna: 0 },
  { id: 5, parent: 4, nome: 'pesada', url: PAGINA, linha: 19, coluna: 4 },
  { id: 6, parent: 5, nome: '(garbage collector)' },
  { id: 7, parent: 4, nome: '', url: PAGINA, linha: 29, coluna: 7 },
  { id: 8, parent: 1, nome: 'fatorial', url: PAGINA, linha: 39, coluna: 0 },
  { id: 9, parent: 8, nome: 'fatorial', url: PAGINA, linha: 39, coluna: 0 },
  { id: 10, parent: 9, nome: 'fatorial', url: PAGINA, linha: 39, coluna: 0 },
];

function resumirArvore(amostras: number[], deltas: number[], excluidos?: IntervaloTrace[]) {
  const agregador = criarAgregadorCpu({ excluidos });
  agregador.receber([abertura(1_000_000), pedaco(ARVORE, amostras, deltas)]);
  return agregador.resumir();
}

const funcao = (resumo: ReturnType<typeof resumirArvore>, nome: string) => resumo.funcoes.find((f) => f.nome === nome)!;

describe('tempo próprio e tempo total', () => {
  it('soma o delta de cada amostra no nó do topo (próprio) e em cada função da pilha (total)', () => {
    // principal: 1 ms; pesada: 3 ms; anônima: 2 ms.
    const resumo = resumirArvore([4, 5, 5, 7, 5], [1000, 1000, 1000, 2000, 1000]);
    expect(funcao(resumo, 'pesada')).toMatchObject({ tempoProprio: 3, tempoTotal: 3, arquivo: PAGINA, linha: 20, coluna: 5 });
    expect(funcao(resumo, 'principal')).toMatchObject({ tempoProprio: 1, tempoTotal: 6, linha: 10, coluna: 1 });
    expect(resumo.tempoAmostrado).toBe(6);
    expect(resumo.amostras).toBe(5);
  });

  it('ordena por tempo próprio decrescente', () => {
    const resumo = resumirArvore([4, 5, 5, 7, 5], [1000, 1000, 1000, 2000, 1000]);
    expect(resumo.funcoes.map((f) => f.nome)).toEqual(['pesada', NOME_ANONIMA, 'principal']);
  });

  it('conta uma função recursiva uma vez por amostra no tempo total', () => {
    // Três níveis de fatorial na pilha: o total não pode ser 3 × o tempo.
    const resumo = resumirArvore([10, 10, 9, 8], [1000, 1000, 1000, 1000]);
    expect(resumo.funcoes).toHaveLength(1);
    expect(funcao(resumo, 'fatorial')).toMatchObject({ tempoProprio: 4, tempoTotal: 4, percentual: 100 });
  });

  it('identifica a função sem nome como anônima, com a origem', () => {
    const resumo = resumirArvore([7], [500]);
    expect(funcao(resumo, NOME_ANONIMA)).toMatchObject({ arquivo: PAGINA, linha: 30, coluna: 8, tempoProprio: 0.5 });
  });

  it('separa funções de mesmo nome em origens diferentes', () => {
    const agregador = criarAgregadorCpu();
    agregador.receber([
      abertura(0),
      pedaco(
        [
          { id: 1, nome: '(root)' },
          { id: 2, parent: 1, nome: 'render', url: PAGINA, linha: 1 },
          { id: 3, parent: 1, nome: 'render', url: PAGINA, linha: 50 },
        ],
        [2, 3, 3],
        [1000, 1000, 1000],
      ),
    ]);
    expect(agregador.resumir().funcoes.map((f) => [f.nome, f.linha, f.tempoProprio])).toEqual([
      ['render', 51, 2],
      ['render', 2, 1],
    ]);
  });

  it('mantém sem origem a função que o navegador não localiza', () => {
    const agregador = criarAgregadorCpu();
    agregador.receber([abertura(0), pedaco([{ id: 1, nome: '(root)' }, { id: 2, parent: 1, nome: 'sort' }], [2], [1000])]);
    expect(agregador.resumir().funcoes).toEqual([
      { nome: 'sort', arquivo: null, linha: null, coluna: null, tempoProprio: 1, tempoTotal: 1, percentual: 100 },
    ]);
  });

  it('ignora deltas negativos na soma, sem perder o instante das amostras seguintes', () => {
    const resumo = resumirArvore([5, 5, 5], [1000, -200, 1000], [{ inicio: 1_001_700, fim: 1_001_900 }]);
    // A terceira amostra cai em 1 001 800, dentro do intervalo excluído.
    expect(funcao(resumo, 'pesada').tempoProprio).toBe(1);
  });
});

describe('categorias do motor e extensões', () => {
  it('soma ocioso, coleta de lixo e programa à parte, fora da lista de funções', () => {
    const resumo = resumirArvore([3, 3, 2, 6, 5, 1], [4000, 4000, 500, 300, 1000, 200]);
    expect(resumo.categorias).toEqual({ ocioso: 8, coletaDeLixo: 0.3, programa: 0.7, extensoes: 0 });
    expect(resumo.funcoes.map((f) => f.nome)).toEqual(['pesada', 'principal']);
    expect(resumo.funcoes.some((f) => f.nome.startsWith('('))).toBe(false);
  });

  it('calcula os percentuais sobre o tempo amostrado sem o ocioso', () => {
    // Amostrado: 10 ms; ocioso: 8 ms; ativo: 2 ms. pesada tem 1 ms próprio.
    const resumo = resumirArvore([3, 3, 2, 6, 5, 1], [4000, 4000, 500, 300, 1000, 200]);
    expect(resumo.tempoAmostrado).toBe(10);
    expect(resumo.tempoAtivo).toBe(2);
    expect(funcao(resumo, 'pesada').percentual).toBe(50);
  });

  it('conta a coleta de lixo no tempo total de quem a provocou', () => {
    const resumo = resumirArvore([6, 5], [300, 1000]);
    expect(funcao(resumo, 'pesada')).toMatchObject({ tempoProprio: 1, tempoTotal: 1.3 });
  });

  it('agrupa funções de extensões em "extensões"', () => {
    const agregador = criarAgregadorCpu();
    agregador.receber([
      abertura(0),
      pedaco(
        [
          { id: 1, nome: '(root)' },
          { id: 2, parent: 1, nome: 'observar', url: 'chrome-extension://abc/injected.js', linha: 3 },
          { id: 3, parent: 2, nome: 'outra', url: 'chrome-extension://abc/injected.js', linha: 9 },
          { id: 4, parent: 1, nome: 'daPagina', url: PAGINA, linha: 1 },
        ],
        [2, 3, 4],
        [1000, 2000, 1000],
      ),
    ]);
    const resumo = agregador.resumir();
    expect(resumo.categorias.extensoes).toBe(3);
    expect(resumo.funcoes.map((f) => f.nome)).toEqual(['daPagina']);
    expect(resumo.funcoes[0]!.percentual).toBe(25);
  });

  it('página só ociosa: lista de funções vazia e percentuais em zero', () => {
    const resumo = resumirArvore([3, 3], [5000, 5000]);
    expect(resumo).toMatchObject({ tempoAmostrado: 10, tempoAtivo: 0, funcoes: [], outras: null });
    expect(resumo.categorias.ocioso).toBe(10);
  });
});

describe('intervalos excluídos e limite', () => {
  it('descarta as amostras dentro dos intervalos de snapshot e de coleta forçada', () => {
    // Instantes das amostras: 1 001 000, 1 002 000, 1 003 000, 1 004 000.
    const resumo = resumirArvore([5, 7, 7, 5], [1000, 1000, 1000, 1000], [{ inicio: 1_001_500, fim: 1_003_000 }]);
    // principal não tem tempo próprio, mas chamou pesada: entra pelo tempo total.
    expect(resumo.funcoes.map((f) => [f.nome, f.tempoProprio, f.tempoTotal])).toEqual([
      ['pesada', 2, 2],
      ['principal', 0, 2],
    ]);
    expect(resumo.tempoAmostrado).toBe(2);
    expect(resumo.amostras).toBe(2);
  });

  it('trata o intervalo ainda aberto como excluído até o fim', () => {
    const resumo = resumirArvore([5, 7, 7], [1000, 1000, 1000], [{ inicio: 1_001_500, fim: null }]);
    expect(resumo.funcoes.map((f) => f.nome)).toEqual(['pesada', 'principal']);
    expect(resumo.tempoAmostrado).toBe(1);
  });

  it('guarda as funções até o limite e soma o resto em "outras"', () => {
    const nos: NoTeste[] = [{ id: 1, nome: '(root)' }];
    for (let i = 0; i < 250; i++) nos.push({ id: i + 2, parent: 1, nome: `f${i}`, url: PAGINA, linha: i });
    const agregador = criarAgregadorCpu();
    // f0 é a mais pesada (250 ms), f249 a mais leve (1 ms).
    agregador.receber([abertura(0), pedaco(nos, nos.slice(1).map((n) => n.id), nos.slice(1).map((_, i) => (250 - i) * 1000))]);
    const resumo = agregador.resumir();
    expect(resumo.funcoes).toHaveLength(200);
    expect(resumo.funcoes[0]!.nome).toBe('f0');
    expect(resumo.funcoes.at(-1)!.nome).toBe('f199');
    // Sobram f200..f249: 50 + 49 + ... + 1 = 1275 ms.
    expect(resumo.outras).toEqual({ quantidade: 50, tempoProprio: 1275, percentual: 4.06 });
    expect(resumo.tempoAmostrado).toBe(31_375);
  });

  it('aceita outro limite', () => {
    const agregador = criarAgregadorCpu({ limite: 1 });
    agregador.receber([abertura(1_000_000), pedaco(ARVORE, [5, 5, 7], [1000, 1000, 1000])]);
    const resumo = agregador.resumir();
    expect(resumo.funcoes.map((f) => f.nome)).toEqual(['pesada']);
    expect(resumo.outras).toMatchObject({ quantidade: 2, tempoProprio: 1 });
  });
});

describe('entrega em pedaços', () => {
  it('junta pedaços sucessivos: nós de um pedaço valem para os seguintes', () => {
    const agregador = criarAgregadorCpu({ excluidos: [{ inicio: 1_002_500, fim: 1_003_500 }] });
    agregador.receber([abertura(1_000_000), pedaco(ARVORE.slice(0, 5), [5, 5], [1000, 1000])]);
    agregador.receber([{ name: 'RunTask', ts: 5 }, pedaco(ARVORE.slice(6, 7), [7, 5], [1000, 1000])]);
    const resumo = agregador.resumir();
    // A terceira amostra (1 003 000) está excluída; a quarta volta a contar.
    expect(funcao(resumo, 'pesada').tempoProprio).toBe(3);
    expect(resumo.funcoes.some((f) => f.nome === NOME_ANONIMA)).toBe(false);
  });

  it('um nó reenviado em outro pedaço mantém o tempo já somado', () => {
    const agregador = criarAgregadorCpu();
    agregador.receber([abertura(1_000_000), pedaco(ARVORE, [5], [3000]), pedaco(ARVORE, [5], [1000])]);
    expect(funcao(agregador.resumir(), 'pesada').tempoProprio).toBe(4);
  });

  it('guarda os pedaços que chegam antes da abertura do perfil', () => {
    const agregador = criarAgregadorCpu({ excluidos: [{ inicio: 0, fim: 1_001_500 }] });
    agregador.receber([pedaco(ARVORE, [5, 5], [1000, 1000])]);
    agregador.receber([abertura(1_000_000)]);
    expect(funcao(agregador.resumir(), 'pesada').tempoProprio).toBe(1);
  });

  it('soma perfis diferentes do mesmo trace', () => {
    const agregador = criarAgregadorCpu();
    agregador.receber([abertura(0, '0x1'), abertura(0, '0x2'), pedaco(ARVORE, [5], [1000], '0x1'), pedaco(ARVORE, [5], [2000], '0x2')]);
    expect(funcao(agregador.resumir(), 'pesada').tempoProprio).toBe(3);
  });

  it('sem eventos de perfil, devolve um resumo vazio', () => {
    const agregador = criarAgregadorCpu();
    agregador.receber([{ name: 'RunTask' }, null, 'lixo']);
    expect(agregador.resumir()).toMatchObject({ tempoAmostrado: 0, amostras: 0, funcoes: [], outras: null });
  });
});

describe('mensagemFalhaCpu', () => {
  it('explica o trace já em andamento', () => {
    expect(mensagemFalhaCpu(new Error('{"code":-32000,"message":"Tracing has already been started (possibly in another tab)."}'))).toContain(
      'já tem um trace em andamento',
    );
  });

  it('preserva a mensagem original nas outras falhas', () => {
    expect(mensagemFalhaCpu(new Error('falhou assim'))).toContain('falhou assim');
  });
});
