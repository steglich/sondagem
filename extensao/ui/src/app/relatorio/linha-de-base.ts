import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { LIMITE_REGRESSAO_PADRAO, type LinhaDeBase as Linha } from '../../../../shared/comparacao';
import { type RegistroExecucao, podeSerReferencia } from '../../../../shared/historico';
import { METRICAS_DE_ITERACAO } from '../../../../shared/relatorio';
import type { IdMetricaIteracao } from '../../../../shared/types';
import { PonteExtensao } from '../sessao/ponte';

const IDS = Object.keys(METRICAS_DE_ITERACAO) as IdMetricaIteracao[];

/**
 * Marca ou desmarca a execução como linha de base do cenário e edita o limite de
 * regressão de cada métrica. Só existe para execução de cenário completa.
 */
@Component({
  selector: 'sd-linha-de-base',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (elegivel()) {
      <section aria-labelledby="titulo-linha-de-base">
        <h3 id="titulo-linha-de-base">Linha de base</h3>
        @if (ehAtual()) {
          <p data-testid="linha-de-base-atual">
            Esta execução é a linha de base de “{{ registro().nomeCenario }}”. As próximas execuções do cenário são comparadas com ela, e a
            retenção do histórico não a remove.
          </p>
          <div class="campos">
            @for (metrica of metricas; track metrica.id) {
              <label>
                Limite de regressão de “{{ metrica.nome }}”, em %
                <input
                  type="number"
                  min="0"
                  [attr.data-testid]="'limite-' + metrica.id"
                  [placeholder]="padrao"
                  [value]="limites()[metrica.id] ?? ''"
                  (input)="editar(metrica.id, $any($event.target).value)"
                />
              </label>
            }
          </div>
          @if (erro(); as mensagem) {
            <p class="aviso" role="alert" data-testid="limites-erro">{{ mensagem }}</p>
          }
          @if (salvo()) {
            <p class="nota" role="status" data-testid="limites-salvos">Limites salvos.</p>
          }
          <div class="acoes">
            <button type="button" data-testid="salvar-limites" (click)="salvarLimites()">Salvar limites</button>
            <button type="button" class="secundario" data-testid="desmarcar-linha-de-base" (click)="desmarcar()">Desmarcar linha de base</button>
          </div>
        } @else {
          @if (linha()) {
            <p class="nota" data-testid="linha-de-base-outra">O cenário já tem outra execução como linha de base; marcar esta a substitui e mantém os limites.</p>
          }
          <button type="button" class="secundario" data-testid="marcar-linha-de-base" (click)="marcar()">Marcar como linha de base</button>
        }
      </section>
    }
  `,
  styles: `
    section {
      margin: 12px 0;
    }
    .campos {
      display: grid;
      gap: 8px;
      max-width: 28rem;
      margin-bottom: 12px;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    input {
      box-sizing: border-box;
      width: 100%;
      font: inherit;
    }
    .nota {
      opacity: 0.7;
    }
  `,
})
export class LinhaDeBase {
  private readonly ponte = inject(PonteExtensao);

  readonly registro = input.required<RegistroExecucao>();
  /** A linha de base do cenário mudou (marcada, desmarcada ou com outros limites). */
  readonly mudou = output<void>();

  protected readonly metricas = IDS.map((id) => ({ id, nome: METRICAS_DE_ITERACAO[id].nome }));
  protected readonly padrao = String(LIMITE_REGRESSAO_PADRAO);
  protected readonly elegivel = computed(() => podeSerReferencia(this.registro()) && this.registro().nomeCenario !== null);
  protected readonly linha = signal<Linha | null>(null);
  protected readonly ehAtual = computed(() => this.linha()?.id === this.registro().id);
  /** Texto de cada campo de limite; vazio vale o padrão. */
  protected readonly limites = signal<Partial<Record<IdMetricaIteracao, string>>>({});
  protected readonly erro = signal<string | null>(null);
  protected readonly salvo = signal(false);

  constructor() {
    effect(() => {
      const registro = this.registro();
      untracked(() => void this.carregar(registro));
    });
  }

  protected editar(id: IdMetricaIteracao, texto: string): void {
    this.salvo.set(false);
    this.limites.update((limites) => ({ ...limites, [id]: texto }));
  }

  protected async marcar(): Promise<void> {
    const registro = this.registro();
    if (registro.nomeCenario === null) return;
    await this.gravar({ id: registro.id, limites: this.linha()?.limites ?? {} });
  }

  protected async desmarcar(): Promise<void> {
    const nome = this.registro().nomeCenario;
    if (nome === null) return;
    await this.ponte.removerLinhaDeBase(nome);
    this.aplicar(null);
    this.mudou.emit();
  }

  /** Confere e salva os limites. Com erro, nada é gravado. */
  protected async salvarLimites(): Promise<void> {
    this.salvo.set(false);
    const limites: Linha['limites'] = {};
    for (const { id, nome } of this.metricas) {
      const texto = (this.limites()[id] ?? '').trim().replace(',', '.');
      if (texto === '') continue;
      const valor = Number(texto);
      if (!Number.isFinite(valor) || valor < 0) {
        this.erro.set(`O limite de “${nome}” deve ser um número maior ou igual a zero, ou vazio para usar o padrão de ${this.padrao}%.`);
        return;
      }
      limites[id] = valor;
    }
    this.erro.set(null);
    await this.gravar({ id: this.registro().id, limites });
    this.salvo.set(true);
  }

  private async gravar(linha: Linha): Promise<void> {
    const nome = this.registro().nomeCenario;
    if (nome === null) return;
    await this.ponte.definirLinhaDeBase(nome, linha);
    this.aplicar(linha);
    this.mudou.emit();
  }

  private async carregar(registro: RegistroExecucao): Promise<void> {
    this.erro.set(null);
    this.salvo.set(false);
    if (registro.nomeCenario === null || !podeSerReferencia(registro)) {
      this.aplicar(null);
      return;
    }
    this.aplicar(await this.ponte.lerLinhaDeBase(registro.nomeCenario).catch(() => null));
  }

  private aplicar(linha: Linha | null): void {
    this.linha.set(linha);
    const textos: Partial<Record<IdMetricaIteracao, string>> = {};
    for (const id of IDS) if (linha?.limites[id] !== undefined) textos[id] = String(linha.limites[id]);
    this.limites.set(textos);
  }
}
