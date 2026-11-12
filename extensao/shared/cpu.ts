/**
 * Agregação do perfil de CPU: eventos do trace → resumo por função. Pura, sem
 * `chrome.*`.
 *
 * O perfil vem do `Tracing` (categoria `disabled-by-default-v8.cpu_profiler`) como um
 * evento `Profile`, que abre o perfil e traz o instante de início, e vários
 * `ProfileChunk` com o mesmo `id`, cada um com nós novos da árvore de chamadas
 * (`id`, `parent`, `callFrame`), amostras (o nó no topo da pilha) e o tempo entre
 * amostras, em µs. A agregação é incremental: cada pedaço é somado e pode ser
 * descartado em seguida. Os pedaços de um perfil têm de chegar na ordem em que
 * foram gerados, que é a ordem em que o navegador os entrega.
 */
import type { CategoriasCpu, FuncaoCpu, ResumoCpu } from './types.ts';

/** Categoria de trace que carrega o perfil de CPU. */
export const CATEGORIA_PERFIL_CPU = 'disabled-by-default-v8.cpu_profiler';

/** Quantas funções o resumo guarda; o resto vai para a linha "outras". */
export const LIMITE_FUNCOES_CPU = 200;

/** Quantas funções a interface lista. */
export const FUNCOES_EXIBIDAS = 30;

/** Duração máxima do perfil na sessão manual. */
export const LIMITE_PERFIL_MANUAL_MS = 5 * 60_000;

export const NOME_ANONIMA = '(anônima)';

/** Intervalo no relógio do trace, em µs. `fim` nulo: ainda aberto. */
export interface IntervaloTrace {
  inicio: number;
  fim: number | null;
}

