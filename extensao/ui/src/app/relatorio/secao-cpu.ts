import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatarMs } from '../../../../shared/texto';
import type { DadosColetados, FuncaoCpu } from '../../../../shared/types';
import { type ColunaDaLista, ListaVirtual } from './lista-virtual';

/** Perfil de CPU: o tempo por categoria e a lista de funções por tempo próprio. */
@Component({
  selector: 'sd-secao-cpu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ListaVirtual],
  template: `
    @if (cpu(); as coleta) {
      @if (coleta.estado === 'falhou') {
        <p class="aviso" role="alert" data-testid="cpu-falha">O perfil de CPU não foi coletado: {{ coleta.falha ?? 'motivo não informado' }}</p>
      }
      @if (coleta.incompleto) {
        <p class="aviso" data-testid="cpu-incompleto">O navegador perdeu parte dos dados do perfil: os tempos abaixo estão subestimados.</p>
      }
      @if (coleta.limiteAtingido) {
        <p class="nota" data-testid="cpu-limite">O perfil parou ao atingir a duração máxima da sessão manual.</p>
      }
      @if (coleta.resumo; as resumo) {
        <p data-testid="cpu-resumo">
          {{ ms(resumo.tempoAtivo) }} de processamento em {{ ms(resumo.tempoAmostrado) }} amostrados ({{ resumo.amostras }} amostras).
        </p>
        <table data-testid="cpu-categorias">
          <caption>
            Fora das funções da página
          </caption>
          <tbody>
            @for (categoria of categorias(); track categoria.nome) {
              <tr>
                <th scope="row">{{ categoria.nome }}</th>
                <td>{{ ms(categoria.tempo) }}</td>
              </tr>
            }
          </tbody>
        </table>

        <h3>Funções</h3>
        @if (resumo.funcoes.length === 0) {
          <p class="nota" data-testid="cpu-sem-funcoes">{{ truncada() ? 'A lista de funções foi removida para caber no limite de armazenamento.' : 'Nenhuma função da página nas amostras.' }}</p>
        } @else {
          <sd-lista-virtual data-testid="lista-funcoes" rotulo="Funções por tempo próprio" [itens]="resumo.funcoes" [colunas]="colunas" />
          @if (resumo.outras; as outras) {
            <p class="nota" data-testid="cpu-outras">
              Mais {{ outras.quantidade }} funções fora da lista: {{ ms(outras.tempoProprio) }} ({{ outras.percentual.toFixed(1) }}%).
            </p>
          }
        }
      }
    } @else {
      <p class="nota" data-testid="cpu-sem-dados">O perfil de CPU não foi guardado.</p>
    }
  `,
  styles: `
    table {
      margin-bottom: 12px;
      border-collapse: collapse;
    }
    caption {
      text-align: left;
      font-weight: 600;
    }
    th,
    td {
      padding: 2px 16px 2px 0;
      text-align: left;
      font-weight: normal;
    }
    td {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .nota {
      opacity: 0.7;
    }
  `,
})
export class SecaoCpu {
  readonly dados = input.required<DadosColetados>();
  /** `true` se a lista de funções foi removida pelo limite de armazenamento. */
  readonly truncada = input(false);

  protected readonly ms = formatarMs;
  protected readonly cpu = computed(() => this.dados().cpu);
  protected readonly categorias = computed(() => {
    const categorias = this.cpu()?.resumo?.categorias;
    if (!categorias) return [];
    return [
      { nome: 'Ocioso', tempo: categorias.ocioso },
      { nome: 'Coleta de lixo', tempo: categorias.coletaDeLixo },
      { nome: 'Motor do navegador', tempo: categorias.programa },
      { nome: 'Extensões', tempo: categorias.extensoes },
    ];
  });

  protected readonly colunas: ColunaDaLista<FuncaoCpu>[] = [
    { titulo: 'Função', largura: 'minmax(8rem, 1fr)', texto: (f) => f.nome },
    { titulo: 'Origem', largura: 'minmax(0, 2fr)', texto: (f) => (f.arquivo === null ? '(nativa ou avaliada)' : `${f.arquivo}${f.linha === null ? '' : `:${f.linha}`}`) },
    { titulo: 'Próprio', largura: '6rem', numerica: true, texto: (f) => formatarMs(f.tempoProprio) },
    { titulo: 'Total', largura: '6rem', numerica: true, texto: (f) => formatarMs(f.tempoTotal) },
    { titulo: '%', largura: '4rem', numerica: true, texto: (f) => f.percentual.toFixed(1) },
  ];
}
