import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import type { IdVerificacao, Selecao, Verificacao } from '../../../../shared/types';

/** Resumo do que será feito, com a escolha das verificações, antes de iniciar a análise. */
@Component({
  selector: 'sd-confirmacao',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="titulo-confirmacao">
      <h2 id="titulo-confirmacao">Confirmar análise</h2>
      <dl>
        <dt>Aba</dt>
        <dd data-testid="confirmacao-url">{{ url() ?? 'Aba não identificada' }}</dd>
        <dt>Modo</dt>
        <dd data-testid="confirmacao-modo">{{ modo() }}</dd>
      </dl>

      <fieldset>
        <legend>Verificações</legend>
        @for (verificacao of verificacoes(); track verificacao.id) {
          <label>
            <input
              type="checkbox"
              [attr.data-testid]="'verificacao-' + verificacao.id"
              [checked]="marcadas().has(verificacao.id)"
              (change)="alternar(verificacao.id)"
            />
            <span>
              <strong>{{ verificacao.nome }}</strong>
              <small>{{ verificacao.descricao }}</small>
            </span>
          </label>
        }
      </fieldset>

      @if (impedimento(); as motivo) {
        <p class="aviso" role="alert" data-testid="confirmacao-impedimento">{{ motivo }}</p>
      }

      <div class="acoes">
        <button type="button" data-testid="confirmar" [disabled]="impedimento() !== null" (click)="confirmar.emit(selecao())">
          Iniciar análise
        </button>
        <button type="button" class="secundario" data-testid="desistir" (click)="desistir.emit()">Cancelar</button>
      </div>
    </section>
  `,
  styles: `
    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 12px;
      margin: 0 0 12px;
    }
    dt {
      opacity: 0.7;
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    fieldset {
      display: grid;
      gap: 8px;
      margin: 0 0 12px;
      padding: 8px 12px;
    }
    label {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    small {
      display: block;
      opacity: 0.7;
    }
  `,
})
export class Confirmacao {
  readonly url = input.required<string | undefined>();
  readonly modo = input.required<string>();
  readonly verificacoes = input.required<readonly Verificacao[]>();
  /** Seleção com que a tela abre (a última usada no contexto). */
  readonly selecaoInicial = input.required<Selecao>();
  /** Motivo pelo qual a aba não pode ser analisada, ou `null`. */
  readonly bloqueio = input<string | null>(null);

  readonly confirmar = output<Selecao>();
  readonly desistir = output<void>();

  protected readonly marcadas = linkedSignal(() => new Set<IdVerificacao>(this.selecaoInicial()));

  protected readonly selecao = computed<Selecao>(() =>
    this.verificacoes()
      .filter((verificacao) => this.marcadas().has(verificacao.id))
      .map((verificacao) => verificacao.id),
  );

  /** Por que a análise não pode começar, ou `null` se pode. */
  protected readonly impedimento = computed<string | null>(() => {
    if (this.bloqueio()) return this.bloqueio();
    if (this.selecao().length === 0) return 'Marque ao menos uma verificação para iniciar.';
    return null;
  });

  protected alternar(id: IdVerificacao): void {
    const marcadas = new Set(this.marcadas());
    if (!marcadas.delete(id)) marcadas.add(id);
    this.marcadas.set(marcadas);
  }
}
