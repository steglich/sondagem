/** Apoio dos testes de componente das telas de relatório. */
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { iteracoes } from '../../../../shared/apoio-registro';
import type { ResultadoCenario, ResultadoSessao } from '../../../../shared/types';
import { PonteSimulada, RESULTADO_CENARIO_FIXO } from '../sessao/apoio-teste';
import { PonteExtensao } from '../sessao/ponte';
import { CRIADOR_DE_GRAFICO, type CriadorDeGrafico } from './grafico';

export interface GraficoFalso {
  opcoes: Parameters<CriadorDeGrafico>[0];
  dados: Parameters<CriadorDeGrafico>[1];
  alvo: HTMLElement;
  atualizacoes: Parameters<CriadorDeGrafico>[1][];
  destruido: boolean;
}

export interface Ambiente {
  ponte: PonteSimulada;
  /** Gráficos criados, na ordem. O jsdom não tem canvas: o uPlot de verdade não roda aqui. */
  graficos: GraficoFalso[];
}

export function prepararAmbiente(): Ambiente {
  const ponte = new PonteSimulada();
  const graficos: GraficoFalso[] = [];
  const criar: CriadorDeGrafico = (opcoes, dados, alvo) => {
    const grafico: GraficoFalso = { opcoes, dados, alvo, atualizacoes: [], destruido: false };
    graficos.push(grafico);
    return {
      setData: (novos) => void grafico.atualizacoes.push(novos),
      setSize: () => undefined,
      destroy: () => void (grafico.destruido = true),
    };
  };
  TestBed.configureTestingModule({
    providers: [{ provide: PonteExtensao, useValue: ponte }, { provide: CRIADOR_DE_GRAFICO, useValue: criar }, provideRouter([])],
  });
  return { ponte, graficos };
}

/** Espera as leituras da ponte, os blocos `@defer` e a renderização assentarem. */
export async function assentar(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let volta = 0; volta < 6; volta++) {
    await new Promise<void>((resolver) => setTimeout(resolver, 0));
    fixture.detectChanges();
    await fixture.whenStable();
  }
  fixture.detectChanges();
}

export function consultas(fixture: () => ComponentFixture<unknown>) {
  const raiz = (): HTMLElement => fixture().nativeElement as HTMLElement;
  const limpo = (elemento: Element): string => elemento.textContent!.trim().replace(/\s+/g, ' ');
  return {
    raiz,
    porId<T extends HTMLElement = HTMLElement>(id: string, dentro: ParentNode = raiz()): T {
      const elemento = dentro.querySelector<T>(`[data-testid="${id}"]`);
      if (!elemento) throw new Error(`data-testid="${id}" não encontrado`);
      return elemento;
    },
    existe: (id: string): boolean => raiz().querySelector(`[data-testid="${id}"]`) !== null,
    texto: (id: string): string => {
      const elemento = raiz().querySelector(`[data-testid="${id}"]`);
      if (!elemento) throw new Error(`data-testid="${id}" não encontrado`);
      return limpo(elemento);
    },
    textos: (id: string, dentro: ParentNode = raiz()): string[] => Array.from(dentro.querySelectorAll(`[data-testid="${id}"]`), limpo),
    /** Texto de cada célula de cada linha de uma lista virtual. */
    linhas: (idDaLista: string): string[][] =>
      Array.from(raiz().querySelectorAll(`[data-testid="${idDaLista}"] [data-testid="linha"]`), (linha) =>
        Array.from(linha.querySelectorAll('[role="cell"]'), limpo),
      ),
    async clicar(id: string): Promise<void> {
      const elemento = raiz().querySelector<HTMLElement>(`[data-testid="${id}"]`);
      if (!elemento) throw new Error(`data-testid="${id}" não encontrado`);
      elemento.click();
      await assentar(fixture());
    },
    async preencher(id: string, valor: string): Promise<void> {
      const campo = raiz().querySelector<HTMLInputElement | HTMLSelectElement>(`[data-testid="${id}"]`);
      if (!campo) throw new Error(`data-testid="${id}" não encontrado`);
      campo.value = valor;
      campo.dispatchEvent(new Event(campo instanceof HTMLSelectElement ? 'change' : 'input'));
      await assentar(fixture());
    },
    /** Abre ou fecha um `<details>`, como o clique no `<summary>` faria no navegador. */
    async alternarSecao(secao: string, aberta = true): Promise<void> {
      const detalhes = raiz().querySelector<HTMLDetailsElement>(`[data-testid="secao-${secao}"]`);
      if (!detalhes) throw new Error(`seção "${secao}" não encontrada`);
      detalhes.open = aberta;
      detalhes.dispatchEvent(new Event('toggle'));
      await assentar(fixture());
    },
  };
}

/** Execução de cenário concluída, com 3 iterações de 1 segundo e o que o teste quiser trocar. */
export function resultadoDeCenario(id: string, parcial: Partial<ResultadoSessao> = {}, cenario: Partial<ResultadoCenario> = {}): ResultadoSessao {
  const base = RESULTADO_CENARIO_FIXO.cenario!;
  return {
    ...RESULTADO_CENARIO_FIXO,
    id,
    ...parcial,
    cenario: {
      ...base,
      configuracao: { ...base.configuracao, iteracoes: 3 },
      iteracoes: iteracoes(3),
      iteracoesCompletas: 3,
      iteracoesIncompletas: 0,
      falhas: [],
      ...cenario,
    },
  };
}

/** As estatísticas de um resultado com outras medianas. */
export function comMedianas(resultado: ResultadoSessao, medianas: Record<string, number | null>): ResultadoSessao {
  const cenario = resultado.cenario!;
  return {
    ...resultado,
    cenario: {
      ...cenario,
      estatisticas: cenario.estatisticas.map((e) => (e.id in medianas ? { ...e, mediana: medianas[e.id]!, amostras: medianas[e.id] === null ? 0 : 3 } : e)),
    },
  };
}
