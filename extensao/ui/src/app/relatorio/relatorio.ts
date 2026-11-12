import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { comparaveisCom } from '../../../../shared/comparacao';
import { type RegistroExecucao, podeSerReferencia } from '../../../../shared/historico';
import { type IdSecao, METRICAS_DE_ITERACAO, NOMES_DAS_SECOES, formatoDesconhecido, secoesDoRelatorio } from '../../../../shared/relatorio';
import { formatarMs } from '../../../../shared/texto';
import type { DadosColetados } from '../../../../shared/types';
import { PonteExtensao } from '../sessao/ponte';
import { Cabecalho } from './cabecalho';
import { Exportar } from './exportar';
import { LISTAS, estadoExibido, rotuloDaExecucao } from './formato';
import { LinhaDeBase } from './linha-de-base';
import { Regressao } from './regressao';
import { SecaoCarregamento } from './secao-carregamento';
import { SecaoCpu } from './secao-cpu';
import { SecaoErros } from './secao-erros';
import { SecaoMemoria } from './secao-memoria';
import { SecaoProcessamento } from './secao-processamento';

type Carga = { fase: 'carregando' } | { fase: 'ausente' } | { fase: 'pronto'; registro: RegistroExecucao };

/**
 * Página de relatório de uma execução do histórico (`#/relatorio/:id`); sem `id`,
 * lista as execuções.
 *
 * A leitura é em duas etapas. A abertura lê só o registro leve e desenha o
 * cabeçalho e as estatísticas. As listas detalhadas são lidas quando a primeira
 * seção é aberta, e o código de cada seção (gráficos e rolagem virtual) só é
 * carregado nesse momento, pelos blocos `@defer`.
 */
