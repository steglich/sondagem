import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { type AvaliacaoRegressao, avaliarRegressao } from '../../../../shared/comparacao';
import { type RegistroExecucao, podeSerReferencia } from '../../../../shared/historico';
import { PonteExtensao } from '../sessao/ponte';
import { percentual, rotuloDaExecucao, valorComUnidade } from './formato';
import { carregarLinhaDeBase } from './linha-de-base-apoio';

type Estado =
  | { tipo: 'nada' }
  | { tipo: 'desfeita' }
  | { tipo: 'propria' }
  | { tipo: 'avaliada'; base: RegistroExecucao; avaliacao: Extract<AvaliacaoRegressao, { ok: true }> };

const RESULTADOS = { regressao: 'regressão', 'dentro-do-limite': 'dentro do limite', 'sem-dado': 'sem dado' } as const;

/**
 * Compara uma execução com a linha de base do cenário dela e sinaliza as métricas
 * que passaram do limite. Não mostra nada se o cenário não tem linha de base, ou se
 * a execução não pode ser comparada (sessão manual, resultado parcial).
 */
@Component({
  selector: 'sd-regressao',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let atual = estado();
    @if (atual.tipo === 'desfeita') {
      <p class="aviso" role="status" data-testid="linha-de-base-desfeita">
        A linha de base deste cenário foi desfeita: a execução de referência não está mais no histórico.
      </p>
    } @else if (atual.tipo === 'propria') {
      <p class="nota" data-testid="e-linha-de-base">Esta execução é a linha de base do cenário.</p>
    } @else if (atual.tipo === 'avaliada') {
      <section aria-label="Comparação com a linha de base" data-testid="regressao-avaliacao">
        @if (atual.avaliacao.regressao) {
          <p class="aviso regressao" role="alert" data-testid="regressao">
            Regressão em relação à linha de base: {{ emRegressao(atual.avaliacao) }}.
          </p>
        } @else {
          <p class="sem-regressao" role="status" data-testid="sem-regressao">Sem regressão em relação à linha de base.</p>
        }
        <p class="nota" data-testid="regressao-base">Linha de base: {{ rotulo(atual.base) }}.</p>
        @if (atual.avaliacao.condicoes.length > 0) {
          <p class="aviso" data-testid="regressao-condicoes">
            As condições desta execução diferem das da linha de base ({{ campos(atual.avaliacao) }}): a diferença pode não vir do build.
          </p>
        }
        <table>
          <thead>
            <tr>
              <th scope="col">Métrica (mediana)</th>
              <th scope="col">Linha de base</th>
              <th scope="col">Esta execução</th>
              <th scope="col">Diferença</th>
              <th scope="col">Limite</th>
              <th scope="col">Resultado</th>
            </tr>
          </thead>
          <tbody>
            @for (metrica of atual.avaliacao.metricas; track metrica.id) {
              <tr data-testid="regressao-metrica" [attr.data-metrica]="metrica.id" [class.acima]="metrica.resultado === 'regressao'">
                <th scope="row">{{ metrica.nome }}</th>
                <td>{{ valor(metrica.a, metrica.unidade) }}</td>
                <td>{{ valor(metrica.b, metrica.unidade) }}</td>
                <td>{{ pct(metrica.percentual) }}</td>
                <td>{{ metrica.limite }}%</td>
                <td data-testid="regressao-resultado">{{ resultados[metrica.resultado] }}</td>
              </tr>
            }
          </tbody>
        </table>
      </section>
    }
  `,
  styles: `
    section {
      margin: 12px 0;
    }
    .regressao {
      border-left-color: #c0392b;
      background: color-mix(in srgb, #c0392b 12%, transparent);
      font-weight: 600;
    }
    .sem-regressao {
      font-weight: 600;
    }
    .nota {
      opacity: 0.7;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      padding: 2px 8px 2px 0;
      text-align: left;
      font-weight: normal;
    }
    thead th {
      font-weight: 600;
    }
    tr.acima td:last-child {
      color: #c0392b;
      font-weight: 600;
    }
  `,
})
export class Regressao {
  private readonly ponte = inject(PonteExtensao);

  /** Execução a avaliar. */
  readonly id = input.required<string>();
  /** Muda quando a linha de base foi marcada, desmarcada ou teve os limites alterados: a avaliação é refeita. */
  readonly versao = input(0);

  protected readonly estado = signal<Estado>({ tipo: 'nada' });
  protected readonly resultados = RESULTADOS;
  protected readonly valor = valorComUnidade;
  protected readonly pct = percentual;
  protected readonly rotulo = rotuloDaExecucao;
  private pedido = 0;

  constructor() {
    effect(() => {
      const id = this.id();
      this.versao();
      untracked(() => void this.avaliar(id));
    });
  }

  protected emRegressao(avaliacao: Extract<AvaliacaoRegressao, { ok: true }>): string {
    return avaliacao.metricas
      .filter((m) => m.resultado === 'regressao')
      .map((m) => `${m.nome} (${m.percentual === null ? 'era zero' : percentual(m.percentual)}, limite de ${m.limite}%)`)
      .join('; ');
  }

  protected campos(avaliacao: Extract<AvaliacaoRegressao, { ok: true }>): string {
    return avaliacao.condicoes.map((d) => d.campo.toLowerCase()).join(', ');
  }

  private async avaliar(id: string): Promise<void> {
    const pedido = ++this.pedido;
    const estado = await this.calcular(id).catch((): Estado => ({ tipo: 'nada' }));
    // Uma resposta atrasada de um pedido anterior não sobrescreve a mais nova.
    if (pedido === this.pedido) this.estado.set(estado);
  }

  private async calcular(id: string): Promise<Estado> {
    const registro = await this.ponte.lerRegistro(id);
    if (!registro || registro.nomeCenario === null || !podeSerReferencia(registro)) return { tipo: 'nada' };
    const { linha, base, desfeita } = await carregarLinhaDeBase(this.ponte, registro.nomeCenario);
    if (desfeita) return { tipo: 'desfeita' };
    if (!linha || !base) return { tipo: 'nada' };
    if (linha.id === registro.id) return { tipo: 'propria' };
    const avaliacao = avaliarRegressao(base, registro, linha);
    return avaliacao.ok ? { tipo: 'avaliada', base, avaliacao } : { tipo: 'nada' };
  }
}
