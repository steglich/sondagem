import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LIMITE_PERFIL_MANUAL_MS } from '../../../../shared/cpu';
import { formatarBytes, formatarMs } from '../../../../shared/texto';
import type { EstadoExecucao, StatusResumido, VisaoSessao } from '../../../../shared/types';

const ESTADOS: Record<EstadoExecucao, string> = {
  ociosa: 'Aguardando',
  preparando: 'Preparando: abrindo a URL inicial',
  aquecendo: 'Aquecendo',
  executando: 'Executando',
  coletando: 'Coletando',
  concluida: 'Concluída',
  erro: 'Erro',
  cancelada: 'Cancelada',
};

const PERFIS_CPU: Record<NonNullable<StatusResumido['cpu']>, string> = {
  coletando: 'coletando',
  concluida: 'concluído',
  'limite-atingido': 'parado no limite',
  falhou: 'não coletado',
};

/** Análise em andamento: só o status resumido. Os registros detalhados aparecem depois do fim. */
@Component({
  selector: 'sd-sessao-ativa',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="titulo-sessao">
      <h2 id="titulo-sessao">{{ parando() ? 'Encerrando…' : 'Análise em andamento' }}</h2>
      <p class="url" data-testid="sessao-url">{{ url() }}</p>

      @if (execucao(); as e) {
        <p>
          Cenário <strong data-testid="execucao-cenario">{{ e.nome }}</strong
          >: a Sondagem está executando os passos. Não use a aba até terminar.
        </p>
        <dl aria-live="polite">
          <dt>Estado</dt>
          <dd data-testid="execucao-estado">{{ estado() }}</dd>
          <dt>Progresso</dt>
          <dd data-testid="execucao-progresso">{{ progresso() }}</dd>
        </dl>
      } @else {
        <p>Sessão manual: a Sondagem só observa. Use a página normalmente e clique em “Parar” ao terminar.</p>
      }

      @if (status(); as s) {
        <dl aria-live="polite">
          <dt>Long tasks</dt>
          <dd data-testid="status-long-tasks">{{ s.longTasks }}</dd>
          <dt>Pior long task</dt>
          <dd data-testid="status-pior-long-task">{{ s.piorLongTask === null ? '—' : ms(s.piorLongTask) }}</dd>
          <dt>Interações</dt>
          <dd data-testid="status-interacoes">{{ s.interacoes }}</dd>
          <dt>Carregamentos</dt>
          <dd data-testid="status-carregamentos">{{ s.carregamentos }}</dd>
          @if (s.errosPagina > 0) {
            <dt>Erros da página</dt>
            <dd data-testid="status-erros-pagina">{{ s.errosPagina }}</dd>
          }
          @if (s.heapUsado !== null) {
            <dt>Heap usado</dt>
            <dd data-testid="status-heap">{{ bytes(s.heapUsado) }}</dd>
          }
          @if (podeTirarSnapshot()) {
            <dt>Snapshots</dt>
            <dd data-testid="status-snapshots">{{ s.snapshots }}</dd>
          }
          @if (s.cpu; as cpu) {
            <dt>Perfil de CPU</dt>
            <dd data-testid="status-cpu">{{ perfisCpu[cpu] }}</dd>
          }
        </dl>
        @if (s.cpu === 'limite-atingido') {
          <p class="aviso" role="status" data-testid="status-cpu-limite">
            O perfil de CPU parou: atingiu o limite de {{ limitePerfil }}. As outras verificações continuam.
          </p>
        }
        @if (s.cpu === 'falhou') {
          <p class="aviso" role="status" data-testid="status-cpu-falhou">
            O perfil de CPU não está sendo coletado; o motivo aparece no resultado. As outras verificações continuam.
          </p>
        }
      }

      <div class="acoes">
        @if (!execucao()) {
          <button type="button" data-testid="parar" [disabled]="parando()" (click)="parar.emit()">Parar</button>
        }
        @if (podeTirarSnapshot()) {
          <button
            type="button"
            class="secundario"
            data-testid="tirar-snapshot"
            [disabled]="parando() || tirandoSnapshot()"
            (click)="tirarSnapshot.emit()"
          >
            {{ tirandoSnapshot() ? 'Tirando snapshot…' : 'Tirar snapshot' }}
          </button>
        }
        <button type="button" class="secundario" data-testid="cancelar" [disabled]="parando()" (click)="cancelar.emit()">
          Cancelar
        </button>
      </div>
    </section>
  `,
  styles: `
    .url {
      overflow-wrap: anywhere;
      opacity: 0.7;
    }
    dl {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 12px;
    }
    dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
  `,
})
export class SessaoAtiva {
  readonly url = input.required<string>();
  readonly status = input.required<StatusResumido | null>();
  /** Estado e progresso da execução de cenário; `null` em sessão manual. */
  readonly execucao = input<VisaoSessao['execucao']>(null);
  readonly parando = input(false);
  /** Sessão manual com "Memória": oferece o snapshot a pedido. */
  readonly podeTirarSnapshot = input(false);
  readonly tirandoSnapshot = input(false);

  readonly tirarSnapshot = output<void>();
  readonly parar = output<void>();
  readonly cancelar = output<void>();

  protected readonly ms = formatarMs;
  protected readonly bytes = formatarBytes;
  protected readonly perfisCpu = PERFIS_CPU;
  protected readonly limitePerfil = `${LIMITE_PERFIL_MANUAL_MS / 60_000} minutos`;
  protected readonly estado = computed(() => ESTADOS[this.execucao()?.estado ?? 'ociosa']);
  protected readonly progresso = computed(() => {
    const execucao = this.execucao();
    if (!execucao || execucao.iteracao === 0) return `0 de ${execucao?.totalIteracoes ?? 0} iterações`;
    return `iteração ${execucao.iteracao} de ${execucao.totalIteracoes}`;
  });
}
