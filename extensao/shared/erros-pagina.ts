/** Conversão dos eventos `Runtime.exceptionThrown` do CDP em registros de erro da página. */
import type { ErroPagina } from './types.ts';

/** Recorte de `Runtime.ExceptionDetails` que a extensão usa. */
interface DetalhesExcecao {
  text?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  exception?: { description?: string; value?: unknown; className?: string };
  stackTrace?: { callFrames?: { url?: string; lineNumber?: number; columnNumber?: number }[] };
}

/**
 * Monta o registro a partir do evento. O CDP conta linhas e colunas a partir de
 * zero; o registro guarda a partir de um, como os editores mostram. Uma promise
 * rejeitada sem tratamento chega pelo mesmo evento, com o texto "Uncaught (in promise)".
 */
export function erroDaPagina(parametros: unknown, instante: number): ErroPagina {
  const detalhes = ((parametros as { exceptionDetails?: DetalhesExcecao } | null)?.exceptionDetails ?? {}) as DetalhesExcecao;
  const quadro = detalhes.stackTrace?.callFrames?.[0];
  const excecao = detalhes.exception;
  // `description` traz "Error: mensagem" seguido da pilha; só a primeira linha interessa.
  const descricao =
    excecao?.description?.split('\n')[0] ?? (excecao?.value !== undefined ? String(excecao.value) : undefined);
  const arquivo = detalhes.url || quadro?.url || null;
  const linha = detalhes.lineNumber ?? quadro?.lineNumber;
  const coluna = detalhes.columnNumber ?? quadro?.columnNumber;
  return {
    tipo: /in promise/i.test(detalhes.text ?? '') ? 'rejeicao' : 'excecao',
    mensagem: descricao ?? detalhes.text ?? 'Erro sem mensagem',
    arquivo,
    linha: linha === undefined ? null : linha + 1,
    coluna: coluna === undefined ? null : coluna + 1,
    instante,
  };
}