@Component({
  selector: 'sd-relatorio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Cabecalho, Exportar, LinhaDeBase, Regressao, RouterLink, SecaoCarregamento, SecaoCpu, SecaoErros, SecaoMemoria, SecaoProcessamento],
  template: `
    <main>
      <h1>Relatório</h1>

      @if (!id()) {
        @if (historico().length === 0) {
          <p data-testid="relatorio-vazio">Nenhuma análise ainda.</p>
        } @else {
          <ul data-testid="relatorio-lista">
            @for (execucao of historico(); track execucao.id) {
              <li>
                @if (execucao.estado === 'em-andamento') {
                  {{ rotulo(execucao) }} — em andamento
                } @else {
                  <a [routerLink]="['/relatorio', execucao.id]" [attr.data-testid]="'relatorio-de-' + execucao.id">{{ rotulo(execucao) }}</a>
                  — {{ estado(execucao) }}
                }
              </li>
            }
          </ul>
        }
      } @else {
        @let atual = carga();
        @if (atual.fase === 'carregando') {
          <p data-testid="relatorio-carregando">Carregando…</p>
        } @else if (atual.fase === 'ausente') {
          <p class="aviso" role="alert" data-testid="relatorio-ausente">Esta execução não está no histórico. Ela pode ter sido removida.</p>
          <a routerLink="/relatorio">Ver as execuções guardadas</a>
        } @else {
          @let registro = atual.registro;
          <sd-cabecalho [registro]="registro" />

          @if (formatoNovo()) {
            <p class="aviso" role="alert" data-testid="relatorio-formato-desconhecido">
              Esta execução foi gravada por uma versão mais nova da extensão (formato {{ registro.versaoFormato }}). Partes do relatório
              podem estar incompletas ou erradas.
            </p>
          }

          @if (registro.estado === 'em-andamento') {
            <p class="aviso" data-testid="relatorio-em-andamento">A análise ainda está em andamento. O relatório fica disponível quando ela terminar.</p>
          } @else {
            @if (truncadas(); as listas) {
              <p class="aviso" data-testid="relatorio-truncado">Para caber no limite de armazenamento, estas listas não foram guardadas: {{ listas }}.</p>
            }

            @if (podeComparar()) {
              <sd-regressao [id]="registro.id" [versao]="versaoDaLinha()" />
              <sd-linha-de-base [registro]="registro" (mudou)="versaoDaLinha.set(versaoDaLinha() + 1)" />
              <section aria-labelledby="titulo-comparar">
                <h3 id="titulo-comparar">Comparar</h3>
                @if (comparaveis().length === 0) {
                  <p class="nota" data-testid="sem-outra-execucao">Não há outra execução completa deste cenário para comparar.</p>
                } @else {
                  <div class="acoes">
                    <label>
                      Comparar com
                      <select data-testid="comparar-com" (change)="outra.set($any($event.target).value)">
                        @for (execucao of comparaveis(); track execucao.id) {
                          <option [value]="execucao.id" [selected]="execucao.id === outraEscolhida()">{{ rotulo(execucao) }}</option>
                        }
                      </select>
                    </label>
                    <button type="button" class="secundario" data-testid="comparar" (click)="comparar()">Comparar</button>
                  </div>
                }
              </section>
            } @else {
              <p class="nota" data-testid="sem-comparacao">{{ motivoSemComparacao() }}</p>
            }

            <sd-exportar [registro]="registro" />

            <section aria-labelledby="titulo-estatisticas">
              <h2 id="titulo-estatisticas">Estatísticas</h2>
              @if (estatisticas().length === 0) {
                <p class="nota" data-testid="sem-estatisticas">{{ motivoSemEstatisticas() }}</p>
              } @else {
                <p class="nota">Entre as {{ registro.resumo?.cenario?.iteracoesCompletas }} iterações completas.</p>
                <table data-testid="estatisticas">
                  <thead>
                    <tr>
                      <th scope="col">Métrica</th>
                      <th scope="col">Mediana</th>
                      <th scope="col">p75</th>
                      <th scope="col">p95</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (estatistica of estatisticas(); track estatistica.id) {
                      <tr data-testid="estatistica" [attr.data-metrica]="estatistica.id">
                        <th scope="row">{{ estatistica.nome }}</th>
                        <td>{{ estatistica.mediana }}</td>
                        <td>{{ estatistica.p75 }}</td>
                        <td>{{ estatistica.p95 }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            </section>

            @if (secoes().length > 0) {
              <p>
                <button type="button" class="secundario" data-testid="abrir-secoes" (click)="abrirTodas()">Abrir todas as seções</button>
              </p>
            }
            @for (secao of secoes(); track secao) {
              <details [attr.data-testid]="'secao-' + secao" [open]="abertas().has(secao)" (toggle)="alternar(secao, $any($event.target).open)">
                <summary>{{ nomes[secao] }}</summary>
                @if (abertas().has(secao)) {
                  @if (falhaNosDetalhes(); as mensagem) {
                    <p class="aviso" role="alert" data-testid="detalhes-falha">{{ mensagem }}</p>
                  } @else if (detalhes(); as dados) {
                    @switch (secao) {
                      @case ('processamento') {
                        @defer (on immediate) {
                          <sd-secao-processamento [registro]="registro" [dados]="dados" />
                        } @placeholder {
                          <p>Carregando…</p>
                        }
                      }
                      @case ('carregamento') {
                        @defer (on immediate) {
                          <sd-secao-carregamento [registro]="registro" [dados]="dados" />
                        } @placeholder {
                          <p>Carregando…</p>
                        }
                      }
                      @case ('memoria') {
                        @defer (on immediate) {
                          <sd-secao-memoria [registro]="registro" [dados]="dados" />
                        } @placeholder {
                          <p>Carregando…</p>
                        }
                      }
                      @case ('cpu') {
                        @defer (on immediate) {
                          <sd-secao-cpu [dados]="dados" [truncada]="registro.truncado.includes('funcoesCpu')" />
                        } @placeholder {
                          <p>Carregando…</p>
                        }
                      }
                      @case ('erros') {
                        @defer (on immediate) {
                          <sd-secao-erros [registro]="registro" [dados]="dados" />
                        } @placeholder {
                          <p>Carregando…</p>
                        }
                      }
                    }
                  } @else {
                    <p data-testid="detalhes-carregando">Carregando…</p>
                  }
                }
              </details>
            } @empty {
              <p class="nota" data-testid="sem-secoes">{{ motivoSemSecoes() }}</p>
            }
          }
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
    section {
      margin: 16px 0;
    }
    details {
      margin: 8px 0;
      padding: 8px 12px;
      border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
      border-radius: 6px;
    }
    summary {
      font-weight: 600;
      cursor: pointer;
    }
    details[open] > summary {
      margin-bottom: 12px;
    }
    table {
      border-collapse: collapse;
    }
    th,
    td {
      padding: 2px 24px 2px 0;
      text-align: left;
      font-weight: normal;
    }
    thead th {
      font-weight: 600;
    }
    td {
      font-variant-numeric: tabular-nums;
    }
    select {
      font: inherit;
    }
    .acoes {
      align-items: center;
    }
    .nota {
      opacity: 0.7;
    }
  `,
})
export class Relatorio {
  private readonly ponte = inject(PonteExtensao);
  private readonly router = inject(Router);

  /** Parâmetro `:id` da rota. */
  readonly id = input<string>();

  protected readonly nomes = NOMES_DAS_SECOES;
  protected readonly rotulo = rotuloDaExecucao;
  protected readonly estado = estadoExibido;

  protected readonly carga = signal<Carga>({ fase: 'carregando' });
  protected readonly historico = signal<RegistroExecucao[]>([]);
  /** As listas detalhadas; `null` até a primeira seção ser aberta. */
  protected readonly detalhes = signal<DadosColetados | null>(null);
  protected readonly falhaNosDetalhes = signal<string | null>(null);
  protected readonly abertas = signal<ReadonlySet<IdSecao>>(new Set());
  protected readonly versaoDaLinha = signal(0);
  protected readonly outra = signal<string | null>(null);
  private detalhesPedidos = false;

