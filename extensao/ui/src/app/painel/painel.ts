import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CONTEXTO_MANUAL, type Selecao } from '../../../../shared/types';
import { avaliarUrl } from '../../../../shared/url';
import { VERIFICACOES } from '../../../../shared/verificacoes';
import { Confirmacao } from '../sessao/confirmacao';
import { type AbaAlvo, PonteExtensao } from '../sessao/ponte';
import { Resultado } from '../sessao/resultado';
import { ServicoSessao } from '../sessao/servico-sessao';
import { SessaoAtiva } from '../sessao/sessao-ativa';

interface DadosConfirmacao {
  aba: AbaAlvo | null;
  selecao: Selecao;
  bloqueio: string | null;
}

/**
 * Side panel. Nada começa ao abrir o painel: uma análise só inicia com o clique
 * em "Analisar" seguido da confirmação.
 */
@Component({
  selector: 'sd-painel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Confirmacao, SessaoAtiva, Resultado],
  template: `
    <main>
      <h1>Sondagem</h1>

      @if (erro(); as mensagem) {
        <p class="aviso" role="alert" data-testid="erro">{{ mensagem }}</p>
      }

      @if (emAndamento()) {
        <sd-sessao-ativa
          [url]="visao().alvo?.url ?? ''"
          [status]="visao().status"
          [parando]="visao().fase === 'parando' || encerrando()"
          (parar)="parar()"
          (cancelar)="cancelar()"
        />
      } @else if (confirmacao(); as dados) {
        <sd-confirmacao
          [url]="dados.aba?.url"
          modo="Sessão manual"
          [verificacoes]="verificacoes"
          [selecaoInicial]="dados.selecao"
          [bloqueio]="dados.bloqueio"
          (confirmar)="confirmar($event)"
          (desistir)="confirmacao.set(null)"
        />
      } @else {
        <button type="button" data-testid="analisar" (click)="analisar()">Analisar</button>
        @if (visao().resultado; as resultado) {
          <sd-resultado [resultado]="resultado" />
        }
      }

      <footer>
        <button type="button" class="secundario" data-testid="abrir-relatorio" (click)="abrirRelatorio()">
          Abrir relatório
        </button>
      </footer>
    </main>
  `,
  styles: `
    main {
      padding: 12px 16px;
    }
    footer {
      margin-top: 24px;
    }
  `,
})
export class Painel {
  private readonly ponte = inject(PonteExtensao);
  private readonly sessao = inject(ServicoSessao);

  protected readonly verificacoes = VERIFICACOES;
  protected readonly visao = this.sessao.visao;
  protected readonly emAndamento = computed(() => this.visao().fase !== 'ociosa');
  protected readonly confirmacao = signal<DadosConfirmacao | null>(null);
  protected readonly encerrando = signal(false);
  protected readonly erro = signal<string | null>(null);

  /** Abre a confirmação com a aba alvo e a última seleção usada. Ainda não inicia nada. */
  protected async analisar(): Promise<void> {
    this.erro.set(null);
    const [aba, selecao] = await Promise.all([this.ponte.abaAlvo(), this.ponte.lerSelecao(CONTEXTO_MANUAL)]);
    const avaliacao = avaliarUrl(aba?.url);
    this.confirmacao.set({ aba, selecao, bloqueio: avaliacao.suportada ? null : avaliacao.motivo });
  }

  protected async confirmar(selecao: Selecao): Promise<void> {
    const aba = this.confirmacao()?.aba;
    if (!aba) return;
    await this.ponte.salvarSelecao(CONTEXTO_MANUAL, selecao);
    await this.executar(() => this.sessao.iniciar(aba.id, selecao));
    this.confirmacao.set(null);
  }

  protected async parar(): Promise<void> {
    this.encerrando.set(true);
    await this.executar(() => this.sessao.parar());
    this.encerrando.set(false);
  }

  protected async cancelar(): Promise<void> {
    this.encerrando.set(true);
    await this.executar(() => this.sessao.cancelar());
    this.encerrando.set(false);
  }

  /** Abre a rota de relatório em uma aba própria. */
  protected abrirRelatorio(): void {
    this.ponte.abrirRelatorio();
  }

  private async executar(comando: () => Promise<{ ok: boolean; mensagem?: string }>): Promise<void> {
    try {
      const resposta = await comando();
      this.erro.set(resposta.ok ? null : (resposta.mensagem ?? 'O comando foi recusado.'));
    } catch (falha) {
      this.erro.set(falha instanceof Error ? falha.message : String(falha));
    }
  }
}
