import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Ambiente, assentar, prepararAmbiente } from './apoio-teste';
import { Grafico, type SerieDoGrafico } from './grafico';

@Component({
  imports: [Grafico],
  template: `
    @if (aberta()) {
      <sd-grafico titulo="Heap usado por iteração" [x]="x()" [series]="series()" [formatar]="formatar" />
    }
  `,
})
class Hospedeiro {
  readonly aberta = signal(false);
  readonly x = signal([1, 2, 3]);
  readonly series = signal<SerieDoGrafico[]>([{ nome: 'Heap usado', valores: [10, 20, null] }]);
  readonly formatar = (valor: number): string => `${valor} B`;
}

describe('Grafico', () => {
  let ambiente: Ambiente;
  let fixture: ComponentFixture<Hospedeiro>;

  beforeEach(() => {
    ambiente = prepararAmbiente();
    fixture = TestBed.createComponent(Hospedeiro);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function abrir(): Promise<void> {
    fixture.componentInstance.aberta.set(true);
    await assentar(fixture);
  }

  it('não é criado enquanto a seção está fechada', async () => {
    await assentar(fixture);
    expect(ambiente.graficos).toHaveLength(0);
    await abrir();
    expect(ambiente.graficos).toHaveLength(1);
  });

  it('recebe o eixo X e as séries, com buraco onde não há valor, e formata os valores', async () => {
    await abrir();
    const [grafico] = ambiente.graficos;
    expect(grafico!.dados).toEqual([
      [1, 2, 3],
      [10, 20, null],
    ]);
    expect(grafico!.opcoes.series.map((s) => s.label)).toEqual(['Iteração', 'Heap usado']);
    const valores = grafico!.opcoes.axes![1]!.values as (grafico: unknown, marcas: number[]) => string[];
    expect(valores(null, [0, 512])).toEqual(['0 B', '512 B']);
    // O canvas tem uma descrição em texto.
    const alvo = (fixture.nativeElement as HTMLElement).querySelector('[role="img"]')!;
    expect(alvo.getAttribute('aria-label')).toBe('Heap usado por iteração: Heap usado, 3 pontos.');
    expect(grafico!.alvo).toBe(alvo);
  });

  it('séries novas pelo signal redesenham o mesmo gráfico', async () => {
    await abrir();
    fixture.componentInstance.x.set([1, 2, 3, 4]);
    fixture.componentInstance.series.set([{ nome: 'Heap usado', valores: [10, 20, 30, 40] }]);
    await assentar(fixture);
    expect(ambiente.graficos).toHaveLength(1);
    expect(ambiente.graficos[0]!.atualizacoes.at(-1)).toEqual([
      [1, 2, 3, 4],
      [10, 20, 30, 40],
    ]);
  });

  it('é destruído quando a seção fecha', async () => {
    await abrir();
    fixture.componentInstance.aberta.set(false);
    await assentar(fixture);
    expect(ambiente.graficos[0]!.destruido).toBe(true);
  });

  it('com a seção aberta mas fora da tela, só é criado ao entrar na área visível', async () => {
    const observadores: { avisar: (visivel: boolean) => void; desligado: boolean }[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        private readonly registro: (typeof observadores)[number];
        constructor(aoMudar: (entradas: { isIntersecting: boolean }[]) => void) {
          this.registro = { avisar: (visivel) => aoMudar([{ isIntersecting: visivel }]), desligado: false };
          observadores.push(this.registro);
        }
        observe(): void {}
        disconnect(): void {
          this.registro.desligado = true;
        }
      },
    );
    await abrir();
    expect(observadores).toHaveLength(1);
    expect(ambiente.graficos).toHaveLength(0);

    observadores[0]!.avisar(false);
    await assentar(fixture);
    expect(ambiente.graficos).toHaveLength(0);

    observadores[0]!.avisar(true);
    await assentar(fixture);
    expect(ambiente.graficos).toHaveLength(1);
    expect(observadores[0]!.desligado).toBe(true);
  });
});
