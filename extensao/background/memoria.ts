/**
 * Medições de memória pelo CDP: medição leve, coleta de lixo forçada, contadores de
 * DOM e censo de objetos por construtor. Usado pelo runner de cenários e pela sessão
 * manual. Não usa `chrome.*`: os comandos chegam por `CanalCdp`.
 *
 * Só entram aqui comandos que o `chrome.debugger` aceita de uma extensão. Os
 * domínios `HeapProfiler` e `Memory` e o comando `Runtime.getHeapUsage` são recusados
 * a clientes não confiáveis, então não há heap snapshot: o passo `snapshot` faz um
 * censo (quantos objetos vivos de cada construtor). `COMANDOS_DE_MEMORIA` lista o que
 * é usado, e um teste de integração confere cada um no navegador.
 */
import { marcarLongTasksDaMedicao } from '../shared/agregacao.ts';
import type { MetricaMedir } from '../shared/cenario.ts';
import { LIMITE_CONSTRUTORES } from '../shared/memoria.ts';
import type { ContadoresDom, DadosCenso, DadosColetados, Intervalo, MedicaoMemoria, ResumoSnapshot } from '../shared/types.ts';
import type { ConexaoCdp } from './cdp.ts';

export type CanalCdp = Pick<ConexaoCdp, 'enviar'>;

/** Todo comando de CDP que este módulo envia. */
export const COMANDOS_DE_MEMORIA = [
  'Runtime.evaluate',
  'Runtime.queryObjects',
  'Runtime.callFunctionOn',
  'Runtime.releaseObjectGroup',
  'Performance.enable',
  'Performance.getMetrics',
  'DOM.enable',
  'DOM.getDetachedDomNodes',
  'DOM.disable',
] as const;

/** Grupos de objetos remotos, liberados ao fim de cada operação para não segurar nada da página. */
export const GRUPO_COLETA = 'sondagem-coleta';
export const GRUPO_CENSO = 'sondagem-censo';

export interface ContextoMemoria {
  cdp: CanalCdp;
  /** Dados da sessão: as funções deste módulo acrescentam aqui o que medem. */
  dados: DadosColetados;
  agora: () => number;
  /** Quantos construtores o censo guarda. O padrão é `LIMITE_CONSTRUTORES`. */
  limiteConstrutores?: number;
}

/** O censo não pôde ser concluído; a mensagem diz o motivo ao usuário. */
export class FalhaSnapshot extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'FalhaSnapshot';
  }
}

interface ObjetoRemoto {
  objectId?: string;
}

interface DetalhesDeExcecao {
  text?: string;
  exception?: { description?: string };
}

interface NoDom {
  children?: NoDom[];
  shadowRoots?: NoDom[];
  contentDocument?: NoDom;
}

/** Uma árvore fora do documento, como `DOM.getDetachedDomNodes` devolve: a raiz já vem com os descendentes. */
interface ArvoreDesanexada {
  treeNode?: NoDom;
}

/**
 * Pede ao navegador todos os objetos vivos do mundo principal da página (os que têm
 * `Object.prototype` na cadeia). Para responder, o navegador faz antes uma coleta de
 * lixo completa. Devolve o identificador da lista, que vive no `grupo` até ele ser liberado.
 */
async function consultarObjetosVivos(cdp: CanalCdp, grupo: string): Promise<string> {
  const prototipo = await cdp.enviar<{ result?: ObjetoRemoto }>('Runtime.evaluate', { expression: 'Object.prototype', objectGroup: grupo });
  const idPrototipo = prototipo.result?.objectId;
  if (!idPrototipo) throw new FalhaSnapshot('A página não devolveu Object.prototype.');
  const consulta = await cdp.enviar<{ objects?: ObjetoRemoto }>('Runtime.queryObjects', { prototypeObjectId: idPrototipo, objectGroup: grupo });
  const idLista = consulta.objects?.objectId;
  if (!idLista) throw new FalhaSnapshot('O navegador não devolveu a lista de objetos da página.');
  return idLista;
}

