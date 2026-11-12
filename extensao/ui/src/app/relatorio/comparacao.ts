import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { type Comparacao as Resultado, compararExecucoes } from '../../../../shared/comparacao';
import { type SeparadorCsv, csvDaComparacao, nomeDoArquivoDaComparacao } from '../../../../shared/exportacao';
import { type RegistroExecucao, podeSerReferencia } from '../../../../shared/historico';
import { PonteExtensao } from '../sessao/ponte';
import { TIPO_CSV } from './exportar';
import { comSinal, dataHora, percentual, rotuloDaExecucao, valorComUnidade } from './formato';

type Carga = { fase: 'carregando' } | { fase: 'ausente'; faltam: string[] } | { fase: 'pronto'; a: RegistroExecucao; b: RegistroExecucao };

const SITUACOES = { melhor: 'melhorou', pior: 'piorou', igual: 'igual', 'sem-dado': 'sem dado' } as const;

/**
 * Comparação entre duas execuções do mesmo cenário (`#/relatorio/comparar/:idA/:idB`).
 * A é a referência; a diferença é de B em relação a A. Lê só os registros leves:
 * as estatísticas estão neles.
 */
@Component({
  selector: 'sd-comparacao',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <main>
      <h1>Comparação entre execuções</h1>

      @let atual = carga();
      @if (atual.fase === 'carregando') {
        <p data-testid="comparacao-carregando">Carregando…</p>
      } @else if (atual.fase === 'ausente') {
        <p class="aviso" role="alert" data-testid="comparacao-ausente">
          {{ atual.faltam.length === 1 ? 'Uma das execuções não está' : 'As execuções não estão' }} no histórico. Elas podem ter sido removidas.
        </p>
        <a routerLink="/relatorio">Ver as execuções guardadas</a>
      } @else {
        <div class="escolha">
          <label>
            A (referência)
            <select data-testid="execucao-a" (change)="trocar($any($event.target).value, atual.b.id)">
              @for (execucao of elegiveis(); track execucao.id) {
                <option [value]="execucao.id" [selected]="execucao.id === atual.a.id">{{ rotulo(execucao) }}</option>
              }
            </select>
          </label>
          <label>
            B
            <select data-testid="execucao-b" (change)="trocar(atual.a.id, $any($event.target).value)">
              @for (execucao of elegiveis(); track execucao.id) {
                <option [value]="execucao.id" [selected]="execucao.id === atual.b.id">{{ rotulo(execucao) }}</option>
              }
            </select>
          </label>
        </div>

        @let resultado = comparacao();
        @if (resultado && !resultado.ok) {
          <p class="aviso" role="alert" data-testid="comparacao-recusada">{{ resultado.mensagem }}</p>
        } @else if (resultado && resultado.ok) {
          <h2 data-testid="comparacao-cenario">{{ resultado.nomeCenario }}</h2>
          <dl>
            <dt>A</dt>
            <dd data-testid="comparacao-a">
              build <strong data-testid="build-a">{{ resultado.a.versaoBuild ?? 'não informado' }}</strong>, {{ data(resultado.a.inicio) }} —
              <a [routerLink]="['/relatorio', resultado.a.id]">abrir relatório</a>
            </dd>
            <dt>B</dt>
            <dd data-testid="comparacao-b">
              build <strong data-testid="build-b">{{ resultado.b.versaoBuild ?? 'não informado' }}</strong>, {{ data(resultado.b.inicio) }} —
              <a [routerLink]="['/relatorio', resultado.b.id]">abrir relatório</a>
            </dd>
          </dl>

          @if (resultado.condicoes.length > 0) {
            <div class="aviso" role="alert" data-testid="aviso-condicoes">
              <p>As condições de teste diferem entre as execuções: a diferença nas métricas pode não vir do build.</p>
              <ul>
                @for (diferenca of resultado.condicoes; track diferenca.campo) {
                  <li data-testid="diferenca-condicao">{{ diferenca.campo }}: {{ diferenca.a }} em A, {{ diferenca.b }} em B</li>
                }
              </ul>
            </div>
          }
          @if (resultado.ambiente.length > 0) {
            <div class="aviso" data-testid="aviso-ambiente">
              <p>O ambiente difere entre as execuções.</p>
              <ul>
                @for (diferenca of resultado.ambiente; track diferenca.campo) {
                  <li data-testid="diferenca-ambiente">{{ diferenca.campo }}: {{ diferenca.a }} em A, {{ diferenca.b }} em B</li>
                }
              </ul>
            </div>
          }

          <table data-testid="comparacao-metricas">
            <caption>
              Mediana de cada métrica entre as iterações. Diferença de B em relação a A; menor é melhor.
            </caption>
            <thead>
              <tr>
                <th scope="col">Métrica</th>
                <th scope="col">A</th>
                <th scope="col">B</th>
                <th scope="col">Diferença</th>
                <th scope="col">Diferença (%)</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              @for (metrica of resultado.metricas; track metrica.id) {
                <tr data-testid="comparacao-metrica" [attr.data-metrica]="metrica.id" [class]="metrica.situacao">
                  <th scope="row">{{ metrica.nome }}</th>
                  <td data-testid="valor-a">{{ valor(metrica.a, metrica.unidade) }}</td>
                  <td data-testid="valor-b">{{ valor(metrica.b, metrica.unidade) }}</td>
                  <td data-testid="diferenca">{{ diferenca(metrica.diferenca, metrica.unidade) }}</td>
                  <td data-testid="diferenca-percentual">{{ pct(metrica.percentual) }}</td>
                  <td data-testid="situacao">{{ situacoes[metrica.situacao] }}</td>
                </tr>
              }
            </tbody>
          </table>

          <div class="acoes">
            <button type="button" class="secundario" data-testid="exportar-comparacao" (click)="exportar()">Exportar CSV</button>
            <label>
              Separador do CSV
              <select data-testid="separador-csv" (change)="separador.set($any($event.target).value)">
                <option value="," [selected]="separador() === ','">vírgula (padrão)</option>
                <option value=";" [selected]="separador() === ';'">ponto e vírgula (planilhas em português)</option>
              </select>
            </label>
          </div>
        }
      }
    </main>
  `,
  styles: `
    main {
      max-width: 72rem;
      margin: 0 auto;
      padding: 16px 24px 48px;
    }
    .escolha {
      display: grid;
      gap: 8px;
      max-width: 40rem;
      margin-bottom: 16px;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    select {
      font: inherit;
    }
    dl {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      gap: 2px 16px;
      margin: 0 0 12px;
    }
    dd {
      margin: 0;
    }
    .aviso p {
      margin: 0 0 4px;
    }
    .aviso ul {
      margin: 0;
      padding-left: 20px;
    }
    table {
      margin: 12px 0;
      border-collapse: collapse;
    }
    caption {
      text-align: left;
      opacity: 0.7;
    }
    th,
    td {
      padding: 4px 24px 4px 0;
      text-align: left;
      font-weight: normal;
    }
    thead th {
      font-weight: 600;
    }
    td {
      font-variant-numeric: tabular-nums;
    }
    tr.pior td:last-child {
      color: #c0392b;
      font-weight: 600;
    }
    tr.melhor td:last-child {
      color: #2e8540;
      font-weight: 600;
    }
    .acoes {
      align-items: center;
    }
    .acoes label {
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }
  `,
})
export class Comparacao {
  private readonly ponte = inject(PonteExtensao);
  private readonly router = inject(Router);

  /** Parâmetros `:idA` e `:idB` da rota. */
  readonly idA = input.required<string>();
  readonly idB = input.required<string>();

  protected readonly rotulo = rotuloDaExecucao;
  protected readonly data = dataHora;
  protected readonly valor = valorComUnidade;
  protected readonly pct = percentual;
  protected readonly situacoes = SITUACOES;

  protected readonly carga = signal<Carga>({ fase: 'carregando' });
  private readonly historico = signal<RegistroExecucao[]>([]);
  protected readonly separador = signal<SeparadorCsv>(',');

  /** Só execuções de cenário completas podem ser escolhidas, de qualquer cenário: escolher cenários diferentes mostra a recusa. */
  protected readonly elegiveis = computed(() => {
    const carga = this.carga();
    const escolhidas = carga.fase === 'pronto' ? [carga.a.id, carga.b.id] : [];
    return this.historico().filter((registro) => podeSerReferencia(registro) || escolhidas.includes(registro.id));
  });

  protected readonly comparacao = computed((): Resultado | null => {
    const carga = this.carga();
    return carga.fase === 'pronto' ? compararExecucoes(carga.a, carga.b) : null;
  });

  constructor() {
    effect(() => {
      const idA = this.idA();
      const idB = this.idB();
      untracked(() => void this.carregar(idA, idB));
    });
  }

  protected diferenca(valor: number | null, unidade: string): string {
    return valor === null ? '—' : comSinal(valorComUnidade(valor, unidade), valor);
  }

  protected trocar(idA: string, idB: string): void {
    void this.router.navigate(['/relatorio/comparar', idA, idB]);
  }

  protected exportar(): void {
    const comparacao = this.comparacao();
    if (!comparacao?.ok) return;
    this.ponte.baixar(nomeDoArquivoDaComparacao(comparacao), csvDaComparacao(comparacao, this.separador()), TIPO_CSV);
  }

  private async carregar(idA: string, idB: string): Promise<void> {
    this.carga.set({ fase: 'carregando' });
    try {
      const [a, b, historico] = await Promise.all([this.ponte.lerRegistro(idA), this.ponte.lerRegistro(idB), this.ponte.listarHistorico()]);
      if (this.idA() !== idA || this.idB() !== idB) return;
      this.historico.set(historico);
      const faltam = [a ? null : idA, b ? null : idB].filter((id) => id !== null);
      this.carga.set(a && b ? { fase: 'pronto', a, b } : { fase: 'ausente', faltam });
    } catch {
      this.carga.set({ fase: 'ausente', faltam: [idA, idB] });
    }
  }
}
