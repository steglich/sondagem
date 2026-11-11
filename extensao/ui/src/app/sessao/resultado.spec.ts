import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { ResultadoSessao } from '../../../../shared/types';
import { RESULTADO_FIXO } from './apoio-teste';
import { Resultado } from './resultado';

function montar(resultado: ResultadoSessao) {
  const fixture = TestBed.createComponent(Resultado);
  fixture.componentRef.setInput('resultado', resultado);
  fixture.detectChanges();
  const raiz = fixture.nativeElement as HTMLElement;
  return {
    texto: (id: string) => raiz.querySelector(`[data-testid="${id}"]`)?.textContent?.trim().replace(/\s+/g, ' '),
    /** Texto de cada linha da lista, com as colunas separadas por espaço. */
    textos: (id: string) =>
      Array.from(raiz.querySelectorAll(`[data-testid="${id}"]`), (linha) =>
        Array.from(linha.children, (coluna) => coluna.textContent?.trim().replace(/\s+/g, ' ')).join(' '),
      ),
    existe: (id: string) => raiz.querySelector(`[data-testid="${id}"]`) !== null,
  };
}

describe('Resultado', () => {
  it('identifica o resultado como sessão manual', () => {
    const { texto } = montar(RESULTADO_FIXO);
    expect(texto('resultado-tipo')).toBe('Sessão manual');
    expect(texto('resultado-desfecho')).toBe('Concluída');
    expect(texto('resultado-url')).toBe(RESULTADO_FIXO.url);
  });

  it('mostra as métricas de carregamento, com a que o navegador não produziu como indisponível', () => {
    const { texto } = montar(RESULTADO_FIXO);
    expect(texto('metrica-fcp')).toBe('120.0 ms');
    expect(texto('metrica-ttfb')).toBe('35.5 ms');
    // CLS igual a zero é um valor medido; LCP nunca foi emitido.
    expect(texto('metrica-cls')).toBe('0.000');
    expect(texto('metrica-lcp')).toBe('indisponível');
  });

  it('mostra o INP, as long tasks e as interações com duração e elemento alvo', () => {
    const { texto, textos } = montar(RESULTADO_FIXO);
    expect(texto('metrica-inp')).toBe('328.0 ms');
    expect(textos('long-task')).toEqual(['2.0 s 312.4 ms', '5.5 s 75.0 ms']);
    expect(textos('interacao')).toEqual(['2.0 s click em button[data-testid="acao-pesada"] 328.0 ms']);
  });

  it('confirma a limpeza e lista o que foi removido', () => {
    const { texto, textos, existe } = montar(RESULTADO_FIXO);
    expect(texto('limpeza-concluida')).toContain('Desconexão concluída');
    expect(textos('item-limpeza')).toEqual([
      'Script de medição registrado 1',
      'Observadores de performance 7',
      'Listeners de eventos 5',
      'Conexões entre a página e a extensão 1',
      'Temporizadores 2',
    ]);
    expect(existe('limpeza-sem-pagina')).toBe(false);
  });

  it('só com "Carregamento", não mostra long tasks, interações nem INP', () => {
    const { existe } = montar({
      ...RESULTADO_FIXO,
      selecao: ['carregamento'],
      dados: { ...RESULTADO_FIXO.dados, longTasks: [], interacoes: [] },
    });
    expect(existe('carregamento')).toBe(true);
    expect(existe('lista-long-tasks')).toBe(false);
    expect(existe('lista-interacoes')).toBe(false);
    expect(existe('metrica-inp')).toBe(false);
  });

  it('só com "Processamento", não mostra métricas de carregamento', () => {
    const { existe } = montar({ ...RESULTADO_FIXO, selecao: ['processamento'] });
    expect(existe('carregamento')).toBe(false);
    expect(existe('metrica-inp')).toBe(true);
  });

  it('sessão interrompida avisa e mantém os dados recebidos', () => {
    const { texto, textos, existe } = montar({
      ...RESULTADO_FIXO,
      desfecho: 'interrompida',
      paginaRespondeu: false,
      limpeza: [{ recurso: 'script-registrado', quantidade: 1 }],
    });
    expect(texto('resultado-desfecho')).toBe('Interrompida');
    expect(existe('resultado-interrompida')).toBe(true);
    expect(textos('long-task')).toHaveLength(2);
    expect(existe('limpeza-sem-pagina')).toBe(true);
  });

  it('análise cancelada mostra só a situação e a limpeza', () => {
    const { texto, existe, textos } = montar({
      ...RESULTADO_FIXO,
      desfecho: 'cancelada',
      dados: { longTasks: [], interacoes: [], documentos: [] },
    });
    expect(texto('resultado-desfecho')).toBe('Análise cancelada');
    expect(existe('lista-long-tasks')).toBe(false);
    expect(existe('carregamento')).toBe(false);
    expect(textos('item-limpeza')).toHaveLength(5);
  });
});