async function liberar(cdp: CanalCdp, grupo: string): Promise<void> {
  // Se a conexão caiu ou a análise foi cancelada, o debugger sai e leva o grupo junto.
  await cdp.enviar('Runtime.releaseObjectGroup', { objectGroup: grupo }).catch(() => undefined);
}

/**
 * Coleta de lixo completa; só volta quando o navegador termina. `HeapProfiler.collectGarbage`
 * não existe para extensões: a coleta vem como efeito de `Runtime.queryObjects`.
 */
export async function forcarColeta(contexto: Pick<ContextoMemoria, 'cdp'>): Promise<void> {
  try {
    await consultarObjetosVivos(contexto.cdp, GRUPO_COLETA);
  } finally {
    await liberar(contexto.cdp, GRUPO_COLETA);
  }
}

async function lerMetricas(cdp: CanalCdp): Promise<{ heap: number | null; nos: number | null; listeners: number | null }> {
  await cdp.enviar('Performance.enable');
  const { metrics = [] } = await cdp.enviar<{ metrics?: { name: string; value: number }[] }>('Performance.getMetrics');
  const valor = (nome: string): number | null => metrics.find((m) => m.name === nome)?.value ?? null;
  return { heap: valor('JSHeapUsedSize'), nos: valor('Nodes'), listeners: valor('JSEventListeners') };
}

/** Medição leve: contadores do navegador, sem percorrer o heap. */
export async function medirMemoria(
  contexto: Pick<ContextoMemoria, 'cdp' | 'dados' | 'agora'>,
  metricas: readonly MetricaMedir[],
  iteracao?: number | null,
): Promise<MedicaoMemoria> {
  const medicao: MedicaoMemoria = { instante: contexto.agora(), heapUsado: null, nosDom: null, listeners: null };
  if (iteracao !== undefined) medicao.iteracao = iteracao;
  const lidas = await lerMetricas(contexto.cdp);
  if (metricas.includes('heap_usado')) medicao.heapUsado = lidas.heap;
  if (metricas.includes('nos_dom')) medicao.nosDom = lidas.nos;
  if (metricas.includes('listeners')) medicao.listeners = lidas.listeners;
  contexto.dados.medicoes.push(medicao);
  return medicao;
}

/** Nós de uma árvore desanexada: a raiz e tudo o que está pendurado nela, inclusive os nós de texto. */
function contarNos(no: NoDom): number {
  let total = 1;
  for (const filho of no.children ?? []) total += contarNos(filho);
  for (const sombra of no.shadowRoots ?? []) total += contarNos(sombra);
  if (no.contentDocument) total += contarNos(no.contentDocument);
  return total;
}

/**
 * Lê nós DOM, listeners e nós desanexados e guarda como o valor de início ou de fim
 * da análise. Coleta o lixo antes: um nó já solto e ainda não coletado contaria como
 * desanexado. Se o navegador não tiver `DOM.getDetachedDomNodes`, os outros dois ficam.
 */
export async function lerContadoresDom(contexto: Pick<ContextoMemoria, 'cdp' | 'dados'>, momento: 'inicio' | 'fim'): Promise<ContadoresDom> {
  const { cdp, dados } = contexto;
  await forcarColeta(contexto);
  const lidas = await lerMetricas(cdp);
  const contadores: ContadoresDom = { nosDom: lidas.nos ?? 0, listeners: lidas.listeners ?? 0, nosDesanexados: null };
  dados.contadoresDom[momento] = contadores;
  // O domínio DOM fica habilitado só durante a leitura.
  await cdp.enviar('DOM.enable');
  try {
    const { detachedNodes = [] } = await cdp.enviar<{ detachedNodes?: ArvoreDesanexada[] }>('DOM.getDetachedDomNodes');
    contadores.nosDesanexados = detachedNodes.reduce((total, arvore) => total + (arvore.treeNode ? contarNos(arvore.treeNode) : 1), 0);
  } finally {
    await cdp.enviar('DOM.disable').catch(() => undefined);
  }
  return contadores;
}

