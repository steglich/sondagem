import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RegistroExecucao } from '../../../../shared/historico';
import type { DadosColetados, ErroPagina } from '../../../../shared/types';
import { iteracaoExibida, segundosDesde } from './formato';
import { type ColunaDaLista, ListaVirtual } from './lista-virtual';

const TIPOS: Record<ErroPagina['tipo'], string> = { excecao: 'Exceção', rejeicao: 'Promise rejeitada' };

/** Erros da página, agrupados por iteração: as iterações em ordem, e por último o que ocorreu fora delas. */
@Component({
  selector: 'sd-secao-erros',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ListaVirtual],
  template: `
    @if (truncada()) {
      <p class="nota" data-testid="erros-truncados">A lista de erros foi removida para caber no limite de armazenamento.</p>
    } @else if (erros().length === 0) {
      <p class="nota" data-testid="sem-erros">Nenhum erro da página.</p>
    } @else {
      <p data-testid="erros-resumo">{{ resumo() }}</p>
      <sd-lista-virtual data-testid="lista-erros" rotulo="Erros da página por iteração" [itens]="erros()" [colunas]="colunas" />
    }
  `,
  styles: `
    .nota {
      opacity: 0.7;
    }
  `,
})
export class SecaoErros {
  readonly registro = input.required<RegistroExecucao>();
  readonly dados = input.required<DadosColetados>();

  protected readonly truncada = computed(() => this.registro().truncado.includes('errosPagina'));

  protected readonly erros = computed(() => {
    const ordem = (erro: ErroPagina): number => (typeof erro.iteracao === 'number' ? erro.iteracao : Number.POSITIVE_INFINITY);
    return [...this.dados().errosPagina].sort((a, b) => ordem(a) - ordem(b) || a.instante - b.instante);
  });

  protected readonly resumo = computed(() => {
    const erros = this.erros();
    const iteracoes = new Set(erros.filter((e) => typeof e.iteracao === 'number').map((e) => e.iteracao));
    const fora = erros.filter((e) => typeof e.iteracao !== 'number').length;
    const partes = [`${erros.length} ${erros.length === 1 ? 'erro' : 'erros'}`];
    if (this.registro().tipo === 'cenario') {
      partes.push(`em ${iteracoes.size} ${iteracoes.size === 1 ? 'iteração' : 'iterações'}`);
      if (fora > 0) partes.push(`(${fora} fora das iterações)`);
    }
    return `${partes.join(' ')}.`;
  });

  protected readonly colunas: ColunaDaLista<ErroPagina>[] = [
    { titulo: 'Iteração', largura: '5rem', numerica: true, texto: (e) => iteracaoExibida(e.iteracao) },
    { titulo: 'Instante', largura: '6rem', numerica: true, texto: (e) => segundosDesde(this.registro().inicio, e.instante) },
    { titulo: 'Tipo', largura: '9rem', texto: (e) => TIPOS[e.tipo] },
    { titulo: 'Mensagem', largura: 'minmax(0, 2fr)', texto: (e) => e.mensagem },
    { titulo: 'Origem', largura: 'minmax(0, 1fr)', texto: (e) => (e.arquivo === null ? '—' : `${e.arquivo}${e.linha === null ? '' : `:${e.linha}`}`) },
  ];
}
