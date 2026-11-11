import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { formatarMs } from '../../../../shared/texto';
import type { StatusResumido } from '../../../../shared/types';

/** Sessão em andamento: só o status resumido. Os registros detalhados aparecem depois de parar. */
@Component({
  selector: 'sd-sessao-ativa',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="titulo-sessao">
      <h2 id="titulo-sessao">{{ parando() ? 'Encerrando…' : 'Análise em andamento' }}</h2>
      <p class="url" data-testid="sessao-url">{{ url() }}</p>
      <p>Sessão manual: a Sondagem só observa. Use a página normalmente e clique em “Parar” ao terminar.</p>

      @if (status(); as s) {
        <dl aria-live="polite">
          <dt>Long tasks</dt>
          <dd data-testid="status-long-tasks">{{ s.longTasks }}</dd>
          <dt>Pior long task</dt>
          <dd data-testid="status-pior-long-task">{{ s.piorLongTask === null ? '—' : ms(s.piorLongTask) }}</dd>
          <dt>Interações</dt>
          <dd data-testid="status-interacoes">{{ s.interacoes }}</dd>
          <dt>Carregamentos</dt>
          <dd data-testid="status-carregamentos">{{ s.carregamentos }}</dd>
        </dl>
      }

      <div class="acoes">
        <button type="button" data-testid="parar" [disabled]="parando()" (click)="parar.emit()">Parar</button>
        <button type="button" class="secundario" data-testid="cancelar" [disabled]="parando()" (click)="cancelar.emit()">
          Cancelar
        </button>
      </div>
    </section>
  `,
  styles: `
    .url {
      overflow-wrap: anywhere;
      opacity: 0.7;
    }
    dl {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 12px;
    }
    dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
  `,
})
export class SessaoAtiva {
  readonly url = input.required<string>();
  readonly status = input.required<StatusResumido | null>();
  readonly parando = input(false);

  readonly parar = output<void>();
  readonly cancelar = output<void>();

  protected readonly ms = formatarMs;
}
