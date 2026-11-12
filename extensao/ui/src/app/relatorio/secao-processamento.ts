import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RegistroExecucao } from '../../../../shared/historico';
import { medicoesPorIteracao } from '../../../../shared/relatorio';
import { formatarMs } from '../../../../shared/texto';
import type { DadosColetados, Interacao, LongTask } from '../../../../shared/types';
import { iteracaoExibida, segundosDesde } from './formato';
import { Grafico, type SerieDoGrafico } from './grafico';
import { type ColunaDaLista, ListaVirtual } from './lista-virtual';

/** Long tasks e interações: o gráfico por iteração e as duas listas completas. */
@Component({
  selector: 'sd-secao-processamento',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Grafico, ListaVirtual],
  template: `
    @if (porIteracao(); as grafico) {
      <sd-grafico titulo="Processamento por iteração" [x]="grafico.x" [series]="grafico.series" [formatar]="ms" />
    } @else {
      <p class="nota" data-testid="processamento-sem-grafico">Sem iterações para o gráfico: {{ motivoSemGrafico() }}</p>
    }

    <h3>Long tasks</h3>
    @if (truncada('longTasks')) {
      <p class="nota" data-testid="long-tasks-truncadas">A lista de long tasks foi removida para caber no limite de armazenamento.</p>
    } @else if (dados().longTasks.length === 0) {
      <p class="nota" data-testid="sem-long-tasks">Nenhuma long task.</p>
    } @else {
      <sd-lista-virtual data-testid="lista-long-tasks" rotulo="Long tasks" [itens]="dados().longTasks" [colunas]="colunasLongTasks" />
    }

    <h3>Interações</h3>
    @if (truncada('interacoes')) {
      <p class="nota" data-testid="interacoes-truncadas">A lista de interações foi removida para caber no limite de armazenamento.</p>
    } @else if (dados().interacoes.length === 0) {
      <p class="nota" data-testid="sem-interacoes">Nenhuma interação.</p>
    } @else {
      <sd-lista-virtual data-testid="lista-interacoes" rotulo="Interações" [itens]="dados().interacoes" [colunas]="colunasInteracoes" />
    }
  `,
  styles: `
    .nota {
      opacity: 0.7;
    }
  `,
})
export class SecaoProcessamento {
  readonly registro = input.required<RegistroExecucao>();
  readonly dados = input.required<DadosColetados>();

  protected readonly ms = formatarMs;

  protected readonly porIteracao = computed((): { x: number[]; series: SerieDoGrafico[] } | null => {
    const { linhas } = medicoesPorIteracao(this.registro(), this.dados());
    if (linhas.length === 0) return null;
    const series: SerieDoGrafico[] = [];
    if (!this.truncada('longTasks')) series.push({ nome: 'Tempo em long tasks', valores: linhas.map((l) => l.valores.tempoLongTasks) });
    if (!this.truncada('interacoes')) series.push({ nome: 'Pior interação', valores: linhas.map((l) => l.valores.piorInteracao) });
    return series.length === 0 ? null : { x: linhas.map((l) => l.iteracao), series };
  });

  protected readonly colunasLongTasks: ColunaDaLista<LongTask>[] = [
    { titulo: 'Início', largura: '6rem', numerica: true, texto: (t) => segundosDesde(this.registro().inicio, t.inicio) },
    { titulo: 'Duração', largura: '6rem', numerica: true, texto: (t) => formatarMs(t.duracao) },
    { titulo: 'Iteração', largura: '5rem', numerica: true, texto: (t) => iteracaoExibida(t.iteracao) },
    { titulo: 'Observação', largura: 'minmax(0, 1fr)', texto: (t) => (t.causadaPelaMedicao ? 'pausa da medição (fora das estatísticas)' : '') },
  ];

  protected readonly colunasInteracoes: ColunaDaLista<Interacao>[] = [
    { titulo: 'Início', largura: '6rem', numerica: true, texto: (i) => segundosDesde(this.registro().inicio, i.inicio) },
    { titulo: 'Duração', largura: '6rem', numerica: true, texto: (i) => formatarMs(i.duracao) },
    { titulo: 'Iteração', largura: '5rem', numerica: true, texto: (i) => iteracaoExibida(i.iteracao) },
    { titulo: 'Evento', largura: '7rem', texto: (i) => i.tipo },
    { titulo: 'Elemento', largura: 'minmax(0, 1fr)', texto: (i) => i.alvo },
  ];

  protected truncada(lista: 'longTasks' | 'interacoes'): boolean {
    return this.registro().truncado.includes(lista);
  }

  protected motivoSemGrafico(): string {
    return this.registro().tipo === 'sessao-manual' ? 'a sessão manual não tem iterações.' : 'as listas detalhadas não estão guardadas.';
  }
}
