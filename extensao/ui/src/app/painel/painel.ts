import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { Cenario } from '../../../../shared/cenario';
import { CONTEXTO_MANUAL, type FalhaDebugger as Falha, type RespostaComando, type Selecao, contextoDoCenario } from '../../../../shared/types';
import { avaliarUrl } from '../../../../shared/url';
import { VERIFICACOES } from '../../../../shared/verificacoes';
import { Cenarios } from '../cenarios/cenarios';
import { type AnaliseConfirmada, Confirmacao } from '../sessao/confirmacao';
import { FalhaDebugger } from '../sessao/falha-debugger';
import { type AbaAlvo, PonteExtensao } from '../sessao/ponte';
import { Resultado } from '../sessao/resultado';
import { ServicoSessao } from '../sessao/servico-sessao';
import { SessaoAtiva } from '../sessao/sessao-ativa';

interface DadosConfirmacao {
  aba: AbaAlvo | null;
  selecao: Selecao;
  bloqueio: string | null;
  /** Cenário escolhido na lista, com a última seleção usada nele. */
  cenario: Cenario | null;
  selecaoCenario: Selecao | null;
}

/**
 * Side panel. Nada começa ao abrir o painel: uma análise só inicia com o clique
 * em "Analisar" seguido da confirmação.
 */
@Component({
  selector: 'sd-painel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Cenarios, Confirmacao, FalhaDebugger, SessaoAtiva, Resultado],
  template: `
    <main>
      <h1>Sondagem</h1>

      @if (falhaDebugger(); as falha) {
        <sd-falha-debugger [falha]="falha" />
      } @else if (erro(); as mensagem) {
        <p class="aviso" role="alert" data-testid="erro">{{ mensagem }}</p>
      }

      @if (emAndamento()) {
        <sd-sessao-ativa
          [url]="visao().alvo?.url ?? ''"
          [status]="visao().status"
          [execucao]="visao().execucao"
          [parando]="visao().fase === 'parando' || encerrando()"
          [podeTirarSnapshot]="snapshotManual()"
          [tirandoSnapshot]="tirandoSnapshot()"
          (tirarSnapshot)="tirarSnapshot()"
          (parar)="parar()"
          (cancelar)="cancelar()"
        />
      } @else if (confirmacao(); as dados) {
        <sd-confirmacao
          [url]="dados.aba?.url"
          [verificacoes]="verificacoes"
          [selecaoInicial]="dados.selecao"
          [cenario]="dados.cenario"
          [selecaoCenario]="dados.selecaoCenario"
          [bloqueio]="dados.bloqueio"
          (confirmar)="confirmar($event)"
          (desistir)="confirmacao.set(null)"
        />
      } @else {
        <button type="button" data-testid="analisar" (click)="analisar()">Analisar</button>
        @if (visao().resultado; as resultado) {
          <sd-resultado [resultado]="resultado" />
        }
        <sd-cenarios />
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
  /** Só a sessão manual com "Memória" tira snapshot a pedido; em cenário, os passos decidem. */
  protected readonly snapshotManual = computed(() => this.visao().execucao === null && this.visao().selecao.includes('memoria'));
  protected readonly tirandoSnapshot = signal(false);
  protected readonly erro = signal<string | null>(null);
  protected readonly falhaDebugger = signal<Falha | null>(null);

  /** Abre a confirmação com a aba alvo, o cenário escolhido e a última seleção usada. Ainda não inicia nada. */
  protected async analisar(): Promise<void> {
    this.erro.set(null);
    this.falhaDebugger.set(null);
    const [aba, selecao, cenarios, nomeSelecionado] = await Promise.all([
      this.ponte.abaAlvo(),
      this.ponte.lerSelecao(CONTEXTO_MANUAL),
      this.ponte.listarCenarios(),
      this.ponte.lerCenarioSelecionado(),
    ]);
    const cenario = cenarios.find((c) => c.nome === nomeSelecionado) ?? null;
    const selecaoCenario = cenario ? await this.ponte.lerSelecao(contextoDoCenario(cenario.nome)) : null;
    const avaliacao = avaliarUrl(aba?.url);
    this.confirmacao.set({ aba, selecao, cenario, selecaoCenario, bloqueio: avaliacao.suportada ? null : avaliacao.motivo });
  }

  protected async confirmar(analise: AnaliseConfirmada): Promise<void> {
    const dados = this.confirmacao();
    const aba = dados?.aba;
    if (!dados || !aba) return;
    const cenario = analise.modo === 'cenario' ? dados.cenario : null;
    await this.ponte.salvarSelecao(cenario ? contextoDoCenario(cenario.nome) : CONTEXTO_MANUAL, analise.selecao);
    await this.executar(() =>
      this.sessao.iniciar(
        aba.id,
        analise.selecao,
        cenario ? { definicao: cenario, iteracoes: analise.iteracoes, versaoBuild: analise.versaoBuild ?? null } : undefined,
      ),
    );
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

  protected async tirarSnapshot(): Promise<void> {
    this.tirandoSnapshot.set(true);
    await this.executar(() => this.sessao.tirarSnapshot());
    this.tirandoSnapshot.set(false);
  }

  /** Abre a rota de relatório em uma aba própria. */
  protected abrirRelatorio(): void {
    this.ponte.abrirRelatorio();
  }

  private async executar(comando: () => Promise<RespostaComando>): Promise<void> {
    try {
      const resposta = await comando();
      this.erro.set(resposta.ok ? null : (resposta.mensagem ?? 'O comando foi recusado.'));
      this.falhaDebugger.set(resposta.ok ? null : (resposta.falhaDebugger ?? null));
    } catch (falha) {
      this.erro.set(falha instanceof Error ? falha.message : String(falha));
    }
  }
}
