import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { inpDaAnalise, metricasDeCarregamento } from '../../../../shared/agregacao';
import { descreverCondicoes } from '../../../../shared/condicoes';
import { descreverStorage } from '../../../../shared/limpeza-storage';
import { FUNCOES_EXIBIDAS, LIMITE_PERFIL_MANUAL_MS } from '../../../../shared/cpu';
import { explicarDesconexao } from '../../../../shared/mensagens-debugger';
import { CONSTRUTORES_EXIBIDOS, LIMITES_PADRAO } from '../../../../shared/memoria';
import { formatarBytes, formatarMs, formatarVariacaoBytes } from '../../../../shared/texto';
import type {
  ClassificacaoVazamento,
  Desfecho,
  ListaTruncavel,
  IdMetricaIteracao,
  MetricaMemoria,
  ResultadoSessao,
  SerieMemoria,
  TipoAnalise,
  TipoRecurso,
  Variacao,
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
  'condicao-de-teste': 'Condições de teste (throttling e cache) desfeitas',
};

const LISTAS: Record<ListaTruncavel, string> = {
  longTasks: 'long tasks',
  interacoes: 'interações',
  errosPagina: 'erros da página',
  documentos: 'carregamentos',
  snapshots: 'construtores de cada snapshot',
  funcoesCpu: 'funções do perfil de CPU',
};

const CLASSIFICACOES: Record<ClassificacaoVazamento, string> = {
  'vazamento-provavel': 'Vazamento provável',
  'sem-indicio': 'Sem indício de vazamento',
  'dados-insuficientes': 'Dados insuficientes',
};

const SERIES: Record<MetricaMemoria, string> = { heap_usado: 'o heap', nos_dom: 'o número de nós DOM', listeners: 'o número de listeners' };

