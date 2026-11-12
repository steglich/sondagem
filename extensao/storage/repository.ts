/**
 * Repositório de resultados sobre IndexedDB: a única porta de acesso ao histórico.
 *
 * Banco `sondagem`, com dois object stores de mesma chave (`id`):
 *   - `execucoes`: metadados e estatísticas, com índices por cenário (`grupo`) e por data (`inicio`);
 *   - `detalhes`: as listas grandes de cada execução.
 * Listar o histórico lê só `execucoes`. Preferências e cenários ficam em
 * `chrome.storage.local`, fora daqui.
 */
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import {
  type DetalhesExecucao,
  type ExecucaoGuardada,
  type PoliticaRetencao,
  type RegistroExecucao,
  idsARemover,
} from '../shared/historico.ts';
import type { DadosColetados } from '../shared/types.ts';

export const NOME_DO_BANCO = 'sondagem';
export const VERSAO_DO_BANCO = 1;

interface Esquema extends DBSchema {
  execucoes: { key: string; value: RegistroExecucao; indexes: { grupo: string; inicio: number } };
  detalhes: { key: string; value: DetalhesExecucao };
}

export interface RepositorioResultados {
  /** Cria ou substitui a execução (registro e detalhes, na mesma transação). */
  gravar(registro: RegistroExecucao, dados: DadosColetados): Promise<void>;
  /** Registro e detalhes de uma execução, ou `null` se não existe. */
  ler(id: string): Promise<ExecucaoGuardada | null>;
  /** Registros, da execução mais recente para a mais antiga, sem os detalhes. Com `grupo`, só os daquele cenário. */
  listar(filtro?: { grupo?: string }): Promise<RegistroExecucao[]>;
  /** Execuções que ficaram como "em andamento". */
  emAndamento(): Promise<RegistroExecucao[]>;
  remover(id: string): Promise<void>;
  /** Soma do tamanho estimado de todas as execuções, em bytes. */
  tamanhoTotal(): Promise<number>;
  /** Remove o que a política de retenção manda e devolve os ids removidos. */
  aplicarRetencao(retencao: PoliticaRetencao, agora: number): Promise<string[]>;
}

/** O banco só é aberto no primeiro uso. Nos testes, o `indexedDB` global é o do `fake-indexeddb`. */
export function criarRepositorio(): RepositorioResultados {
  let banco: Promise<IDBPDatabase<Esquema>> | null = null;

  function abrir(): Promise<IDBPDatabase<Esquema>> {
    banco ??= abrirBanco();
    // Uma falha ao abrir não pode ficar guardada: a próxima chamada tenta de novo.
    banco.catch(() => (banco = null));
    return banco;
  }

  async function removerVarios(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const transacao = (await abrir()).transaction(['execucoes', 'detalhes'], 'readwrite');
    await Promise.all([
      ...ids.flatMap((id) => [transacao.objectStore('execucoes').delete(id), transacao.objectStore('detalhes').delete(id)]),
      transacao.done,
    ]);
  }

  const repositorio: RepositorioResultados = {
    async gravar(registro, dados) {
      const transacao = (await abrir()).transaction(['execucoes', 'detalhes'], 'readwrite');
      await Promise.all([
        transacao.objectStore('execucoes').put(registro),
        transacao.objectStore('detalhes').put({ id: registro.id, dados }),
        transacao.done,
      ]);
    },

    async ler(id) {
      const transacao = (await abrir()).transaction(['execucoes', 'detalhes'], 'readonly');
      const [registro, detalhes] = await Promise.all([transacao.objectStore('execucoes').get(id), transacao.objectStore('detalhes').get(id)]);
      return registro && detalhes ? { registro, dados: detalhes.dados } : null;
    },

    async listar(filtro) {
      const db = await abrir();
      const registros =
        filtro?.grupo === undefined ? await db.getAllFromIndex('execucoes', 'inicio') : await db.getAllFromIndex('execucoes', 'grupo', filtro.grupo);
      return registros.sort((a, b) => b.inicio - a.inicio);
    },

    async emAndamento() {
      return (await repositorio.listar()).filter((registro) => registro.estado === 'em-andamento');
    },

    remover: (id) => removerVarios([id]),

    async tamanhoTotal() {
      return (await repositorio.listar()).reduce((total, registro) => total + registro.tamanho, 0);
    },

    async aplicarRetencao(retencao, agora) {
      const ids = idsARemover(await repositorio.listar(), retencao, agora);
      await removerVarios(ids);
      return ids;
    },
  };
  return repositorio;
}

function abrirBanco(): Promise<IDBPDatabase<Esquema>> {
  return openDB<Esquema>(NOME_DO_BANCO, VERSAO_DO_BANCO, {
    upgrade(db) {
      const execucoes = db.createObjectStore('execucoes', { keyPath: 'id' });
      execucoes.createIndex('grupo', 'grupo');
      execucoes.createIndex('inicio', 'inicio');
      db.createObjectStore('detalhes', { keyPath: 'id' });
    },
  });
}