/**
 * Roda NA PÁGINA, com `this` sendo a lista de objetos vivos: conta os objetos pelo
 * nome do construtor e devolve só a tabela. É enviada como texto por
 * `Runtime.callFunctionOn`, então não pode usar nada de fora do próprio corpo.
 * Ler `constructor.name` pode acionar um getter da aplicação; o que falhar entra em
 * "(inacessível)".
 */
export function contarPorConstrutor(this: readonly unknown[], limite: number): DadosCenso {
  const contagens = new Map<string, number>();
  for (const objeto of this) {
    let nome: string;
    try {
      const construtor: unknown = Object.getPrototypeOf(objeto)?.constructor;
      if (typeof construtor !== 'function') nome = '(sem construtor)';
      else nome = typeof construtor.name === 'string' && construtor.name !== '' ? construtor.name : '(anônimo)';
    } catch {
      nome = '(inacessível)';
    }
    contagens.set(nome, (contagens.get(nome) ?? 0) + 1);
  }
  const ordenados = [...contagens].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const resto = ordenados.slice(limite);
  return {
    totalObjetos: this.length,
    construtores: ordenados.slice(0, limite).map(([nome, contagem]) => ({ nome, contagem })),
    outros: resto.length > 0 ? { nome: '(outros)', contagem: resto.reduce((total, [, contagem]) => total + contagem, 0) } : null,
  };
}

function ehCenso(valor: unknown): valor is DadosCenso {
  const censo = valor as Partial<DadosCenso> | null;
  return typeof censo?.totalObjetos === 'number' && Array.isArray(censo.construtores);
}

/**
 * Passo `snapshot`: censo de objetos vivos por construtor. Da página só sai a tabela
 * de contagens, e a lista de objetos é liberada no fim, mesmo em erro. O intervalo em
 * que a página ficou ocupada é registrado, para que as long tasks dele não contem.
 */
export async function tirarSnapshot(contexto: ContextoMemoria, rotulo: string, iteracao?: number | null): Promise<ResumoSnapshot> {
  const { cdp, dados, agora } = contexto;
  const instante = agora();
  const pausa: Intervalo = { inicio: instante, fim: null };
  dados.pausasDeMedicao.push(pausa);
  try {
    const idLista = await consultarObjetosVivos(cdp, GRUPO_CENSO);
    const resposta = await cdp.enviar<{ result?: { value?: unknown }; exceptionDetails?: DetalhesDeExcecao }>('Runtime.callFunctionOn', {
      objectId: idLista,
      functionDeclaration: contarPorConstrutor.toString(),
      arguments: [{ value: contexto.limiteConstrutores ?? LIMITE_CONSTRUTORES }],
      returnByValue: true,
    });
    if (resposta.exceptionDetails) {
      const detalhe = resposta.exceptionDetails.exception?.description ?? resposta.exceptionDetails.text ?? 'erro';
      throw new FalhaSnapshot(`A página recusou a contagem de objetos: ${detalhe.split('\n')[0]}`);
    }
    const censo = resposta.result?.value;
    if (!ehCenso(censo)) throw new FalhaSnapshot('A contagem de objetos voltou em um formato inesperado.');
    const resumo: ResumoSnapshot = { totalObjetos: censo.totalObjetos, construtores: censo.construtores, outros: censo.outros ?? null, rotulo, instante };
    if (iteracao !== undefined) resumo.iteracao = iteracao;
    dados.snapshots.push(resumo);
    return resumo;
  } finally {
    pausa.fim = agora();
    marcarLongTasksDaMedicao(dados);
    await liberar(cdp, GRUPO_CENSO);
  }
}
