import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RegistroExecucao } from '../../../../shared/historico';
import { formatarBytes, formatarVariacaoBytes } from '../../../../shared/texto';
import type { DadosColetados, MetricaMemoria, VariacaoConstrutor } from '../../../../shared/types';
import { CLASSIFICACOES, comSinal } from './formato';
import { Grafico, type SerieDoGrafico } from './grafico';
import { type ColunaDaLista, ListaVirtual } from './lista-virtual';

interface GraficoDeMemoria {
  metrica: MetricaMemoria;
  titulo: string;
  rotuloX: string;
  x: number[];
  series: SerieDoGrafico[];
  formatar: (valor: number) => string;
}

const TITULOS: Record<MetricaMemoria, string> = { heap_usado: 'Heap usado', nos_dom: 'Nós DOM', listeners: 'Listeners' };
const CAMPOS = { heap_usado: 'heapUsado', nos_dom: 'nosDom', listeners: 'listeners' } as const;
const ORDEM: readonly MetricaMemoria[] = ['heap_usado', 'nos_dom', 'listeners'];
const inteiro = (valor: number): string => String(Math.round(valor));

const SITUACOES: Record<VariacaoConstrutor['situacao'], string> = { ambos: '', novo: 'só no último censo', removido: 'só no primeiro censo' };

/**
 * Memória: a classificação de vazamento, os gráficos de heap, nós DOM e listeners
 * por iteração e os construtores que mais cresceram entre o primeiro e o último censo.
 */
@Component({
  selector: 'sd-secao-memoria',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Grafico, ListaVirtual],
  template: `
    @if (classificacao(); as texto) {
      <p class="classificacao" data-testid="memoria-classificacao" [class.vazamento]="vazamento()">{{ texto }}</p>
    }
    @if (variacaoDoHeap(); as heap) {
      <p data-testid="memoria-variacao-heap">Heap usado: de {{ heap.antes }} para {{ heap.depois }} ({{ heap.variacao }}).</p>
    }

    @for (grafico of graficos(); track grafico.metrica) {
      <sd-grafico
        [attr.data-metrica]="grafico.metrica"
        [titulo]="grafico.titulo"
        [rotuloX]="grafico.rotuloX"
        [x]="grafico.x"
        [series]="grafico.series"
        [formatar]="grafico.formatar"
      />
    } @empty {
      <p class="nota" data-testid="memoria-sem-grafico">Sem medições de memória para o gráfico.</p>
    }

    @if (dom(); as variacao) {
      <h3>DOM e listeners</h3>
      <ul data-testid="memoria-dom">
        @if (variacao.nosDesanexados; as nos) {
          <li>Nós DOM desanexados: de {{ nos.antes }} para {{ nos.depois }} ({{ sinal(nos.variacao) }}).</li>
        }
        @if (variacao.listeners; as listeners) {
          <li>Listeners: de {{ listeners.antes }} para {{ listeners.depois }} ({{ sinal(listeners.variacao) }}).</li>
        }
      </ul>
    }

    @if (comparacao(); as censos) {
      <h3>Construtores que mais cresceram</h3>
      <p class="nota">
        Do censo “{{ censos.de }}” para o censo “{{ censos.para }}”, do que mais ganhou objetos para o que mais perdeu. O navegador não informa
        a extensões o tamanho por construtor: a variação de tamanho é a do heap como um todo, acima.
      </p>
      @if (truncados()) {
        <p class="nota" data-testid="construtores-truncados">As listas de cada snapshot foram removidas para caber no limite; a comparação abaixo foi calculada antes.</p>
      }
      <sd-lista-virtual data-testid="lista-construtores" rotulo="Construtores que mais cresceram" [itens]="censos.construtores" [colunas]="colunas" />
    }
  `,
  styles: `
    .classificacao {
      font-weight: 600;
    }
    .vazamento {
      color: #c0392b;
    }
    .nota {
      opacity: 0.7;
    }
    ul {
      margin: 0 0 12px;
      padding-left: 20px;
    }
  `,
})
export class SecaoMemoria {
  readonly registro = input.required<RegistroExecucao>();
  readonly dados = input.required<DadosColetados>();

  private readonly memoria = computed(() => this.registro().resumo?.memoria ?? null);
  protected readonly comparacao = computed(() => this.memoria()?.comparacao ?? null);
  protected readonly dom = computed(() => this.memoria()?.domListeners ?? null);
  protected readonly vazamento = computed(() => this.memoria()?.classificacao === 'vazamento-provavel');
  protected readonly classificacao = computed(() => {
    const classificacao = this.memoria()?.classificacao;
    return classificacao ? CLASSIFICACOES[classificacao] : null;
  });
  protected readonly truncados = computed(() => this.registro().truncado.includes('snapshots'));

  /**
   * Em cenário, um ponto por iteração (as séries já estão no resumo). Em sessão
   * manual não há iterações: o eixo é o tempo, com uma medição a cada 5 segundos.
   */
  protected readonly graficos = computed((): GraficoDeMemoria[] => {
    const series = this.memoria()?.series ?? [];
    const medicoes = this.dados().medicoes;
    const inicio = this.registro().inicio;
    return ORDEM.flatMap((metrica): GraficoDeMemoria[] => {
      const formatar = metrica === 'heap_usado' ? formatarBytes : inteiro;
      const pontos = series.find((s) => s.metrica === metrica)?.pontos ?? [];
      if (pontos.length > 0) {
        return [
          {
            metrica,
            titulo: `${TITULOS[metrica]} por iteração`,
            rotuloX: 'Iteração',
            x: pontos.map((p) => p.iteracao),
            series: [{ nome: TITULOS[metrica], valores: pontos.map((p) => p.valor) }],
            formatar,
          },
        ];
      }
      const campo = CAMPOS[metrica];
      const medidas = medicoes.filter((m) => m[campo] !== null);
      if (this.registro().tipo !== 'sessao-manual' || medidas.length === 0) return [];
      return [
        {
          metrica,
          titulo: `${TITULOS[metrica]} ao longo da sessão`,
          rotuloX: 'Segundos desde o início',
          x: medidas.map((m) => Math.round((m.instante - inicio) / 100) / 10),
          series: [{ nome: TITULOS[metrica], valores: medidas.map((m) => m[campo]) }],
          formatar,
        },
      ];
    });
  });

  protected readonly variacaoDoHeap = computed(() => {
    const pontos = this.memoria()?.series.find((s) => s.metrica === 'heap_usado')?.pontos ?? [];
    const primeiro = pontos[0];
    const ultimo = pontos.at(-1);
    if (!primeiro || !ultimo || pontos.length < 2) return null;
    return { antes: formatarBytes(primeiro.valor), depois: formatarBytes(ultimo.valor), variacao: formatarVariacaoBytes(ultimo.valor - primeiro.valor) };
  });

  protected readonly colunas: ColunaDaLista<VariacaoConstrutor>[] = [
    { titulo: 'Construtor', largura: 'minmax(0, 1fr)', texto: (c) => c.nome },
    { titulo: 'Antes', largura: '6rem', numerica: true, texto: (c) => String(c.contagem.antes) },
    { titulo: 'Depois', largura: '6rem', numerica: true, texto: (c) => String(c.contagem.depois) },
    { titulo: 'Variação', largura: '6rem', numerica: true, texto: (c) => comSinal(String(c.contagem.variacao), c.contagem.variacao) },
    { titulo: 'Observação', largura: '11rem', texto: (c) => SITUACOES[c.situacao] },
  ];

  protected sinal(valor: number): string {
    return comSinal(String(valor), valor);
  }
}
