import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { descreverCondicoes } from '../../../../shared/condicoes';
import {
  CONFIGURACAO_PADRAO,
  type ConfiguracaoArmazenamento,
  type EstadoRegistro,
  type RegistroExecucao,
  ehParcial,
  usoDoHistorico,
} from '../../../../shared/historico';
import { formatarBytes, formatarMs } from '../../../../shared/texto';
import type { IdMetricaIteracao } from '../../../../shared/types';
import { variacaoEntreExecucoes } from '../../../../shared/variacao';
import { PonteExtensao } from '../sessao/ponte';

const ESTADOS: Record<EstadoRegistro, string> = {
  'em-andamento': 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
  interrompida: 'Interrompida',
  erro: 'Erro na execução',
};

const METRICAS: Record<IdMetricaIteracao, string> = {
  'duracao-iteracao': 'Duração da iteração',
  'tempo-long-tasks': 'Tempo em long tasks por iteração',
  'pior-interacao': 'Pior interação por iteração',
};

/** Quantas execuções a oferta de remoção tira de uma vez. */
export const REMOCAO_EM_LOTE = 10;

/** Texto de um campo numérico; vazio vira `null`. */
function numero(texto: string): number | null {
  const limpo = texto.trim().replace(',', '.');
  return limpo === '' ? null : Number(limpo);
}

/**
 * Histórico das análises guardadas, com o uso do armazenamento, a variação entre
 * execuções repetidas e a configuração de limites e retenção.
 */
