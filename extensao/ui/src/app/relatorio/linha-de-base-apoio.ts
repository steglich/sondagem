import type { LinhaDeBase } from '../../../../shared/comparacao';
import type { RegistroExecucao } from '../../../../shared/historico';
import type { PonteExtensao } from '../sessao/ponte';

export interface LinhaDeBaseCarregada {
  linha: LinhaDeBase | null;
  /** Execução de referência; `null` sem linha de base. */
  base: RegistroExecucao | null;
  /** `true` se havia linha de base, mas a execução de referência saiu do histórico: ela foi desfeita agora. */
  desfeita: boolean;
}

/**
 * Lê a linha de base do cenário com a execução de referência. A retenção nunca
 * remove a referência, mas o usuário pode removê-la à mão: nesse caso a linha de
 * base é desfeita aqui, e quem chamou avisa.
 */
export async function carregarLinhaDeBase(ponte: PonteExtensao, cenario: string): Promise<LinhaDeBaseCarregada> {
  const linha = await ponte.lerLinhaDeBase(cenario);
  if (!linha) return { linha: null, base: null, desfeita: false };
  const base = await ponte.lerRegistro(linha.id);
  if (base) return { linha, base, desfeita: false };
  await ponte.removerLinhaDeBase(cenario);
  return { linha: null, base: null, desfeita: true };
}
