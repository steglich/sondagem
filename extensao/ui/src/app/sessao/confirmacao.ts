import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { type Cenario, descreverThrottling, resolverIteracoes, temPassoDe } from '../../../../shared/cenario';
import type { IdVerificacao, Selecao, Verificacao } from '../../../../shared/types';

export type ModoAnalise = 'cenario' | 'manual';

/** O que o usuário confirmou. `iteracoes` e `versaoBuild` só existem no modo cenário. */
export interface AnaliseConfirmada {
  modo: ModoAnalise;
  selecao: Selecao;
  iteracoes?: number;
  versaoBuild?: string;
}

/** Resumo do que será feito, com a escolha do modo e das verificações, antes de iniciar a análise. */
@Component({
  selector: 'sd-confirmacao',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="titulo-confirmacao">
      <h2 id="titulo-confirmacao">Confirmar análise</h2>

      @if (cenario()) {
        <fieldset>
          <legend>Modo</legend>
          <label>
            <input type="radio" name="modo" data-testid="modo-cenario" [checked]="modo() === 'cenario'" (change)="modo.set('cenario')" />
            <span>
              <strong>Cenário</strong>
              <small>A extensão executa os passos, sempre iguais. Use para comparar execuções.</small>
            </span>
          </label>
          <label>
            <input type="radio" name="modo" data-testid="modo-manual" [checked]="modo() === 'manual'" (change)="modo.set('manual')" />
            <span>
              <strong>Sessão manual</strong>
              <small>Você usa a página e a extensão só observa. Não é repetível.</small>
            </span>
          </label>
        </fieldset>
      }

      <dl>
        <dt>Aba</dt>
        <dd data-testid="confirmacao-url">{{ url() ?? 'Aba não identificada' }}</dd>
        <dt>Modo</dt>
        <dd data-testid="confirmacao-modo">{{ modo() === 'cenario' ? 'Cenário' : 'Sessão manual' }}</dd>
        @if (cenarioAtivo(); as c) {
          <dt>Cenário</dt>
          <dd data-testid="confirmacao-cenario">{{ c.nome }}</dd>
          <dt>URL inicial</dt>
          <dd data-testid="confirmacao-url-inicial">{{ c.url_inicial }}</dd>
          <dt>Throttling</dt>
          <dd data-testid="confirmacao-throttling">{{ throttling() }}</dd>
        }
      </dl>

      @if (cenarioAtivo()) {
        <div class="campos">
          <label>
            Iterações
            <input
              type="number"
              min="1"
              step="1"
              data-testid="confirmacao-iteracoes"
              [value]="iteracoes()"
              (input)="iteracoes.set($any($event.target).value)"
            />
          </label>
          <label>
            Versão do build (opcional)
            <input
              type="text"
              data-testid="confirmacao-versao-build"
              [value]="versaoBuild()"
              (input)="versaoBuild.set($any($event.target).value)"
            />
          </label>
        </div>
        <p class="nota" data-testid="confirmacao-aviso-cenario">
          A aba vai abrir a URL inicial, e o Chrome mostrará a barra de depuração até o fim da execução.
        </p>
      }

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

      @if (semMemoria()) {
        <p class="aviso" data-testid="confirmacao-aviso-memoria">
          Este cenário tem passos de memória (medir, snapshot ou forcar_gc). Sem a verificação “Memória” eles serão
          ignorados, e um vazamento não será confirmado nem descartado. Os outros passos rodam normalmente.
        </p>
      }

      @if (!cenarioAtivo() && exigeDebugger()) {
        <p class="nota" data-testid="confirmacao-aviso-debugger">
          Esta seleção usa o debugger: o Chrome mostrará a barra de depuração até você parar a sessão.
        </p>
      }

      @if (impedimento(); as motivo) {
        <p class="aviso" role="alert" data-testid="confirmacao-impedimento">{{ motivo }}</p>
      }

      <div class="acoes">
        <button type="button" data-testid="confirmar" [disabled]="impedimento() !== null" (click)="emitir()">
          {{ cenarioAtivo() ? 'Executar cenário' : 'Iniciar análise' }}
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
    .campos {
      display: grid;
      gap: 8px;
      margin: 0 0 12px;
    }
    .campos label {
      flex-direction: column;
      gap: 4px;
    }
    .campos input {
      box-sizing: border-box;
      width: 100%;
      font: inherit;
    }
    .nota {
      opacity: 0.75;
    }
  `,
})
export class Confirmacao {
  readonly url = input.required<string | undefined>();
  readonly verificacoes = input.required<readonly Verificacao[]>();
  /** Seleção com que a tela abre na sessão manual (a última usada nesse contexto). */
  readonly selecaoInicial = input.required<Selecao>();
  /** Cenário escolhido na lista; com ele, a tela oferece os dois modos. */
  readonly cenario = input<Cenario | null>(null);
  /** Última seleção usada com esse cenário. */
  readonly selecaoCenario = input<Selecao | null>(null);
  /** Motivo pelo qual a aba não pode ser analisada, ou `null`. */
  readonly bloqueio = input<string | null>(null);

  readonly confirmar = output<AnaliseConfirmada>();
  readonly desistir = output<void>();

  /** Com um cenário escolhido, o modo principal é o cenário. */
  protected readonly modo = linkedSignal<ModoAnalise>(() => (this.cenario() ? 'cenario' : 'manual'));
  protected readonly cenarioAtivo = computed(() => (this.modo() === 'cenario' ? this.cenario() : null));

  /** Cada modo tem a sua seleção salva: trocar de modo troca as marcações. */
  protected readonly marcadas = linkedSignal(
    () => new Set<IdVerificacao>(this.cenarioAtivo() ? (this.selecaoCenario() ?? this.selecaoInicial()) : this.selecaoInicial()),
  );

  /** Texto do campo; abre com o valor do cenário ou o padrão. */
  protected readonly iteracoes = linkedSignal(() => String(this.cenario() ? resolverIteracoes(this.cenario()!) : ''));
  protected readonly versaoBuild = linkedSignal(() => (this.cenario(), ''));
  protected readonly throttling = computed(() => descreverThrottling(this.cenario()?.execucao?.throttling));

  protected readonly selecao = computed<Selecao>(() =>
    this.verificacoes()
      .filter((verificacao) => this.marcadas().has(verificacao.id))
      .map((verificacao) => verificacao.id),
  );

  protected readonly exigeDebugger = computed(() =>
    this.verificacoes().some((v) => v.exige === 'debugger' && this.marcadas().has(v.id)),
  );

  /** Cenário com passos de memória e a verificação "Memória" desmarcada: avisa, sem impedir. */
  protected readonly semMemoria = computed(() => {
    const cenario = this.cenarioAtivo();
    return cenario !== null && temPassoDe(cenario.passos, 'memoria') && !this.marcadas().has('memoria');
  });

  private readonly iteracoesValidas = computed(() => {
    const valor = Number(this.iteracoes());
    return this.iteracoes().trim() !== '' && Number.isInteger(valor) && valor > 0 ? valor : null;
  });

  /** Por que a análise não pode começar, ou `null` se pode. */
  protected readonly impedimento = computed<string | null>(() => {
    if (this.bloqueio()) return this.bloqueio();
    if (this.selecao().length === 0) return 'Marque ao menos uma verificação para iniciar.';
    if (this.cenarioAtivo() && this.iteracoesValidas() === null) return 'Informe um número inteiro de iterações, maior que zero.';
    return null;
  });

  protected alternar(id: IdVerificacao): void {
    const marcadas = new Set(this.marcadas());
    if (!marcadas.delete(id)) marcadas.add(id);
    this.marcadas.set(marcadas);
  }

  protected emitir(): void {
    if (this.impedimento() !== null) return;
    if (!this.cenarioAtivo()) {
      this.confirmar.emit({ modo: 'manual', selecao: this.selecao() });
      return;
    }
    const versaoBuild = this.versaoBuild().trim();
    this.confirmar.emit({
      modo: 'cenario',
      selecao: this.selecao(),
      iteracoes: this.iteracoesValidas()!,
      ...(versaoBuild ? { versaoBuild } : {}),
    });
  }
}
