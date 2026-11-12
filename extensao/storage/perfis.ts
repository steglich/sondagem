/**
 * Perfis de throttling personalizados, salvos pelo usuário em `chrome.storage.local`
 * e referenciados pelo nome em `execucao.throttling`. Os perfis "nenhum" e "padrao"
 * são embutidos e não passam por aqui.
 */
import { type PerfilThrottling, erroDoPerfil } from '../shared/condicoes.ts';
import type { Armazenamento } from './selecao.ts';

export const CHAVE_PERFIS = 'sondagem:perfis-throttling';

function normalizar(valor: unknown): PerfilThrottling | null {
  if (!valor || typeof valor !== 'object') return null;
  const v = valor as Partial<PerfilThrottling>;
  if (typeof v.nome !== 'string' || typeof v.cpu !== 'number') return null;
  const r = v.rede;
  const taxa = (t: unknown): number | null => (typeof t === 'number' ? t : null);
  const perfil: PerfilThrottling = {
    nome: v.nome,
    cpu: v.cpu,
    rede:
      r && typeof r === 'object' && typeof r.latenciaMs === 'number'
        ? { latenciaMs: r.latenciaMs, downloadKbps: taxa(r.downloadKbps), uploadKbps: taxa(r.uploadKbps) }
        : null,
  };
  return erroDoPerfil(perfil) === null ? perfil : null;
}

/** Perfis salvos, em ordem alfabética. O que não é mais válido fica de fora. */
export async function listarPerfis(armazenamento: Armazenamento): Promise<PerfilThrottling[]> {
  const guardado = (await armazenamento.get(CHAVE_PERFIS))[CHAVE_PERFIS];
  if (!Array.isArray(guardado)) return [];
  return guardado
    .map(normalizar)
    .filter((perfil) => perfil !== null)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Salva o perfil (já conferido com `erroDoPerfil`). Outro com o mesmo nome é substituído. */
export async function salvarPerfil(armazenamento: Armazenamento, perfil: PerfilThrottling): Promise<void> {
  const erro = erroDoPerfil(perfil);
  if (erro) throw new Error(erro);
  const nome = perfil.nome.trim();
  const outros = (await listarPerfis(armazenamento)).filter((p) => p.nome !== nome);
  await armazenamento.set({ [CHAVE_PERFIS]: [...outros, { ...perfil, nome }] });
}

export async function removerPerfil(armazenamento: Armazenamento, nome: string): Promise<void> {
  await armazenamento.set({ [CHAVE_PERFIS]: (await listarPerfis(armazenamento)).filter((p) => p.nome !== nome) });
}
