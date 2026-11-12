/** Outras extensões ativas no perfil: podem injetar código na página e distorcer a medição. */
import type { ExtensaoAtiva } from './types.ts';

/** O que este módulo usa de cada item de `chrome.management.getAll()`. */
export interface ExtensaoInstalada {
  id: string;
  name: string;
  enabled: boolean;
  /** `extension`, `theme`, `hosted_app`, ... Só extensões rodam código nas páginas. */
  type: string;
}

/** Extensões ligadas, fora a própria, em ordem alfabética. Só o nome e o id são lidos. */
export function outrasExtensoesAtivas(instaladas: readonly ExtensaoInstalada[], idProprio: string): ExtensaoAtiva[] {
  return instaladas
    .filter((item) => item.enabled && item.type === 'extension' && item.id !== idProprio)
    .map((item) => ({ id: item.id, nome: item.name }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
