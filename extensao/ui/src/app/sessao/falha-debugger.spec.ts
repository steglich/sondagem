import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { FalhaDebugger as Falha } from '../../../../shared/types';
import { FalhaDebugger } from './falha-debugger';

function montar(falha: Falha) {
  const fixture = TestBed.createComponent(FalhaDebugger);
  fixture.componentRef.setInput('falha', falha);
  fixture.detectChanges();
  const raiz = fixture.nativeElement as HTMLElement;
  return {
    texto: (id: string) => raiz.querySelector(`[data-testid="${id}"]`)?.textContent?.trim().replace(/\s+/g, ' '),
    textos: (id: string) => Array.from(raiz.querySelectorAll(`[data-testid="${id}"]`), (e) => e.textContent?.trim()),
    existe: (id: string) => raiz.querySelector(`[data-testid="${id}"]`) !== null,
    raiz,
  };
}

describe('FalhaDebugger', () => {
  it('outro depurador: orienta a fechar o DevTools ou usar uma janela dedicada', () => {
    const { texto, raiz } = montar({
      categoria: 'outro-depurador',
      original: 'A aba já tem um depurador anexado.',
      dependentes: ['Execução do cenário'],
    });
    expect(texto('falha-debugger-titulo')).toBe('Há um depurador aberto nesta aba.');
    expect(texto('falha-debugger-orientacao')).toContain('Feche-o ou use uma janela de teste dedicada');
    expect(texto('falha-debugger-orientacao')).toContain('DevTools');
    expect(raiz.textContent).toContain('A análise não foi iniciada');
    expect(raiz.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('aba que não aceita depuração: informa que a página não pode ser analisada', () => {
    const { texto, existe } = montar({
      categoria: 'alvo-nao-depuravel',
      original: 'Cannot access a chrome:// URL',
      dependentes: ['Erros da página'],
    });
    expect(texto('falha-debugger-titulo')).toBe('Esta página não pode ser analisada.');
    expect(texto('falha-debugger-orientacao')).toContain('páginas internas');
    expect(existe('falha-debugger-original')).toBe(false);
  });

  it('erro desconhecido: mostra a mensagem original do Chrome', () => {
    const { texto } = montar({ categoria: 'desconhecido', original: 'Falha rara do Chrome', dependentes: [] });
    expect(texto('falha-debugger-titulo')).toBe('Não foi possível anexar o debugger à aba.');
    expect(texto('falha-debugger-original')).toBe('Falha rara do Chrome');
  });

  it('lista o que, na análise pedida, depende do debugger', () => {
    const { textos } = montar({
      categoria: 'outro-depurador',
      original: '',
      dependentes: ['Execução do cenário', 'Erros da página'],
    });
    expect(textos('falha-debugger-dependente')).toEqual(['Execução do cenário', 'Erros da página']);
  });

  it('sem dependentes, não mostra a lista', () => {
    const { existe } = montar({ categoria: 'desconhecido', original: 'x', dependentes: [] });
    expect(existe('falha-debugger-dependente')).toBe(false);
  });
});
