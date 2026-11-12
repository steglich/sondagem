import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { type Cenario, type TipoStorage, resolverIteracoes, storageAConfirmar, temPassoDe } from '../../../../shared/cenario';
import {
  PERFIL_NENHUM,
  type PerfilThrottling,
  descreverCondicoes,
  perfisDisponiveis,
  resolverThrottling,
  semLimitacao,
} from '../../../../shared/condicoes';
import { descreverStorage } from '../../../../shared/limpeza-storage';
import type { ExtensaoAtiva, IdVerificacao, Selecao, Verificacao } from '../../../../shared/types';

export type ModoAnalise = 'cenario' | 'manual';

/**
 * O que o usuário confirmou. `iteracoes`, `versaoBuild` e `storageConfirmado` só
 * existem no modo cenário; `throttling`, só na sessão manual com um perfil escolhido.
 */
export interface AnaliseConfirmada {
  modo: ModoAnalise;
  selecao: Selecao;
  iteracoes?: number;
  versaoBuild?: string;
  /** Tipos de `limpar_storage` que o usuário confirmou. É a única origem dessa lista. */
  storageConfirmado?: TipoStorage[];
  throttling?: string;
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
          <dt>Cache</dt>
          <dd data-testid="confirmacao-cache">
            {{ c.execucao?.manter_cache ? 'limpo antes da execução; ligado durante' : 'limpo antes da execução; desligado durante' }}
          </dd>
        }
      </dl>

      @if (!cenarioAtivo()) {
        <div class="campos">
          <label>
            Throttling
            <select data-testid="throttling-manual" [value]="throttlingManual()" (change)="throttlingManual.set($any($event.target).value)">
              @for (perfil of perfisOferecidos(); track perfil.nome) {
                <option [value]="perfil.nome" [selected]="perfil.nome === throttlingManual()">{{ perfil.nome }} ({{ descrever(perfil) }})</option>
              }
            </select>
          </label>
        </div>
        @if (throttlingManualAtivo()) {
          <p class="nota" data-testid="confirmacao-aviso-throttling">
            A página vai rodar com {{ throttlingManualDescricao() }} até você parar a sessão. O throttling usa o debugger: o Chrome
            mostrará a barra de depuração.
          </p>
        }
      }

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
          A aba vai abrir a URL inicial, e o Chrome mostrará a barra de depuração até o fim da execução. O cache HTTP e o Cache
          Storage da origem são limpos antes; cookies e os outros dados da aplicação não são tocados.
        </p>
        @if (semUrlLogin()) {
          <p class="nota" data-testid="confirmacao-aviso-sessao">
            Este cenário não declara <code>sessao.url_login</code>: se a sessão da aplicação expirar no meio da execução, a
            extensão não tem como perceber, e as medições podem ser da tela de login.
          </p>
        }
        @if (storage().length > 0) {
          <div class="aviso" role="alert" data-testid="confirmacao-aviso-storage">
            <p>
              Este cenário pede para apagar dados da aplicação em <strong>{{ origem() }}</strong
              >: <strong data-testid="confirmacao-tipos-storage">{{ storageDescricao() }}</strong
              >. Se a sua sessão depender deles, você será deslogado.
            </p>
            <label>
              <input
                type="checkbox"
                data-testid="confirmar-limpeza-storage"
                [checked]="limpezaConfirmada()"
                (change)="limpezaConfirmada.set($any($event.target).checked)"
              />
              <span>Confirmo que quero apagar {{ storageDescricao() }} desta origem.</span>
            </label>
          </div>
        }
      }

      @if (extensoes().length > 0) {
        <div class="aviso" data-testid="confirmacao-aviso-extensoes">
          <p>
            Há {{ extensoes().length }} {{ extensoes().length === 1 ? 'outra extensão ativa' : 'outras extensões ativas' }} neste
            perfil do navegador. Elas podem rodar código na página e distorcer a medição:
          </p>
          <ul>
            @for (extensao of extensoes(); track extensao.id) {
              <li data-testid="confirmacao-extensao">{{ extensao.nome }}</li>
            }
          </ul>
          <p>Para um resultado confiável, use um perfil limpo do Chrome, só com a Sondagem. Você pode prosseguir assim mesmo.</p>
        </div>
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
    .campos select {
      box-sizing: border-box;
      width: 100%;
      font: inherit;
    }
    .aviso p {
      margin: 0 0 6px;
    }
    .aviso ul {
      margin: 0 0 6px;
      padding-left: 18px;
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
  /** Perfis de throttling salvos pelo usuário. */
  readonly perfis = input<readonly PerfilThrottling[]>([]);
  /** Outras extensões ativas no perfil do navegador. Com alguma, a tela alerta sem impedir. */
  readonly extensoes = input<readonly ExtensaoAtiva[]>([]);

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

  /** Throttling do cenário, já resolvido em números. Perfil que não existe impede a execução. */
  private readonly resolucao = computed(() => resolverThrottling(this.cenario()?.execucao?.throttling, this.perfis()));
  protected readonly throttling = computed(() => {
    const resolucao = this.resolucao();
    return resolucao.ok ? `${resolucao.perfil.nome} (${descreverCondicoes(resolucao.perfil)})` : 'perfil inexistente';
  });

  /** Sessão manual: nada muda na página, a não ser que o usuário escolha um perfil aqui. */
  protected readonly perfisOferecidos = computed(() => perfisDisponiveis(this.perfis()));
  protected readonly throttlingManual = linkedSignal(() => (this.perfis(), PERFIL_NENHUM.nome));
  private readonly perfilManual = computed(
    () => this.perfisOferecidos().find((perfil) => perfil.nome === this.throttlingManual()) ?? PERFIL_NENHUM,
  );
  protected readonly throttlingManualAtivo = computed(() => !this.cenarioAtivo() && !semLimitacao(this.perfilManual()));
  protected readonly throttlingManualDescricao = computed(() => descreverCondicoes(this.perfilManual()));
  protected readonly descrever = descreverCondicoes;

  /** Tipos de storage que o cenário manda apagar e que exigem a confirmação específica. */
  protected readonly storage = computed(() => {
    const cenario = this.cenarioAtivo();
    return cenario ? storageAConfirmar(cenario) : [];
  });
  protected readonly storageDescricao = computed(() => descreverStorage(this.storage()));
  protected readonly limpezaConfirmada = linkedSignal(() => (this.cenarioAtivo(), false));
  protected readonly origem = computed(() => {
    try {
      return new URL(this.cenarioAtivo()?.url_inicial ?? '').origin;
    } catch {
      return '';
    }
  });
  protected readonly semUrlLogin = computed(() => {
    const cenario = this.cenarioAtivo();
    return cenario !== null && !cenario.sessao?.url_login;
  });

  protected readonly selecao = computed<Selecao>(() =>
    this.verificacoes()
      .filter((verificacao) => this.marcadas().has(verificacao.id))
      .map((verificacao) => verificacao.id),
  );

  protected readonly exigeDebugger = computed(
    // O aviso do throttling já fala da barra de depuração.
    () => !this.throttlingManualAtivo() && this.verificacoes().some((v) => v.exige === 'debugger' && this.marcadas().has(v.id)),
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
    const resolucao = this.resolucao();
    if (this.cenarioAtivo() && !resolucao.ok) return resolucao.mensagem;
    if (this.storage().length > 0 && !this.limpezaConfirmada()) {
      return `Confirme a limpeza de ${this.storageDescricao()} para executar, ou cancele. Sem a confirmação nada é apagado e a execução não começa.`;
    }
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
      this.confirmar.emit({
        modo: 'manual',
        selecao: this.selecao(),
        ...(this.throttlingManualAtivo() ? { throttling: this.throttlingManual() } : {}),
      });
      return;
    }
    const versaoBuild = this.versaoBuild().trim();
    this.confirmar.emit({
      modo: 'cenario',
      selecao: this.selecao(),
      iteracoes: this.iteracoesValidas()!,
      ...(versaoBuild ? { versaoBuild } : {}),
      // Só chega aqui com a caixa marcada: sem ela, `impedimento` barra o botão.
      ...(this.storage().length > 0 && this.limpezaConfirmada() ? { storageConfirmado: this.storage() } : {}),
    });
  }
}