const COM_SINAL = (valor: number): string => `${valor > 0 ? '+' : ''}${valor}`;

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

      @if (falhaDeSessao(); as falha) {
        <p class="aviso" role="alert" data-testid="resultado-falha-sessao">
          Falha de sessão{{ falha.iteracao === null ? '' : ' na iteração ' + falha.iteracao }}: a aplicação redirecionou para a tela
          de login (<code>{{ falha.url }}</code
          >). Não é um resultado de performance: nenhuma estatística desta execução é válida. Entre na aplicação e execute de novo.
        </p>
      }

      @if (truncado(); as listas) {
        <p class="aviso" data-testid="resultado-truncado">
          Esta análise passou do limite de armazenamento. Foram removidas as listas detalhadas de {{ listas }}; as estatísticas
          foram calculadas antes e estão completas.
        </p>
      }

      <h3>Condições de teste</h3>
      <dl data-testid="resultado-condicoes">
        <dt>Throttling</dt>
        <dd data-testid="condicoes-throttling">{{ condicoes().perfil }} ({{ throttlingEfetivo() }})</dd>
        <dt>CPU</dt>
        <dd data-testid="condicoes-cpu">{{ condicoes().cpu }}×</dd>
        @if (condicoes().rede; as rede) {
          <dt>Latência</dt>
          <dd data-testid="condicoes-latencia">{{ rede.latenciaMs }} ms</dd>
          <dt>Download</dt>
          <dd data-testid="condicoes-download">{{ rede.downloadKbps === null ? 'sem limite' : rede.downloadKbps + ' kbps' }}</dd>
          <dt>Upload</dt>
          <dd data-testid="condicoes-upload">{{ rede.uploadKbps === null ? 'sem limite' : rede.uploadKbps + ' kbps' }}</dd>
        }
        <dt>Cache</dt>
        <dd data-testid="condicoes-cache">{{ cache() }}</dd>
        @if (condicoes().storageLimpo.length > 0) {
          <dt>Storage apagado</dt>
          <dd data-testid="condicoes-storage">{{ storageLimpo() }}</dd>
        }
        @if (resultado().navegador; as navegador) {
          <dt>Navegador</dt>
          <dd data-testid="resultado-navegador">{{ navegador.versao }}</dd>
        }
        <dt>Outras extensões ativas</dt>
        <dd data-testid="resultado-extensoes">{{ extensoes() }}</dd>
      </dl>
      @if (condicoes().rede) {
        <p class="nota" data-testid="condicoes-limite-rede">
          A limitação de rede pode não alcançar WebSockets nem as requisições feitas por um service worker da página.
        </p>
      }
      @if (resultado().extensoes.length > 0) {
        <p class="nota" data-testid="resultado-aviso-extensoes">
          Outras extensões podem ter interferido na medição. Para comparar resultados, use um perfil limpo do Chrome.
        </p>
      }

      @if (perfilCpuAtivo()) {
        <p class="aviso" data-testid="resultado-perfil-cpu">
          As métricas desta análise foram coletadas com o perfil de CPU ligado, que deixa a página mais lenta. Para tempos sem
          esse custo, rode de novo sem a verificação “CPU”.
        </p>
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

        @if (resultado().desfecho !== 'cancelada' && !falhaDeSessao()) {
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

      @if (memoria(); as m) {
        <h3>Memória</h3>
        @if (m.classificacao; as classificacao) {
          <p [class.aviso]="classificacao === 'vazamento-provavel'">
            <strong data-testid="memoria-classificacao">{{ classificacoes[classificacao] }}</strong>
          </p>
          <p class="nota" data-testid="memoria-indicio">{{ indicio() }}</p>
        } @else if (comMemoria()) {
          <p class="nota" data-testid="memoria-sem-classificacao">
            Sessão manual: não há iterações comparáveis, então o resultado não é classificado.
          </p>
        }

        @if (serie(); as s) {
          <h4>Por iteração</h4>
          <table data-testid="memoria-serie">
            <thead>
              <tr>
                <th scope="col">Iteração</th>
                <th scope="col">Heap usado</th>
                <th scope="col">Nós DOM</th>
                <th scope="col">Listeners</th>
              </tr>
            </thead>
            <tbody>
              @for (linha of s.linhas; track linha.iteracao) {
                <tr data-testid="memoria-iteracao">
                  <th scope="row">{{ linha.iteracao }}</th>
                  <td>{{ linha.heap }}</td>
                  <td>{{ linha.nos }}</td>
                  <td>{{ linha.listeners }}</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr data-testid="memoria-crescimento">
                <th scope="row">Crescimento médio por iteração</th>
                <td>{{ s.crescimento.heap }}</td>
                <td>{{ s.crescimento.nos }}</td>
                <td>{{ s.crescimento.listeners }}</td>
              </tr>
            </tfoot>
          </table>
        }

        @if (medicoesManuais(); as mm) {
          <dl data-testid="memoria-medicoes">
            <dt>Medições</dt>
            <dd data-testid="memoria-medicoes-quantidade">{{ mm.quantidade }}</dd>
            <dt>Heap usado</dt>
            <dd>{{ mm.heap }}</dd>
            <dt>Nós DOM</dt>
            <dd>{{ mm.nos }}</dd>
            <dt>Listeners</dt>
            <dd>{{ mm.listeners }}</dd>
          </dl>
        }

        @if (m.domListeners; as d) {
          <h4>DOM e listeners</h4>
          <dl data-testid="memoria-dom-listeners">
            <dt>Nós DOM desanexados</dt>
            <dd data-testid="memoria-nos-desanexados">{{ variacao(d.nosDesanexados, 'indisponível') }}</dd>
            <dt>Listeners</dt>
            <dd data-testid="memoria-listeners">{{ variacao(d.listeners, 'indisponível') }}</dd>
          </dl>
        }

        @if (resultado().dados.snapshots.length > 0) {
          <h4>Censos de objetos ({{ resultado().dados.snapshots.length }})</h4>
          <ul data-testid="memoria-snapshots">
            @for (snapshot of snapshots(); track snapshot.rotulo) {
              <li data-testid="memoria-snapshot">
                <span class="alvo">{{ snapshot.rotulo }}</span>
                <span>{{ snapshot.objetos }}</span>
              </li>
            }
          </ul>
        }

        @if (m.comparacao; as comparacao) {
          <h4>Construtores que mais cresceram</h4>
          <p class="nota" data-testid="memoria-comparacao">
            Número de objetos vivos por construtor, entre “{{ comparacao.de }}” e “{{ comparacao.para }}”. A extensão não tem
            acesso ao tamanho dos objetos; para isso, compare heap snapshots no DevTools.
          </p>
          @if (candidatos().length > 0) {
            <table data-testid="memoria-construtores">
              <thead>
                <tr>
                  <th scope="col">Construtor</th>
                  <th scope="col">Antes</th>
                  <th scope="col">Depois</th>
                  <th scope="col">Variação</th>
                </tr>
              </thead>
              <tbody>
                @for (candidato of candidatos(); track candidato.nome) {
                  <tr data-testid="memoria-construtor">
                    <th scope="row" class="construtor">{{ candidato.nome }}</th>
                    <td>{{ candidato.antes }}</td>
                    <td>{{ candidato.depois }}</td>
                    <td>{{ candidato.variacao }}</td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <p data-testid="memoria-sem-crescimento">Nenhum construtor ganhou objetos entre os dois censos.</p>
          }
        }

        @if (semDadosDeMemoria()) {
          <p class="nota" data-testid="memoria-sem-dados">
            Nenhuma medição de memória foi feita: o cenário não tem passos medir ou snapshot.
          </p>
        }
      }

      @if (cpu(); as c) {
        <h3>CPU</h3>
        @if (c.falha) {
          <p class="aviso" data-testid="cpu-falha">{{ c.falha }}</p>
        }
        @if (c.limiteAtingido) {
          <p class="aviso" data-testid="cpu-limite">
            O perfil de CPU parou ao atingir o limite de {{ limitePerfil }}: o resumo cobre só esse período. As outras
            verificações continuaram até o fim da sessão.
          </p>
        }
        @if (c.incompleto) {
          <p class="aviso" data-testid="cpu-incompleto">O navegador não entregou o perfil inteiro: o resumo abaixo está incompleto.</p>
        }
        @if (c.resumo; as r) {
          <dl data-testid="cpu-categorias">
            <dt>Tempo amostrado</dt>
            <dd data-testid="cpu-amostrado">{{ ms(r.tempoAmostrado) }}</dd>
            <dt>Em execução</dt>
            <dd data-testid="cpu-ativo">{{ parte(r.tempoAtivo) }}</dd>
            <dt>Ocioso</dt>
            <dd data-testid="cpu-ocioso">{{ parte(r.categorias.ocioso) }}</dd>
            <dt>Coleta de lixo</dt>
            <dd data-testid="cpu-coleta-de-lixo">{{ parte(r.categorias.coletaDeLixo) }}</dd>
            <dt>Interno do motor</dt>
            <dd data-testid="cpu-programa">{{ parte(r.categorias.programa) }}</dd>
            <dt>Extensões</dt>
            <dd data-testid="cpu-extensoes">{{ parte(r.categorias.extensoes) }}</dd>
          </dl>

          @if (funcoesCpu().length > 0) {
            <h4>Funções que mais consumiram</h4>
            <table data-testid="cpu-funcoes">
              <thead>
                <tr>
                  <th scope="col">Função</th>
                  <th scope="col">Próprio</th>
                  <th scope="col">Total</th>
                  <th scope="col">%</th>
                </tr>
              </thead>
              <tbody>
                @for (funcao of funcoesCpu(); track $index) {
                  <tr data-testid="cpu-funcao">
                    <th scope="row" class="construtor">
                      <span data-testid="cpu-funcao-nome">{{ funcao.nome }}</span>
                      <small data-testid="cpu-funcao-origem">{{ funcao.origem }}</small>
                    </th>
                    <td>{{ funcao.proprio }}</td>
                    <td>{{ funcao.total }}</td>
                    <td>{{ funcao.percentual }}</td>
                  </tr>
                }
                @if (outrasCpu(); as outras) {
                  <tr data-testid="cpu-outras">
                    <th scope="row">{{ outras.nome }}</th>
                    <td>{{ outras.proprio }}</td>
                    <td>—</td>
                    <td>{{ outras.percentual }}</td>
                  </tr>
                }
              </tbody>
            </table>
            <p class="nota" data-testid="cpu-nota">
              Próprio é o tempo dentro da função; total inclui o que ela chamou. O percentual é do tempo próprio sobre o tempo em
              execução, sem o ocioso. Os nomes e as linhas são os do código servido à página.
            </p>
          } @else {
            <p data-testid="cpu-sem-funcoes">Nenhuma função da página foi amostrada.</p>
          }
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
                @if (tarefa.causadaPelaMedicao) {
                  <span class="alvo nota" data-testid="long-task-da-medicao">causada pelo censo de objetos, fora das estatísticas</span>
                }
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
    .construtor {
      overflow-wrap: anywhere;
      word-break: break-word;
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

  protected readonly comMemoria = computed(() => this.resultado().selecao.includes('memoria'));
  protected readonly classificacoes = CLASSIFICACOES;

  /** Análise de memória; `null` sem as verificações ou em análise cancelada. */
  protected readonly memoria = computed(() => (this.resultado().desfecho === 'cancelada' ? null : this.resultado().memoria));

  private serieDe(metrica: MetricaMemoria): SerieMemoria | undefined {
    return this.memoria()?.series.find((s) => s.metrica === metrica);
  }

  /** O que sustenta a classificação. "Vazamento provável" é sempre apresentado como indício. */
  protected readonly indicio = computed(() => {
    switch (this.memoria()?.classificacao) {
      case 'vazamento-provavel': {
        const sinais = (this.memoria()?.series ?? [])
          .filter((serie) => serie.classificacao === 'vazamento-provavel')
          .map((serie) => {
            const pontos = serie.pontos;
            const total = pontos[pontos.length - 1]!.valor - pontos[0]!.valor;
            const quanto = serie.metrica === 'heap_usado' ? formatarVariacaoBytes(total) : COM_SINAL(total);
            return `${SERIES[serie.metrica]} subiu em ${serie.transicoesCrescentes} de ${pontos.length - 1} transições (${quanto} no total)`;
          });
        return (
          `Medido depois de cada iteração: ${sinais.join('; ')}. Isto é um indício, não uma confirmação: confirme analisando os ` +
          'objetos dos construtores listados abaixo, por exemplo comparando heap snapshots no DevTools.'
        );
      }
      case 'sem-indicio':
        return 'Heap, nós DOM e listeners não cresceram de forma consistente entre as iterações.';
      case 'dados-insuficientes':
        return `São necessárias ao menos ${LIMITES_PADRAO.iteracoesMinimas} iterações completas, cada uma com um passo medir, para classificar.`;
      default:
        return '';
    }
  });

  /** Tabela por iteração: uma linha para cada iteração que tem algum ponto. */
  protected readonly serie = computed(() => {
    const heap = this.serieDe('heap_usado');
    const nos = this.serieDe('nos_dom');
    const listeners = this.serieDe('listeners');
    const numeros = [...new Set([heap, nos, listeners].flatMap((s) => s?.pontos.map((p) => p.iteracao) ?? []))].sort((a, b) => a - b);
    if (numeros.length === 0) return null;
    const valor = (s: SerieMemoria | undefined, iteracao: number): number | undefined => s?.pontos.find((p) => p.iteracao === iteracao)?.valor;
    const texto = (v: number | undefined, formatar: (v: number) => string): string => (v === undefined ? '—' : formatar(v));
    const media = (s: SerieMemoria | undefined, formatar: (v: number) => string): string =>
      s?.crescimentoMedio === null || s?.crescimentoMedio === undefined ? '—' : formatar(s.crescimentoMedio);
    const contagem = (v: number): string => COM_SINAL(Math.round(v * 10) / 10);
    return {
      linhas: numeros.map((iteracao) => ({
        iteracao,
        heap: texto(valor(heap, iteracao), formatarBytes),
        nos: texto(valor(nos, iteracao), String),
        listeners: texto(valor(listeners, iteracao), String),
      })),
      crescimento: {
        heap: media(heap, (v) => formatarVariacaoBytes(Math.round(v))),
        nos: media(nos, contagem),
        listeners: media(listeners, contagem),
      },
    };
  });

  /** Sessão manual: as medições periódicas, do primeiro ao último valor. */
  protected readonly medicoesManuais = computed(() => {
    const medicoes = this.resultado().dados.medicoes;
    if (this.resultado().tipo !== 'sessao-manual' || !this.memoria() || medicoes.length === 0) return null;
    const primeira = medicoes[0]!;
    const ultima = medicoes[medicoes.length - 1]!;
    const intervalo = (de: number | null, ate: number | null, formatar: (v: number) => string): string =>
      de === null || ate === null ? INDISPONIVEL : `${formatar(de)} → ${formatar(ate)}`;
    return {
      quantidade: medicoes.length,
      heap: intervalo(primeira.heapUsado, ultima.heapUsado, formatarBytes),
      nos: intervalo(primeira.nosDom, ultima.nosDom, String),
      listeners: intervalo(primeira.listeners, ultima.listeners, String),
    };
  });

  protected readonly snapshots = computed(() =>
    this.resultado().dados.snapshots.map((s) => ({ rotulo: s.rotulo, objetos: `${s.totalObjetos} objetos` })),
  );

  /** Os construtores que mais cresceram: os candidatos a analisar. */
  protected readonly candidatos = computed(() =>
    (this.memoria()?.comparacao?.construtores ?? [])
      .filter((c) => c.contagem.variacao > 0)
      .slice(0, CONSTRUTORES_EXIBIDOS)
      .map((c) => ({
        nome: c.situacao === 'novo' ? `${c.nome} (novo)` : c.nome,
        antes: c.contagem.antes,
        depois: c.contagem.depois,
        variacao: COM_SINAL(c.contagem.variacao),
      })),
  );

  /** Perfil de CPU; `null` sem a verificação ou em análise cancelada. */
  protected readonly cpu = computed(() => (this.resultado().desfecho === 'cancelada' ? null : this.resultado().dados.cpu));
  protected readonly perfilCpuAtivo = computed(() => this.cpu()?.ativo === true);
  protected readonly limitePerfil = `${LIMITE_PERFIL_MANUAL_MS / 60_000} minutos`;

  /** Tempo com a fatia que representa do tempo amostrado. */
  protected parte(tempo: number): string {
    const amostrado = this.cpu()?.resumo?.tempoAmostrado ?? 0;
    return amostrado > 0 ? `${formatarMs(tempo)} (${((tempo / amostrado) * 100).toFixed(1)}%)` : formatarMs(tempo);
  }

  protected readonly funcoesCpu = computed(() =>
    (this.cpu()?.resumo?.funcoes ?? []).slice(0, FUNCOES_EXIBIDAS).map((f) => ({
      nome: f.nome,
      origem: f.arquivo === null ? 'origem não informada' : `${f.arquivo}${f.linha === null ? '' : `:${f.linha}`}`,
      proprio: formatarMs(f.tempoProprio),
      total: formatarMs(f.tempoTotal),
      percentual: `${f.percentual.toFixed(1)}%`,
    })),
  );

  /** O que não coube na lista: as funções além das exibidas e a linha "outras" do resumo. */
  protected readonly outrasCpu = computed(() => {
    const resumo = this.cpu()?.resumo;
    if (!resumo) return null;
    const ocultas = resumo.funcoes.slice(FUNCOES_EXIBIDAS);
    const quantidade = ocultas.length + (resumo.outras?.quantidade ?? 0);
    if (quantidade === 0) return null;
    const tempo = ocultas.reduce((soma, f) => soma + f.tempoProprio, 0) + (resumo.outras?.tempoProprio ?? 0);
    return {
      nome: `Outras (${quantidade} ${quantidade === 1 ? 'função' : 'funções'})`,
      proprio: formatarMs(tempo),
      percentual: `${(resumo.tempoAtivo > 0 ? (tempo / resumo.tempoAtivo) * 100 : 0).toFixed(1)}%`,
    };
  });

  protected readonly semDadosDeMemoria = computed(
    () => this.comMemoria() && this.resultado().dados.medicoes.length === 0 && this.resultado().dados.snapshots.length === 0,
  );

  protected variacao(valor: Variacao | null, ausente: string): string {
    return valor === null ? ausente : `${valor.antes} → ${valor.depois} (${COM_SINAL(valor.variacao)})`;
  }

  protected readonly conexaoPerdida = computed(() => {
    const motivo = this.resultado().conexaoPerdida;
    return motivo ? explicarDesconexao(motivo) : null;
  });

  protected readonly condicoes = computed(() => this.resultado().condicoes);
  protected readonly throttlingEfetivo = computed(() => descreverCondicoes(this.condicoes()));
  protected readonly cache = computed(() => {
    const { cacheLimpo, cacheDesligado } = this.condicoes();
    if (!cacheLimpo && !cacheDesligado) return 'como estava no navegador';
    return `${cacheLimpo ? 'limpo antes da análise' : 'não foi limpo'}; ${cacheDesligado ? 'desligado' : 'ligado'} durante`;
  });
  protected readonly storageLimpo = computed(() => descreverStorage(this.condicoes().storageLimpo));
  protected readonly extensoes = computed(() => {
    const extensoes = this.resultado().extensoes;
    return extensoes.length === 0 ? 'nenhuma' : `${extensoes.length}: ${extensoes.map((e) => e.nome).join(', ')}`;
  });
  protected readonly falhaDeSessao = computed(() => this.resultado().cenario?.falhaDeSessao ?? null);
  protected readonly truncado = computed(() => {
    const listas = this.resultado().truncado;
    return listas.length === 0 ? null : listas.map((lista) => LISTAS[lista]).join(', ');
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