@Component({
  selector: 'sd-historico',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="titulo-historico">
      <h2 id="titulo-historico">Histórico</h2>

      <p class="nota" data-testid="historico-uso">
        {{ registros().length }} {{ registros().length === 1 ? 'análise guardada' : 'análises guardadas' }}, {{ bytes(uso().bytes) }} de
        {{ bytes(uso().limiteBytes) }} ({{ percentual(uso().fracao) }}).
      </p>

      @if (uso().aviso) {
        <div class="aviso" role="alert" data-testid="historico-aviso-limite">
          <p>
            @if (uso().cheio) {
              O histórico atingiu o limite de {{ bytes(uso().limiteBytes) }}. Enquanto estiver cheio, as novas análises são guardadas
              só com as estatísticas, sem as listas detalhadas.
            } @else {
              O histórico está em {{ percentual(uso().fracao) }} do limite de {{ bytes(uso().limiteBytes) }}.
            }
            Remova execuções antigas ou aumente o limite.
          </p>
          <button type="button" class="secundario" data-testid="remover-antigas" [disabled]="antigas().length === 0" (click)="removerAntigas()">
            Remover as {{ antigas().length }} mais antigas
          </button>
        </div>
      }

      @if (registros().length === 0) {
        <p class="vazio" data-testid="historico-vazio">Nenhuma análise guardada ainda.</p>
      } @else {
        <ul>
          @for (registro of registros(); track registro.id) {
            <li data-testid="execucao" [class.aberta]="registro.id === aberto()">
              <span>
                <strong data-testid="execucao-nome">{{ registro.nomeCenario ?? 'Sessão manual' }}</strong>
                <small data-testid="execucao-data">{{ data(registro.inicio) }}</small>
                <small>
                  <span data-testid="execucao-estado" [class.parcial]="parcial(registro)">{{ estado(registro) }}</span>
                  · {{ condicoes(registro) }} · {{ bytes(registro.tamanho) }}
                </small>
                @if (parcial(registro)) {
                  <small data-testid="execucao-parcial">Resultado parcial: não serve de referência de comparação.</small>
                }
                @if (registro.truncado.length > 0) {
                  <small data-testid="execucao-truncada">Listas detalhadas removidas para caber no limite.</small>
                }
              </span>
              <span class="acoes">
                <button
                  type="button"
                  class="secundario"
                  [attr.data-testid]="'abrir-execucao-' + registro.id"
                  [disabled]="registro.estado === 'em-andamento'"
                  (click)="abrir.emit(registro.id)"
                >
                  Abrir
                </button>
                <button
                  type="button"
                  class="secundario"
                  [attr.data-testid]="'relatorio-execucao-' + registro.id"
                  [disabled]="registro.estado === 'em-andamento'"
                  (click)="abrirRelatorio(registro.id)"
                >
                  Relatório
                </button>
                <button
                  type="button"
                  class="secundario"
                  [attr.data-testid]="'remover-execucao-' + registro.id"
                  [disabled]="registro.estado === 'em-andamento'"
                  (click)="remover(registro.id)"
                >
                  Remover
                </button>
              </span>
            </li>
          }
        </ul>
      }

      @if (variacoes().length > 0) {
        <h3>Variação entre execuções</h3>
        <p class="nota">
          Execuções concluídas do mesmo cenário, nas mesmas condições. Variação acima de {{ configuracao().limiteVariacao }}% marca a
          métrica como instável: a diferença entre duas execuções pode ser só ruído.
        </p>
        @for (grupo of variacoes(); track grupo.nomeCenario + grupo.ids[0]) {
          <table data-testid="variacao">
            <caption>
              {{ grupo.nomeCenario }}
              ({{ grupo.execucoes }} execuções)
            </caption>
            <thead>
              <tr>
                <th scope="col">Métrica</th>
                <th scope="col">Média</th>
                <th scope="col">Variação</th>
              </tr>
            </thead>
            <tbody>
              @for (metrica of grupo.metricas; track metrica.id) {
                <tr data-testid="variacao-metrica" [class.instavel]="metrica.instavel">
                  <th scope="row">{{ metricas[metrica.id] }}</th>
                  <td>{{ metrica.media === null ? '—' : ms(metrica.media) }}</td>
                  <td>
                    {{ metrica.coeficiente === null ? 'indisponível' : metrica.coeficiente.toFixed(1) + '%' }}
                    @if (metrica.instavel) {
                      <strong data-testid="metrica-instavel">instável</strong>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      }

      <h3>Armazenamento</h3>
      <div class="campos">
        <label>
          Limite por execução, em MB
          <input type="number" min="1" data-testid="config-limite-execucao" [value]="limiteExecucao()" (input)="limiteExecucao.set($any($event.target).value)" />
        </label>
        <label>
          Limite do histórico, em MB
          <input type="number" min="1" data-testid="config-limite-historico" [value]="limiteHistorico()" (input)="limiteHistorico.set($any($event.target).value)" />
        </label>
        <label>
          Manter no máximo, por cenário (vazio = sem limite de quantidade)
          <input type="number" min="1" step="1" data-testid="config-maximo-por-cenario" [value]="maximoPorCenario()" (input)="maximoPorCenario.set($any($event.target).value)" />
        </label>
        <label>
          Idade máxima, em dias (vazio = sem limite de idade)
          <input type="number" min="1" step="1" data-testid="config-idade-maxima" [value]="idadeMaxima()" (input)="idadeMaxima.set($any($event.target).value)" />
        </label>
        <label>
          Variação máxima entre execuções, em %
          <input type="number" min="1" data-testid="config-limite-variacao" [value]="limiteVariacao()" (input)="limiteVariacao.set($any($event.target).value)" />
        </label>
      </div>
      @if (erro(); as mensagem) {
        <p class="aviso" role="alert" data-testid="config-erro">{{ mensagem }}</p>
      }
      @if (configSalva()) {
        <p class="nota" role="status" data-testid="config-salva">Configuração salva. A retenção vale a partir da próxima análise guardada.</p>
      }
      <button type="button" class="secundario" data-testid="salvar-config" (click)="salvarConfiguracao()">Salvar configuração</button>
    </section>
  `,
  styles: `
    section {
      margin-top: 24px;
    }
    ul {
      display: grid;
      gap: 8px;
      margin: 0 0 12px;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }
    li.aberta {
      padding-left: 8px;
      border-left: 3px solid #1a56c4;
    }
    small {
      display: block;
      opacity: 0.7;
      overflow-wrap: anywhere;
    }
    .parcial,
    .instavel strong {
      color: #c77700;
      font-weight: 600;
    }
    table {
      width: 100%;
      margin-bottom: 12px;
      border-collapse: collapse;
    }
    caption {
      text-align: left;
      font-weight: 600;
    }
    th,
    td {
      padding: 2px 6px 2px 0;
      text-align: left;
      font-weight: normal;
    }
    .campos {
      display: grid;
      gap: 8px;
      margin-bottom: 12px;
    }
    .campos label {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .campos input {
      box-sizing: border-box;
      width: 100%;
      font: inherit;
    }
    .aviso p {
      margin: 0 0 6px;
    }
    .vazio,
    .nota {
      opacity: 0.7;
    }
  `,
})
export class Historico {
  private readonly ponte = inject(PonteExtensao);

  /** Muda quando uma análise termina (é o id do último resultado): a lista é relida. */
  readonly versao = input<string | null>(null);
  /** Execução cujo resultado está aberto no painel. */
  readonly aberto = input<string | null>(null);
  readonly abrir = output<string>();
  /** Uma execução saiu do histórico. */
  readonly removida = output<string>();

  protected readonly registros = signal<RegistroExecucao[]>([]);
  protected readonly configuracao = signal<ConfiguracaoArmazenamento>(CONFIGURACAO_PADRAO);
  protected readonly uso = computed(() =>
    usoDoHistorico(
      this.registros().reduce((total, registro) => total + registro.tamanho, 0),
      this.configuracao(),
    ),
  );
  /** As mais antigas já terminadas, que a oferta de remoção tira. */
  protected readonly antigas = computed(() =>
    this.registros()
      .filter((registro) => registro.estado !== 'em-andamento')
      .slice(-REMOCAO_EM_LOTE),
  );
  protected readonly variacoes = computed(() => variacaoEntreExecucoes(this.registros(), this.configuracao().limiteVariacao));

  protected readonly limiteExecucao = signal('');
  protected readonly limiteHistorico = signal('');
  protected readonly maximoPorCenario = signal('');
  protected readonly idadeMaxima = signal('');
  protected readonly limiteVariacao = signal('');
  protected readonly erro = signal<string | null>(null);
  protected readonly configSalva = signal(false);

  protected readonly metricas = METRICAS;
  protected readonly bytes = formatarBytes;
  protected readonly ms = formatarMs;
  protected readonly parcial = ehParcial;

  constructor() {
    void this.carregarConfiguracao();
    effect(() => {
      this.versao();
      untracked(() => void this.recarregar());
    });
  }

  protected estado(registro: RegistroExecucao): string {
    return registro.resumo?.cenario?.falhaDeSessao ? 'Falha de sessão' : ESTADOS[registro.estado];
  }

  protected condicoes(registro: RegistroExecucao): string {
    return descreverCondicoes(registro.condicoes);
  }

  protected data(instante: number): string {
    return new Date(instante).toLocaleString('pt-BR');
  }

  protected percentual(fracao: number): string {
    return `${(fracao * 100).toFixed(fracao < 0.1 ? 1 : 0)}%`;
  }

  /** Abre o relatório completo da execução em uma aba própria. */
  protected abrirRelatorio(id: string): void {
    this.ponte.abrirRelatorio(id);
  }

  protected async remover(id: string): Promise<void> {
    await this.ponte.removerExecucao(id);
    this.removida.emit(id);
    await this.recarregar();
  }

  protected async removerAntigas(): Promise<void> {
    for (const registro of this.antigas()) {
      await this.ponte.removerExecucao(registro.id);
      this.removida.emit(registro.id);
    }
    await this.recarregar();
  }

  protected async salvarConfiguracao(): Promise<void> {
    this.configSalva.set(false);
    const limiteExecucaoMb = numero(this.limiteExecucao());
    const limiteHistoricoMb = numero(this.limiteHistorico());
    const maximoPorCenario = numero(this.maximoPorCenario());
    const idadeMaximaDias = numero(this.idadeMaxima());
    const limiteVariacao = numero(this.limiteVariacao());
    const positivo = (valor: number | null): valor is number => valor !== null && Number.isFinite(valor) && valor > 0;
    const inteiroOuVazio = (valor: number | null): boolean => valor === null || (Number.isInteger(valor) && valor > 0);
    const erro = !positivo(limiteExecucaoMb)
      ? 'O limite por execução deve ser um número maior que zero.'
      : !positivo(limiteHistoricoMb)
        ? 'O limite do histórico deve ser um número maior que zero.'
        : limiteExecucaoMb > limiteHistoricoMb
          ? 'O limite por execução não pode ser maior que o do histórico.'
          : !inteiroOuVazio(maximoPorCenario)
            ? 'A quantidade por cenário deve ser um número inteiro maior que zero, ou vazia.'
            : !inteiroOuVazio(idadeMaximaDias)
              ? 'A idade máxima deve ser um número inteiro de dias maior que zero, ou vazia.'
              : !positivo(limiteVariacao)
                ? 'A variação máxima deve ser um número maior que zero.'
                : null;
    this.erro.set(erro);
    if (erro) return;
    const configuracao: ConfiguracaoArmazenamento = {
      limiteExecucaoMb: limiteExecucaoMb!,
      limiteHistoricoMb: limiteHistoricoMb!,
      retencao: { maximoPorCenario, idadeMaximaDias },
      limiteVariacao: limiteVariacao!,
    };
    await this.ponte.salvarConfiguracaoArmazenamento(configuracao);
    this.aplicar(configuracao);
    this.configSalva.set(true);
  }

  private async carregarConfiguracao(): Promise<void> {
    this.aplicar(await this.ponte.lerConfiguracaoArmazenamento());
  }

  private aplicar(configuracao: ConfiguracaoArmazenamento): void {
    this.configuracao.set(configuracao);
    this.limiteExecucao.set(String(configuracao.limiteExecucaoMb));
    this.limiteHistorico.set(String(configuracao.limiteHistoricoMb));
    this.maximoPorCenario.set(configuracao.retencao.maximoPorCenario === null ? '' : String(configuracao.retencao.maximoPorCenario));
    this.idadeMaxima.set(configuracao.retencao.idadeMaximaDias === null ? '' : String(configuracao.retencao.idadeMaximaDias));
    this.limiteVariacao.set(String(configuracao.limiteVariacao));
  }

  private async recarregar(): Promise<void> {
    try {
      this.registros.set(await this.ponte.listarHistorico());
    } catch {
      // Sem acesso ao banco, a lista fica como estava.
    }
  }
}
