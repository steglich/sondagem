import { ScrollingModule } from '@angular/cdk/scrolling';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface ColunaDaLista<T> {
  titulo: string;
  /** Largura da coluna, como uma faixa de `grid-template-columns` (ex.: `6rem`, `minmax(0, 1fr)`). */
  largura: string;
  texto: (item: T) => string;
  numerica?: boolean;
}

/** Altura de cada linha, em px. A rolagem virtual depende de ela ser fixa. */
export const ALTURA_DA_LINHA = 28;
const LINHAS_VISIVEIS = 12;

/**
 * Lista em colunas com rolagem virtual: só as linhas visíveis (e uma margem) existem
 * no DOM, então uma lista de milhares de itens custa o mesmo que uma de dezenas.
 */
@Component({
  selector: 'sd-lista-virtual',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScrollingModule],
  template: `
    <div class="lista" role="table" [attr.aria-label]="rotulo()" [attr.aria-rowcount]="itens().length + 1">
      <div class="linha cabecalho" role="row" [style.grid-template-columns]="grade()">
        @for (coluna of colunas(); track coluna.titulo) {
          <span role="columnheader" [class.numerica]="coluna.numerica">{{ coluna.titulo }}</span>
        }
      </div>
      <cdk-virtual-scroll-viewport [itemSize]="alturaDaLinha" [minBufferPx]="280" [maxBufferPx]="560" [style.height.px]="altura()" tabindex="0">
        <div
          *cdkVirtualFor="let item of itens()"
          class="linha"
          role="row"
          data-testid="linha"
          [style.grid-template-columns]="grade()"
          [style.height.px]="alturaDaLinha"
        >
          @for (coluna of colunas(); track coluna.titulo) {
            <span role="cell" [class.numerica]="coluna.numerica" [title]="coluna.texto(item)">{{ coluna.texto(item) }}</span>
          }
        </div>
      </cdk-virtual-scroll-viewport>
    </div>
    <p class="total" data-testid="lista-total">{{ itens().length }} {{ itens().length === 1 ? 'item' : 'itens' }}</p>
  `,
  styles: `
    .lista {
      border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
      border-radius: 6px;
      overflow: hidden;
    }
    .linha {
      display: grid;
      gap: 12px;
      align-items: center;
      box-sizing: border-box;
      padding: 0 10px;
      border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
    }
    .cabecalho {
      height: 30px;
      font-weight: 600;
      background: color-mix(in srgb, currentColor 6%, transparent);
    }
    span {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .numerica {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .total {
      margin: 4px 0 0;
      font-size: 0.85rem;
      opacity: 0.7;
    }
  `,
})
export class ListaVirtual<T> {
  readonly itens = input.required<readonly T[]>();
  readonly colunas = input.required<readonly ColunaDaLista<T>[]>();
  /** Nome da lista para leitores de tela. */
  readonly rotulo = input.required<string>();

  protected readonly alturaDaLinha = ALTURA_DA_LINHA;
  protected readonly grade = computed(() =>
    this.colunas()
      .map((coluna) => coluna.largura)
      .join(' '),
  );
  /** A lista curta ocupa só o que precisa; a longa rola dentro de uma área fixa. */
  protected readonly altura = computed(() => Math.min(Math.max(this.itens().length, 1), LINHAS_VISIVEIS) * ALTURA_DA_LINHA);
}
