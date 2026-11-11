/**
 * Cenários salvos na extensão, indexados pelo nome, e o cenário escolhido para a
 * próxima análise. Ficam em `chrome.storage.local`; os resultados não passam por aqui.
 */
import { type Cenario, validarCenario } from '../shared/cenario.ts';
import type { Armazenamento } from './selecao.ts';

export const CHAVE_CENARIOS = 'sondagem:cenarios';
export const CHAVE_CENARIO_SELECIONADO = 'sondagem:cenario-selecionado';

async function lerTodos(armazenamento: Armazenamento): Promise<Record<string, Cenario>> {
  const guardado = (await armazenamento.get(CHAVE_CENARIOS))[CHAVE_CENARIOS];
  if (!guardado || typeof guardado !== 'object') return {};
  const validos: Record<string, Cenario> = {};
  // O que foi salvo por uma versão anterior e não passa mais na validação fica de fora.
  for (const [nome, valor] of Object.entries(guardado as Record<string, unknown>)) {
    const resultado = validarCenario(valor);
    if (resultado.ok && resultado.cenario.nome === nome) validos[nome] = resultado.cenario;
  }
  return validos;
}

/** Cenários salvos, em ordem alfabética do nome. */
export async function listarCenarios(armazenamento: Armazenamento): Promise<Cenario[]> {
  const todos = await lerTodos(armazenamento);
  return Object.values(todos).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Salva o cenário (já validado). Outro com o mesmo nome é substituído. */
export async function salvarCenario(armazenamento: Armazenamento, cenario: Cenario): Promise<void> {
  const todos = await lerTodos(armazenamento);
  todos[cenario.nome] = cenario;
  await armazenamento.set({ [CHAVE_CENARIOS]: todos });
}

export async function removerCenario(armazenamento: Armazenamento, nome: string): Promise<void> {
  const todos = await lerTodos(armazenamento);
  delete todos[nome];
  const itens: Record<string, unknown> = { [CHAVE_CENARIOS]: todos };
  if ((await lerNomeSelecionado(armazenamento)) === nome) itens[CHAVE_CENARIO_SELECIONADO] = null;
  await armazenamento.set(itens);
}

async function lerNomeSelecionado(armazenamento: Armazenamento): Promise<string | null> {
  const nome = (await armazenamento.get(CHAVE_CENARIO_SELECIONADO))[CHAVE_CENARIO_SELECIONADO];
  return typeof nome === 'string' ? nome : null;
}

/** Nome do cenário escolhido para a próxima análise, ou `null`. Um nome que não existe mais não vale. */
export async function lerCenarioSelecionado(armazenamento: Armazenamento): Promise<string | null> {
  const nome = await lerNomeSelecionado(armazenamento);
  return nome !== null && Object.hasOwn(await lerTodos(armazenamento), nome) ? nome : null;
}

export async function selecionarCenario(armazenamento: Armazenamento, nome: string | null): Promise<void> {
  await armazenamento.set({ [CHAVE_CENARIO_SELECIONADO]: nome });
}
