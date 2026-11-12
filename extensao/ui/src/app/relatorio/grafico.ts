import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  ViewEncapsulation,
  afterNextRender,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import type uPlot from 'uplot';

export interface SerieDoGrafico {
  nome: string;
  /** Um valor por ponto do eixo X; `null` deixa um buraco na linha. */
  valores: readonly (number | null)[];
}

/** O que o componente usa do gráfico criado. */
export interface GraficoCriado {
  setData(dados: uPlot.AlignedData): void;
  setSize(tamanho: { width: number; height: number }): void;
  destroy(): void;
}

export type CriadorDeGrafico = (opcoes: uPlot.Options, dados: uPlot.AlignedData, alvo: HTMLElement) => GraficoCriado | Promise<GraficoCriado>;

/**
 * Quem cria o gráfico. O uPlot só é carregado aqui, quando o primeiro gráfico é
 * criado. Nos testes de componente o criador é trocado: o jsdom não tem canvas.
 */
export const CRIADOR_DE_GRAFICO = new InjectionToken<CriadorDeGrafico>('CRIADOR_DE_GRAFICO', {
  providedIn: 'root',
  factory: () => async (opcoes, dados, alvo) => new (await import('uplot')).default(opcoes, dados, alvo),
});

const CORES = ['#1a56c4', '#c77700', '#2e8540', '#a23b72'];
const ALTURA = 220;
const LARGURA_PADRAO = 640;

/**
 * Gráfico de linhas sobre uPlot. As séries chegam por signal. O gráfico só é
 * criado quando o componente entra na área visível da página: uma seção fechada
 * (ou ainda fora da tela) não custa nada.
 */
@Component({
  selector: 'sd-grafico',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // O uPlot cria os próprios elementos, fora do alcance do encapsulamento de estilos.
  encapsulation: ViewEncapsulation.None,
  template: `
    <figure class="sd-grafico" data-testid="grafico">
      <figcaption>{{ titulo() }}</figcaption>
      <div #alvo class="sd-grafico-alvo" role="img" [attr.aria-label]="descricao()"></div>
    </figure>
  `,
  styleUrl: './grafico.css',
})
export class Grafico {
  readonly titulo = input.required<string>();
  /** Valores do eixo X (o número de cada iteração, por exemplo). */
  readonly x = input.required<readonly number[]>();
  readonly series = input.required<readonly SerieDoGrafico[]>();
  readonly rotuloX = input('Iteração');
  /** Formata os valores do eixo Y e da legenda. */
  readonly formatar = input<(valor: number) => string>((valor) => String(valor));

  private readonly criar = inject(CRIADOR_DE_GRAFICO);
  private readonly hospedeiro = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly alvo = viewChild.required<ElementRef<HTMLElement>>('alvo');
  private grafico: GraficoCriado | null = null;
  private redimensionar: ResizeObserver | null = null;
  private montando = false;
  private destruido = false;

  /** Resumo em texto do que o gráfico mostra, para quem não vê o canvas. */
  protected descricao(): string {
    const nomes = this.series().map((serie) => serie.nome);
    return `${this.titulo()}: ${nomes.join(', ')}, ${this.x().length} pontos.`;
  }

  constructor() {
    const destruir = inject(DestroyRef);
    afterNextRender(() => {
      const elemento = this.hospedeiro.nativeElement;
      if (typeof IntersectionObserver === 'undefined') {
        void this.montar();
        return;
      }
      const observador = new IntersectionObserver((entradas) => {
        if (!entradas.some((entrada) => entrada.isIntersecting)) return;
        observador.disconnect();
        void this.montar();
      });
      observador.observe(elemento);
      destruir.onDestroy(() => observador.disconnect());
    });
    // Séries novas (outro relatório na mesma página) redesenham o gráfico que já existe.
    effect(() => {
      const dados = this.dados();
      this.grafico?.setData(dados);
    });
    destruir.onDestroy(() => {
      this.destruido = true;
      this.redimensionar?.disconnect();
      this.grafico?.destroy();
      this.grafico = null;
    });
  }

  private dados(): uPlot.AlignedData {
    return [[...this.x()], ...this.series().map((serie) => [...serie.valores])] as uPlot.AlignedData;
  }

  private largura(): number {
    return this.alvo().nativeElement.clientWidth || LARGURA_PADRAO;
  }

  private async montar(): Promise<void> {
    if (this.grafico || this.montando) return;
    this.montando = true;
    const alvo = this.alvo().nativeElement;
    const cor = getComputedStyle(alvo).color || '#444';
    const grade = { stroke: 'rgba(128, 128, 128, 0.25)', width: 1 };
    const formatar = this.formatar();
    const opcoes: uPlot.Options = {
      width: this.largura(),
      height: ALTURA,
      scales: { x: { time: false } },
      axes: [
        { stroke: cor, grid: grade, ticks: grade, label: this.rotuloX(), labelSize: 20 },
        { stroke: cor, grid: grade, ticks: grade, size: 80, values: (_grafico, marcas) => marcas.map((marca) => formatar(marca)) },
      ],
      series: [
        { label: this.rotuloX() },
        ...this.series().map((serie, i) => ({
          label: serie.nome,
          stroke: CORES[i % CORES.length]!,
          width: 2,
          points: { show: this.x().length <= 60 },
          value: (_grafico: uPlot, valor: number | null) => (valor === null || valor === undefined ? '—' : formatar(valor)),
        })),
      ],
    };
    const grafico = await this.criar(opcoes, this.dados(), alvo);
    // A seção pode ter sido fechada enquanto o uPlot carregava.
    if (this.destruido) {
      grafico.destroy();
      return;
    }
    this.grafico = grafico;
    // As séries podem ter mudado durante a carga.
    grafico.setData(this.dados());
    if (typeof ResizeObserver !== 'undefined') {
      this.redimensionar = new ResizeObserver(() => this.grafico?.setSize({ width: this.largura(), height: ALTURA }));
      this.redimensionar.observe(alvo);
    }
  }
}