  private readonly registro = computed(() => {
    const carga = this.carga();
    return carga.fase === 'pronto' ? carga.registro : null;
  });
  protected readonly secoes = computed(() => {
    const registro = this.registro();
    return registro ? secoesDoRelatorio(registro) : [];
  });
  protected readonly formatoNovo = computed(() => {
    const registro = this.registro();
    return registro !== null && formatoDesconhecido(registro);
  });
  protected readonly podeComparar = computed(() => {
    const registro = this.registro();
    return registro !== null && podeSerReferencia(registro);
  });
  protected readonly comparaveis = computed(() => {
    const registro = this.registro();
    return registro ? comparaveisCom(registro, this.historico()) : [];
  });
  /** Sem escolha feita, vale a execução mais recente das comparáveis. */
  protected readonly outraEscolhida = computed(() => {
    const comparaveis = this.comparaveis();
    return comparaveis.find((r) => r.id === this.outra())?.id ?? comparaveis[0]?.id ?? null;
  });
  protected readonly truncadas = computed(() => {
    const listas = this.registro()?.truncado ?? [];
    return listas.length === 0 ? null : listas.map((lista) => LISTAS[lista]).join(', ');
  });
  protected readonly estatisticas = computed(() => {
    const valor = (v: number | null): string => (v === null ? 'sem dado' : formatarMs(v));
    return (this.registro()?.resumo?.cenario?.estatisticas ?? []).map((e) => ({
      id: e.id,
      nome: METRICAS_DE_ITERACAO[e.id].nome,
      mediana: valor(e.mediana),
      p75: valor(e.p75),
      p95: valor(e.p95),
    }));
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.carregar(id));
    });
  }

  protected motivoSemComparacao(): string {
    const registro = this.registro();
    if (registro?.tipo === 'sessao-manual') {
      return 'Sessão manual: não pode ser linha de base nem entrar em comparação, porque não tem iterações comparáveis.';
    }
    return 'Resultado parcial: não pode ser linha de base nem entrar em comparação. Só uma execução de cenário que terminou bem serve de referência.';
  }

  protected motivoSemEstatisticas(): string {
    const registro = this.registro();
    if (registro?.tipo === 'sessao-manual') return 'Sessão manual: não há iterações nem estatísticas por iteração.';
    if (registro?.resumo?.cenario?.falhaDeSessao) return 'A aplicação pediu o login durante a execução: nenhuma estatística é apresentada.';
    return 'Sem estatísticas: as medições desta execução foram descartadas.';
  }

  protected motivoSemSecoes(): string {
    return this.registro()?.estado === 'cancelada'
      ? 'A análise foi cancelada: as medições foram descartadas.'
      : 'Nenhuma verificação com seção própria rodou nesta análise.';
  }

  protected alternar(secao: IdSecao, aberta: boolean): void {
    if (this.abertas().has(secao) === aberta) return;
    const abertas = new Set(this.abertas());
    if (aberta) abertas.add(secao);
    else abertas.delete(secao);
    this.abertas.set(abertas);
    if (aberta) void this.carregarDetalhes();
  }

  protected abrirTodas(): void {
    this.abertas.set(new Set(this.secoes()));
    void this.carregarDetalhes();
  }

  /** A execução mais antiga fica como A, a referência da comparação. */
  protected comparar(): void {
    const registro = this.registro();
    const outra = this.comparaveis().find((r) => r.id === this.outraEscolhida());
    if (!registro || !outra) return;
    const [a, b] = outra.inicio <= registro.inicio ? [outra, registro] : [registro, outra];
    void this.router.navigate(['/relatorio/comparar', a.id, b.id]);
  }

  /** Primeira etapa: só o registro leve (e a lista leve do histórico, para a comparação). */
  private async carregar(id: string | undefined): Promise<void> {
    this.carga.set({ fase: 'carregando' });
    this.detalhes.set(null);
    this.falhaNosDetalhes.set(null);
    this.detalhesPedidos = false;
    this.abertas.set(new Set());
    this.outra.set(null);
    try {
      const [registro, historico] = await Promise.all([id ? this.ponte.lerRegistro(id) : null, this.ponte.listarHistorico()]);
      if (this.id() !== id) return;
      this.historico.set(historico);
      this.carga.set(registro ? { fase: 'pronto', registro } : { fase: 'ausente' });
    } catch {
      if (this.id() === id) this.carga.set({ fase: 'ausente' });
    }
  }

  /** Segunda etapa: as listas detalhadas, uma vez, quando a primeira seção é aberta. */
  private async carregarDetalhes(): Promise<void> {
    const id = this.id();
    if (!id || this.detalhesPedidos) return;
    this.detalhesPedidos = true;
    try {
      const dados = await this.ponte.lerDetalhes(id);
      if (this.id() !== id) return;
      if (dados) this.detalhes.set(dados);
      else this.falhaNosDetalhes.set('Os detalhes desta execução não estão mais no histórico.');
    } catch (falha) {
      if (this.id() === id) this.falhaNosDetalhes.set(`Não foi possível ler os detalhes: ${falha instanceof Error ? falha.message : String(falha)}`);
    }
  }
}
