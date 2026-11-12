import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { Cenario } from '../../../../shared/cenario';
import type { PerfilThrottling } from '../../../../shared/condicoes';
import {
  CONTEXTO_MANUAL,
  type ExtensaoAtiva,
  type FalhaDebugger as Falha,
  type RespostaComando,
  type ResultadoSessao,
  type Selecao,
  contextoDoCenario,
} from '../../../../shared/types';
import { avaliarUrl } from '../../../../shared/url';
import { VERIFICACOES } from '../../../../shared/verificacoes';
import { Cenarios } from '../cenarios/cenarios';
import { Historico } from '../historico/historico';
import { Perfis } from '../perfis/perfis';
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
  perfis: PerfilThrottling[];
  extensoes: ExtensaoAtiva[];
}

/**
 * Side panel. Nada começa ao abrir o painel: uma análise só inicia com o clique
 * em "Analisar" seguido da confirmação.
 */
@Component({
  selector: 'sd-painel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Cenarios, Confirmacao, FalhaDebugger, Historico, Perfis, SessaoAtiva, Resultado],
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
          [perfis]="dados.perfis"
          [extensoes]="dados.extensoes"
          (confirmar)="confirmar($event)"
          (desistir)="confirmacao.set(null)"
        />
      } @else {
        <button type="button" data-testid="analisar" (click)="analisar()">Analisar</button>
        @if (resultadoExibido(); as resultado) {
          @if (resultadoAberto()) {
            <p class="nota" data-testid="resultado-do-historico">
              Resultado aberto do histórico.
              <button type="button" class="secundario" data-testid="fechar-resultado" (click)="resultadoAberto.set(null)">
                Voltar ao último resultado
              </button>
            </p>
          }
          <sd-resultado [resultado]="resultado" />
        }
        <sd-cenarios />
        <sd-perfis />
        <sd-historico [versao]="visao().resultado?.id ?? null" [aberto]="resultadoExibido()?.id ?? null" (abrir)="abrirDoHistorico($event)" (removida)="aoRemover($event)" />
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
  /** Resultado aberto a partir do histórico; `null` mostra o da última análise. */
  protected readonly resultadoAberto = signal<ResultadoSessao | null>(null);
  protected readonly resultadoExibido = computed(() => this.resultadoAberto() ?? this.visao().resultado);

  /** Abre a confirmação com a aba alvo, o cenário escolhido e a última seleção usada. Ainda não inicia nada. */
  protected async analisar(): Promise<void> {
    this.erro.set(null);
    this.falhaDebugger.set(null);
    const [aba, selecao, cenarios, nomeSelecionado, perfis, extensoes] = await Promise.all([
      this.ponte.abaAlvo(),
      this.ponte.lerSelecao(CONTEXTO_MANUAL),
      this.ponte.listarCenarios(),
      this.ponte.lerCenarioSelecionado(),
      this.ponte.listarPerfis(),
      // A cada "Analisar": as extensões ativas podem ter mudado desde a última vez.
      this.ponte.outrasExtensoes(),
    ]);
    const cenario = cenarios.find((c) => c.nome === nomeSelecionado) ?? null;
    const selecaoCenario = cenario ? await this.ponte.lerSelecao(contextoDoCenario(cenario.nome)) : null;
    const avaliacao = avaliarUrl(aba?.url);
    this.confirmacao.set({
      aba,
      selecao,
      cenario,
      selecaoCenario,
      perfis,
      extensoes,
      bloqueio: avaliacao.suportada ? null : avaliacao.motivo,
    });
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
        cenario
          ? {
              definicao: cenario,
              iteracoes: analise.iteracoes,
              versaoBuild: analise.versaoBuild ?? null,
              ...(analise.storageConfirmado ? { storageConfirmado: analise.storageConfirmado } : {}),
            }
          : undefined,
        analise.throttling,
      ),
    );
    this.resultadoAberto.set(null);
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

  /** Mostra no painel o resultado de uma execução do histórico. */
  protected async abrirDoHistorico(id: string): Promise<void> {
    const resultado = await this.ponte.lerResultado(id);
    this.resultadoAberto.set(resultado && resultado.id !== this.visao().resultado?.id ? resultado : null);
  }

  /** A execução aberta saiu do histórico: o painel volta ao último resultado. */
  protected aoRemover(id: string): void {
    if (this.resultadoAberto()?.id === id) this.resultadoAberto.set(null);
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
