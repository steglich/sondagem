import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { inpDaAnalise, metricasDeCarregamento } from '../../../../shared/agregacao';
import { descreverThrottling } from '../../../../shared/cenario';
import { explicarDesconexao } from '../../../../shared/mensagens-debugger';
import { formatarMs } from '../../../../shared/texto';
import type {
  Desfecho,
  IdMetricaIteracao,
  ResultadoSessao,
  TipoAnalise,
  TipoRecurso,
} from '../../../../shared/types';

const TIPOS: Record<TipoAnalise, string> = { 'sessao-manual': 'Sessão manual', cenario: 'Cenário' };

const METRICAS: Record<IdMetricaIteracao, string> = {
  'duracao-iteracao': 'Duração da iteração',
  'tempo-long-tasks': 'Tempo em long tasks por iteração',
  'pior-interacao': 'Pior interação por iteração',
};

const DESFECHOS: Record<Desfecho, string> = {
  concluida: 'Concluída',
  cancelada: 'Análise cancelada',
  interrompida: 'Interrompida',
  erro: 'Erro na execução',
};

const RECURSOS: Record<TipoRecurso, string> = {
  'script-registrado': 'Script de medição registrado',
  observador: 'Observadores de performance',
  listener: 'Listeners de eventos',
  porta: 'Conexões entre a página e a extensão',
  temporizador: 'Temporizadores',
  depurador: 'Debugger anexado à aba',
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
        @if (conexaoPerdida(); as motivo) {
          <p class="aviso" data-testid="resultado-conexao-perdida">
            A análise foi interrompida: {{ motivo }} Os dados coletados até então foram mantidos e são parciais.
          </p>
        } @else {
          <p class="aviso" data-testid="resultado-interrompida">
            A sessão foi interrompida (aba fechada ou extensão suspensa). Os dados recebidos até então foram mantidos.
          </p>
        }
      }

      @if (resultado().cenario; as c) {
        <h3>Execução</h3>
        <dl data-testid="resultado-cenario">
          <dt>Cenário</dt>
          <dd data-testid="cenario-nome">{{ c.configuracao.nome }}</dd>
          <dt>Iterações completas</dt>
          <dd data-testid="cenario-iteracoes">{{ c.iteracoesCompletas }} de {{ c.configuracao.iteracoes }}</dd>
          <dt>Iterações incompletas</dt>
          <dd data-testid="cenario-incompletas">{{ c.iteracoesIncompletas }}</dd>
          <dt>Passos executados</dt>
          <dd data-testid="cenario-passos">{{ c.passosExecutados }}</dd>
          <dt>Throttling</dt>
          <dd data-testid="cenario-throttling">{{ throttling() }}</dd>
          @if (c.configuracao.versaoBuild; as versao) {
            <dt>Versão do build</dt>
            <dd data-testid="cenario-versao-build">{{ versao }}</dd>
          }
        </dl>

        @if (c.iteracoesIncompletas > 0) {
          <p class="nota" data-testid="cenario-aviso-incompletas">
            Iterações incompletas ficam fora das estatísticas.
          </p>
        }

        @for (falha of c.falhas; track $index) {
          <p class="aviso" data-testid="falha-passo">
            {{ falha.acao === 'pulou' ? 'Passo pulado' : 'Execução interrompida' }}
            @if (falha.caminho) {
              em <code>{{ falha.caminho }}</code> ({{ falha.tipoPasso }})
            }
            @if (falha.iteracao !== null) {
              , iteração {{ falha.iteracao }}
            }
            : {{ falha.motivo }}
          </p>
        }

        @if (resultado().desfecho !== 'cancelada') {
          <h4>Resumo por iteração</h4>
          <table data-testid="estatisticas">
            <thead>
              <tr>
                <th scope="col">Métrica</th>
                <th scope="col">Mediana</th>
                <th scope="col">p75</th>
                <th scope="col">p95</th>
                <th scope="col">Iterações</th>
              </tr>
            </thead>
            <tbody>
              @for (linha of estatisticas(); track linha.id) {
                <tr data-testid="estatistica" [attr.data-metrica]="linha.id">
                  <th scope="row">{{ linha.nome }}</th>
                  <td>{{ linha.mediana }}</td>
                  <td>{{ linha.p75 }}</td>
                  <td>{{ linha.p95 }}</td>
                  <td>{{ linha.amostras }}</td>
                </tr>
              }
            </tbody>
          </table>
        }

        @if (c.ambiente; as a) {
          <h4>Ambiente</h4>
          <dl data-testid="ambiente">
            <dt>Navegador</dt>
            <dd data-testid="ambiente-versao">{{ a.versaoNavegador }}</dd>
            <dt>Janela</dt>
            <dd data-testid="ambiente-janela">{{ a.janela.largura }} × {{ a.janela.altura }}</dd>
            <dt>DPR</dt>
            <dd data-testid="ambiente-dpr">{{ a.dpr }}</dd>
            <dt>User agent</dt>
            <dd data-testid="ambiente-user-agent">{{ a.userAgent }}</dd>
          </dl>
        }
      }

      @if (comErrosPagina() && resultado().desfecho !== 'cancelada') {
        <h3>Erros da página</h3>
        @if (resultado().dados.errosPagina.length > 0) {
          <p class="aviso" data-testid="erros-pagina-destaque">
            A página teve {{ resultado().dados.errosPagina.length }}
            {{ resultado().dados.errosPagina.length === 1 ? 'erro' : 'erros' }} durante a análise. Leve isso em conta ao ler
            os números de performance.
          </p>
          <ul data-testid="lista-erros-pagina">
            @for (erro of errosPagina(); track $index) {
              <li data-testid="erro-pagina">
                <span>{{ erro.quando }}</span>
                <span class="alvo">
                  {{ erro.tipo }}: {{ erro.mensagem }}
                  <small>{{ erro.origem }}</small>
                </span>
                <span>{{ erro.iteracao }}</span>
              </li>
            }
          </ul>
        } @else {
          <p data-testid="sem-erros-pagina">Nenhum erro da página.</p>
        }
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
    table {
      width: 100%;
      margin: 0 0 12px;
      border-collapse: collapse;
      font-variant-numeric: tabular-nums;
    }
    th,
    td {
      padding: 4px 6px 4px 0;
      border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent);
      text-align: right;
      font-weight: normal;
    }
    th:first-child {
      text-align: left;
    }
    thead th {
      opacity: 0.7;
    }
    small {
      display: block;
      opacity: 0.7;
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
  protected readonly comErrosPagina = computed(() => this.resultado().selecao.includes('erros-pagina'));

  protected readonly conexaoPerdida = computed(() => {
    const motivo = this.resultado().conexaoPerdida;
    return motivo ? explicarDesconexao(motivo) : null;
  });

  protected readonly throttling = computed(() => {
    const throttling = this.resultado().cenario?.configuracao.throttling ?? undefined;
    const descricao = descreverThrottling(throttling);
    // O throttling só passa a ser aplicado na fase 5; até lá o resultado diz isso.
    return throttling === undefined ? descricao : `${descricao} (registrado, não aplicado nesta versão)`;
  });

  protected readonly estatisticas = computed(() =>
    (this.resultado().cenario?.estatisticas ?? []).map((e) => ({
      id: e.id,
      nome: METRICAS[e.id],
      mediana: this.emMsOuTraco(e.mediana),
      p75: this.emMsOuTraco(e.p75),
      p95: this.emMsOuTraco(e.p95),
      amostras: e.amostras,
    })),
  );

  protected readonly errosPagina = computed(() =>
    this.resultado().dados.errosPagina.map((erro) => ({
      quando: this.segundos(erro.instante),
      tipo: erro.tipo === 'rejeicao' ? 'Promise rejeitada' : 'Exceção',
      mensagem: erro.mensagem,
      origem: erro.arquivo ? `${erro.arquivo}${erro.linha === null ? '' : `:${erro.linha}`}` : 'origem não informada',
      iteracao: typeof erro.iteracao === 'number' ? `iteração ${erro.iteracao}` : erro.iteracao === null ? 'fora das iterações' : '',
    })),
  );

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

  private emMsOuTraco(valor: number | null): string {
    return valor === null ? '—' : formatarMs(valor);
  }
}