interface QuadroDeChamada {
  functionName?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface NoDoTrace {
  id: number;
  parent?: number;
  callFrame?: QuadroDeChamada;
}

interface EventoDoTrace {
  name?: string;
  id?: string | number;
  pid?: number;
  ts?: number;
  args?: {
    data?: {
      startTime?: number;
      cpuProfile?: { nodes?: NoDoTrace[]; samples?: number[] };
      timeDeltas?: number[];
    };
  };
}

type Categoria = keyof CategoriasCpu;

const CATEGORIA_DO_NO: Readonly<Record<string, Categoria>> = {
  '(idle)': 'ocioso',
  '(garbage collector)': 'coletaDeLixo',
  '(program)': 'programa',
  '(root)': 'programa',
};

interface No {
  pai: number | undefined;
  /** Categoria do motor, ou o índice da função em `funcoes`. */
  destino: Categoria | number;
  /** Tempo das amostras em que este nó estava no topo, em µs. */
  proprio: number;
}

interface Perfil {
  /** Instante da última amostra somada, em µs; `null` até o evento `Profile` chegar. */
  instante: number | null;
  nos: Map<number, No>;
  /** Pedaços que chegaram antes do `Profile` do perfil. */
  pendentes: EventoDoTrace[];
}

export interface AgregadorCpu {
  /** Soma os eventos de um `Tracing.dataCollected`. Eventos de outros tipos são ignorados. */
  receber(eventos: readonly unknown[]): void;
  resumir(): ResumoCpu;
}

export interface OpcoesAgregador {
  /** Amostras nestes intervalos não entram (censo e coleta forçada). A lista pode crescer durante a coleta. */
  excluidos?: readonly IntervaloTrace[];
  limite?: number;
}

const emMs = (microssegundos: number): number => Math.round(microssegundos) / 1000;

export function criarAgregadorCpu(opcoes: OpcoesAgregador = {}): AgregadorCpu {
  const excluidos = opcoes.excluidos ?? [];
  const limite = opcoes.limite ?? LIMITE_FUNCOES_CPU;
  const perfis = new Map<string, Perfil>();
  const funcoes: { nome: string; arquivo: string | null; linha: number | null; coluna: number | null }[] = [];
  const indicePorChave = new Map<string, number>();
  let amostras = 0;

  function perfilDe(evento: EventoDoTrace): Perfil {
    const chave = `${evento.pid ?? ''}:${evento.id ?? ''}`;
    let perfil = perfis.get(chave);
    if (!perfil) perfis.set(chave, (perfil = { instante: null, nos: new Map(), pendentes: [] }));
    return perfil;
  }

  function destinoDe(quadro: QuadroDeChamada): Categoria | number {
    const nome = quadro.functionName ?? '';
    const arquivo = quadro.url || null;
    if (arquivo === null) {
      const categoria = CATEGORIA_DO_NO[nome];
      if (categoria) return categoria;
    } else if (arquivo.startsWith('chrome-extension://')) return 'extensoes';
    // Linha e coluna chegam em base 0.
    const linha = quadro.lineNumber === undefined || quadro.lineNumber < 0 ? null : quadro.lineNumber + 1;
    const coluna = quadro.columnNumber === undefined || quadro.columnNumber < 0 ? null : quadro.columnNumber + 1;
    const chave = JSON.stringify([nome, arquivo, linha, coluna]);
    let indice = indicePorChave.get(chave);
    if (indice === undefined) {
      indice = funcoes.push({ nome: nome === '' ? NOME_ANONIMA : nome, arquivo, linha, coluna }) - 1;
      indicePorChave.set(chave, indice);
    }
    return indice;
  }

  const excluido = (instante: number): boolean => excluidos.some((i) => instante >= i.inicio && (i.fim === null || instante <= i.fim));

  function somarPedaco(perfil: Perfil, evento: EventoDoTrace): void {
    const dados = evento.args?.data;
    for (const no of dados?.cpuProfile?.nodes ?? []) {
      // Um nó repetido em outro pedaço não pode zerar o tempo já somado.
      if (!perfil.nos.has(no.id)) perfil.nos.set(no.id, { pai: no.parent, destino: destinoDe(no.callFrame ?? {}), proprio: 0 });
    }
    const deltas = dados?.timeDeltas ?? [];
    for (const [posicao, idNo] of (dados?.cpuProfile?.samples ?? []).entries()) {
      // O relógio do amostrador pode recuar alguns µs: o instante acompanha, o tempo somado não fica negativo.
      const delta = deltas[posicao] ?? 0;
      perfil.instante = (perfil.instante ?? 0) + delta;
      const no = perfil.nos.get(idNo);
      if (!no || delta <= 0 || excluido(perfil.instante)) continue;
      no.proprio += delta;
      amostras++;
    }
  }

  function abrir(perfil: Perfil, inicio: number): void {
    perfil.instante = inicio;
    for (const pendente of perfil.pendentes.splice(0)) somarPedaco(perfil, pendente);
  }

  return {
    receber(eventos) {
      for (const evento of eventos as readonly EventoDoTrace[]) {
        if (evento?.name === 'Profile') {
          const perfil = perfilDe(evento);
          if (perfil.instante === null) abrir(perfil, evento.args?.data?.startTime ?? evento.ts ?? 0);
        } else if (evento?.name === 'ProfileChunk') {
          const perfil = perfilDe(evento);
          if (perfil.instante === null) perfil.pendentes.push(evento);
          else somarPedaco(perfil, evento);
        }
      }
    },

    resumir() {
      const categorias: CategoriasCpu = { ocioso: 0, coletaDeLixo: 0, programa: 0, extensoes: 0 };
      const proprio = new Array<number>(funcoes.length).fill(0);
      const total = new Array<number>(funcoes.length).fill(0);
      let amostrado = 0;
      for (const perfil of perfis.values()) {
        // Perfil cujo evento de abertura não veio: o primeiro pedaço dá o instante de início.
        if (perfil.instante === null && perfil.pendentes.length > 0) abrir(perfil, perfil.pendentes[0]!.ts ?? 0);
        for (const no of perfil.nos.values()) {
          if (no.proprio === 0) continue;
          amostrado += no.proprio;
          if (typeof no.destino === 'string') categorias[no.destino] += no.proprio;
          else proprio[no.destino]! += no.proprio;
          // Tempo total: cada função da pilha recebe o tempo uma vez, mesmo que apareça repetida (recursão).
          const naPilha = new Set<number>();
          for (let atual: No | undefined = no; atual; atual = atual.pai === undefined ? undefined : perfil.nos.get(atual.pai)) {
            if (typeof atual.destino === 'number') naPilha.add(atual.destino);
          }
          for (const indice of naPilha) total[indice]! += no.proprio;
        }
      }
      const ativo = amostrado - categorias.ocioso;
      const percentual = (tempo: number): number => (ativo > 0 ? Math.round((tempo / ativo) * 10_000) / 100 : 0);
      const ordenadas = funcoes
        .map((funcao, indice) => ({ funcao, proprio: proprio[indice]!, total: total[indice]! }))
        .filter((f) => f.total > 0)
        .sort((a, b) => b.proprio - a.proprio || b.total - a.total || (a.funcao.nome < b.funcao.nome ? -1 : 1));
      const resto = ordenadas.slice(limite);
      const tempoDoResto = resto.reduce((soma, f) => soma + f.proprio, 0);
      return {
        tempoAmostrado: emMs(amostrado),
        tempoAtivo: emMs(ativo),
        amostras,
        categorias: {
          ocioso: emMs(categorias.ocioso),
          coletaDeLixo: emMs(categorias.coletaDeLixo),
          programa: emMs(categorias.programa),
          extensoes: emMs(categorias.extensoes),
        },
        funcoes: ordenadas.slice(0, limite).map(
          (f): FuncaoCpu => ({ ...f.funcao, tempoProprio: emMs(f.proprio), tempoTotal: emMs(f.total), percentual: percentual(f.proprio) }),
        ),
        outras: resto.length > 0 ? { quantidade: resto.length, tempoProprio: emMs(tempoDoResto), percentual: percentual(tempoDoResto) } : null,
      };
    },
  };
}

/** Texto para o usuário quando o perfil não pôde ser ligado. */
export function mensagemFalhaCpu(erro: unknown): string {
  const original = erro instanceof Error ? erro.message : String(erro);
  if (/already been started/i.test(original)) {
    return 'O perfil de CPU não foi coletado: o navegador já tem um trace em andamento (uma gravação do painel Performance, por exemplo).';
  }
  return `O perfil de CPU não foi coletado: ${original}`;
}

export const FALHA_CPU_SEM_LEITURA = 'O perfil de CPU não foi lido: a análise terminou antes de o navegador entregar os dados.';
