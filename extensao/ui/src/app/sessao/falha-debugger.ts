import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FALHAS_DE_ANEXACAO } from '../../../../shared/mensagens-debugger';
import type { FalhaDebugger as Falha } from '../../../../shared/types';

/** Por que o debugger não pôde ser anexado, o que fazer e o que da análise dependia dele. */
@Component({
  selector: 'sd-falha-debugger',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="aviso" role="alert" data-testid="falha-debugger" [attr.data-categoria]="falha().categoria">
      <p>
        <strong data-testid="falha-debugger-titulo">{{ mensagem().titulo }}</strong>
        A análise não foi iniciada.
      </p>
      <p data-testid="falha-debugger-orientacao">{{ mensagem().orientacao }}</p>
      @if (falha().dependentes.length > 0) {
        <p>Dependem do debugger nesta análise:</p>
        <ul>
          @for (dependente of falha().dependentes; track dependente) {
            <li data-testid="falha-debugger-dependente">{{ dependente }}</li>
          }
        </ul>
      }
      @if (falha().categoria === 'desconhecido') {
        <p class="original">
          Mensagem do Chrome: <code data-testid="falha-debugger-original">{{ falha().original }}</code>
        </p>
      }
    </div>
  `,
  styles: `
    p {
      margin: 0 0 6px;
    }
    ul {
      margin: 0 0 6px;
      padding-left: 20px;
    }
    .original {
      opacity: 0.8;
      overflow-wrap: anywhere;
    }
  `,
})
export class FalhaDebugger {
  readonly falha = input.required<Falha>();
  protected readonly mensagem = computed(() => FALHAS_DE_ANEXACAO[this.falha().categoria]);
}
