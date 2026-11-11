/** Textos das falhas do debugger, usados pelo service worker e pela interface. */
import type { CategoriaFalhaAnexacao, MotivoDesconexao } from './types.ts';

export interface MensagemFalha {
  titulo: string;
  orientacao: string;
}

export const FALHAS_DE_ANEXACAO: Readonly<Record<CategoriaFalhaAnexacao, MensagemFalha>> = {
  'outro-depurador': {
    titulo: 'Há um depurador aberto nesta aba.',
    orientacao:
      'O DevTools (ou outra ferramenta de depuração) está anexado à aba. Feche-o ou use uma janela de teste dedicada e tente de novo.',
  },
  'alvo-nao-depuravel': {
    titulo: 'Esta página não pode ser analisada.',
    orientacao:
      'O Chrome não permite depurar páginas internas, páginas de outras extensões nem a loja de extensões. Abra uma página http ou https.',
  },
  desconhecido: {
    titulo: 'Não foi possível anexar o debugger à aba.',
    orientacao: 'O Chrome recusou a conexão. A análise não foi iniciada.',
  },
};

/** Explicação de por que a conexão com o debugger caiu durante a análise. */
export function explicarDesconexao(motivo: MotivoDesconexao): string {
  switch (motivo) {
    case 'canceled_by_user':
      return 'A depuração foi cancelada na barra de aviso do Chrome.';
    case 'target_closed':
      return 'A aba analisada foi fechada.';
    case 'replaced_with_devtools':
      return 'O DevTools assumiu a depuração da aba.';
    default:
      return `O Chrome encerrou a depuração da aba (${motivo}).`;
  }
}
