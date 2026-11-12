import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RegistroExecucao } from '../../../../shared/historico';
import { formatarMs } from '../../../../shared/texto';
import type { DadosColetados, DocumentoObservado, NomeMetrica } from '../../../../shared/types';
import { segundosDesde } from './formato';
import { type ColunaDaLista, ListaVirtual } from './lista-virtual';

const emMs = (documento: DocumentoObservado, metrica: NomeMetrica): string => {
  const valor = documento.metricas[metrica];
  return valor === undefined ? 'indisponível' : formatarMs(valor);
};

/** Carregamentos observados na aba: um por documento, com as métricas que o navegador produziu. */
@Component({
  selector: 'sd-secao-carregamento',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ListaVirtual],
  template: `
    @if (truncada()) {
      <p class="nota" data-testid="carregamentos-truncados">A lista de carregamentos foi removida para caber no limite de armazenamento.</p>
    } @else if (dados().documentos.length === 0) {
      <p class="nota" data-testid="sem-carregamentos">Nenhum carregamento observado.</p>
    } @else {
      <sd-lista-virtual data-testid="lista-carregamentos" rotulo="Carregamentos" [itens]="dados().documentos" [colunas]="colunas" />
    }
  `,
  styles: `
    .nota {
      opacity: 0.7;
    }
  `,
})
export class SecaoCarregamento {
  readonly registro = input.required<RegistroExecucao>();
  readonly dados = input.required<DadosColetados>();

  protected readonly truncada = computed(() => this.registro().truncado.includes('documentos'));

  protected readonly colunas: ColunaDaLista<DocumentoObservado>[] = [
    { titulo: 'Início', largura: '6rem', numerica: true, texto: (d) => segundosDesde(this.registro().inicio, d.inicio) },
    { titulo: 'URL', largura: 'minmax(0, 1fr)', texto: (d) => d.url },
    { titulo: 'TTFB', largura: '6rem', numerica: true, texto: (d) => emMs(d, 'TTFB') },
    { titulo: 'FCP', largura: '6rem', numerica: true, texto: (d) => emMs(d, 'FCP') },
    { titulo: 'LCP', largura: '6rem', numerica: true, texto: (d) => emMs(d, 'LCP') },
    { titulo: 'CLS', largura: '5rem', numerica: true, texto: (d) => (d.metricas.CLS === undefined ? 'indisponível' : d.metricas.CLS.toFixed(3)) },
    { titulo: 'INP', largura: '6rem', numerica: true, texto: (d) => emMs(d, 'INP') },
  ];
}
