import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { inpDaAnalise, metricasDeCarregamento } from '../../../../shared/agregacao';
import { formatarMs } from '../../../../shared/texto';
import type { Desfecho, ResultadoSessao, TipoAnalise, TipoRecurso } from '../../../../shared/types';

const TIPOS: Record<TipoAnalise, string> = { 'sessao-manual': 'Sessão manual' };

const DESFECHOS: Record<Desfecho, string> = {
  concluida: 'Concluída',
  cancelada: 'Análise cancelada',
  interrompida: 'Interrompida',
};

const RECURSOS: Record<TipoRecurso, string> = {
  'script-registrado': 'Script de medição registrado',
  observador: 'Observadores de performance',
  listener: 'Listeners de eventos',
  porta: 'Conexões entre a página e a extensão',
  temporizador: 'Temporizadores',
};

const INDISPONIVEL = 'indisponível';

/** Resultado de uma análise terminada, em números e listas simples. */
@Component({
  selector: 'sd-resultado',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="titulo-resultado">
      <h2 id="titulo-resultado">Resultado</h2>
      <dl class="resumo">
        <dt>Tipo</dt>
        <dd data-testid="resultado-tipo">{{ tipo() }}</dd>
        <dt>Situação</dt>
        <dd data-testid="resultado-desfecho">{{ desfecho() }}</dd>
        <dt>Página</dt>
        <dd data-testid="resultado-url">{{ resultado().url }}</dd>
        <dt>Duração</dt>
        <dd>{{ segundos(resultado().fim) }}</dd>
      </dl>

      @if (resultado().desfecho === 'interrompida') {
        <p class="aviso" data-testid="resultado-interrompida">
          A sessão foi interrompida (aba fechada ou extensão suspensa). Os dados recebidos até então foram mantidos.
        </p>
      }

      @if (resultado().desfecho !== 'cancelada') {
        @if (comCarregamento()) {
          <h3>Carregamento</h3>
          @for (carregamento of carregamentos(); track carregamento.id) {
            <div class="carregamento" data-testid="carregamento">
              <p class="url">{{ carregamento.url }}</p>
              <dl>
                <dt>LCP</dt>
                <dd data-testid="metrica-lcp">{{ carregamento.lcp }}</dd>
                <dt>CLS</dt>
                <dd data-testid="metrica-cls">{{ carregamento.cls }}</dd>
                <dt>FCP</dt>
                <dd data-testid="metrica-fcp">{{ carregamento.fcp }}</dd>
                <dt>TTFB</dt>
                <dd data-testid="metrica-ttfb">{{ carregamento.ttfb }}</dd>
              </dl>
            </div>
          } @empty {
            <p data-testid="sem-carregamentos">Nenhum carregamento observado.</p>
          }
        }

        @if (comProcessamento()) {
          <h3>Processamento</h3>
          <dl>
            <dt>INP</dt>
            <dd data-testid="metrica-inp">{{ inp() }}</dd>
          </dl>

          <h4>Long tasks ({{ resultado().dados.longTasks.length }})</h4>
          <ul data-testid="lista-long-tasks">
            @for (tarefa of resultado().dados.longTasks; track $index) {
              <li data-testid="long-task">
                <span>{{ segundos(tarefa.inicio) }}</span>
                <span>{{ ms(tarefa.duracao) }}</span>
              </li>
            } @empty {
              <li class="vazio">Nenhuma long task.</li>
            }
          </ul>

          <h4>Interações ({{ resultado().dados.interacoes.length }})</h4>
          <ul data-testid="lista-interacoes">
            @for (interacao of resultado().dados.interacoes; track $index) {
              <li data-testid="interacao">
                <span>{{ segundos(interacao.inicio) }}</span>
                <span class="alvo">{{ interacao.tipo }} em {{ interacao.alvo }}</span>
                <span>{{ ms(interacao.duracao) }}</span>
              </li>
            } @empty {
              <li class="vazio">Nenhuma interação acima de 40 ms.</li>
            }
          </ul>
        }
      }

      <h3>Limpeza</h3>
      <p data-testid="limpeza-concluida">Desconexão concluída. O que foi removido:</p>
      <ul data-testid="lista-limpeza">
        @for (item of limpeza(); track item.recurso) {
          <li data-testid="item-limpeza">
            <span>{{ item.nome }}</span>
            <span>{{ item.quantidade }}</span>
          </li>
        } @empty {
          <li class="vazio">Nada estava instalado.</li>
        }
      </ul>
      @if (!resultado().paginaRespondeu) {
        <p class="nota" data-testid="limpeza-sem-pagina">
          A página não respondeu ao encerramento: os observadores dela terminaram junto com o documento.
        </p>
      }
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
      font-variant-numeric: tabular-nums;
    }
    ul {
      margin: 0 0 12px;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 4px 0;
      border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent);
      font-variant-numeric: tabular-nums;
    }
    .alvo {
      flex: 1;
      overflow-wrap: anywhere;
    }
    .url,
    .vazio,
    .nota {
      opacity: 0.7;
      overflow-wrap: anywhere;
    }
  `,
})
export class Resultado {
  readonly resultado = input.required<ResultadoSessao>();

  protected readonly ms = formatarMs;
  protected readonly tipo = computed(() => TIPOS[this.resultado().tipo]);
  protected readonly desfecho = computed(() => DESFECHOS[this.resultado().desfecho]);
  protected readonly comCarregamento = computed(() => this.resultado().selecao.includes('carregamento'));
  protected readonly comProcessamento = computed(() => this.resultado().selecao.includes('processamento'));

  protected readonly carregamentos = computed(() =>
    this.resultado().dados.documentos.map((documento) => {
      const metricas = metricasDeCarregamento(documento.metricas);
      return {
        id: documento.id,
        url: documento.url,
        lcp: this.emMs(metricas.lcp),
        // CLS é uma pontuação sem unidade.
        cls: metricas.cls === null ? INDISPONIVEL : metricas.cls.toFixed(3),
        fcp: this.emMs(metricas.fcp),
        ttfb: this.emMs(metricas.ttfb),
      };
    }),
  );

  protected readonly inp = computed(() => this.emMs(inpDaAnalise(this.resultado().dados)));

  protected readonly limpeza = computed(() =>
    this.resultado().limpeza.map((item) => ({ ...item, nome: RECURSOS[item.recurso] })),
  );

  /** Instante relativo ao início da sessão. */
  protected segundos(instante: number): string {
    return `${((instante - this.resultado().inicio) / 1000).toFixed(1)} s`;
  }

  private emMs(valor: number | null): string {
    return valor === null ? INDISPONIVEL : formatarMs(valor);
  }
}
