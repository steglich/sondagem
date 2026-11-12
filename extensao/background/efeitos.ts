/**
 * Pilha de efeitos reversíveis: o que a preparação de uma análise muda na aba
 * (throttling, cache) e a restauração desfaz, na ordem inversa.
 *
 * O "desfazer" de um efeito entra na pilha antes de o "aplicar" rodar: se a
 * aplicação falhar ou for cancelada no meio, ela pode ter valido no navegador, e
 * desfazer o que não foi feito é inofensivo.
 */
export interface Efeito {
  /** Nome para o diagnóstico (ex.: "throttling de CPU"). */
  nome: string;
  aplicar(): Promise<unknown>;
  desfazer(): Promise<unknown>;
}

export interface PilhaDeEfeitos {
  /** Aplica o efeito e guarda como desfazê-lo. Se a aplicação lançar, o erro segue para quem chamou. */
  aplicar(efeito: Efeito): Promise<void>;
  /**
   * Desfaz tudo na ordem inversa da aplicação. Uma falha ao desfazer não impede os
   * seguintes. Devolve os nomes do que foi desfeito com sucesso; chamar de novo não refaz nada.
   */
  desfazerTudo(): Promise<string[]>;
  /** Quantos efeitos ainda estão por desfazer. */
  readonly pendentes: number;
}

export function criarPilhaDeEfeitos(): PilhaDeEfeitos {
  const pilha: Efeito[] = [];
  return {
    get pendentes() {
      return pilha.length;
    },
    async aplicar(efeito) {
      pilha.push(efeito);
      await efeito.aplicar();
    },
    async desfazerTudo() {
      const desfeitos: string[] = [];
      for (let efeito = pilha.pop(); efeito; efeito = pilha.pop()) {
        try {
          await efeito.desfazer();
          desfeitos.push(efeito.nome);
        } catch {
          // A conexão caiu: o navegador desfaz as emulações ao soltar o debugger.
        }
      }
      return desfeitos;
    },
  };
}
