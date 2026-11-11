import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { Selecao } from '../../../../shared/types';
import { VERIFICACOES } from '../../../../shared/verificacoes';
import { URL_TESTE } from './apoio-teste';
import { Confirmacao } from './confirmacao';

function montar(entradas: { selecaoInicial?: Selecao; bloqueio?: string | null; url?: string } = {}) {
  const fixture = TestBed.createComponent(Confirmacao);
  fixture.componentRef.setInput('url', entradas.url ?? URL_TESTE);
  fixture.componentRef.setInput('modo', 'Sessão manual');
  fixture.componentRef.setInput('verificacoes', VERIFICACOES);
  fixture.componentRef.setInput('selecaoInicial', entradas.selecaoInicial ?? ['processamento', 'carregamento']);
  fixture.componentRef.setInput('bloqueio', entradas.bloqueio ?? null);
  fixture.detectChanges();
  return fixture;
}

function porId<T extends HTMLElement>(fixture: ComponentFixture<unknown>, id: string): T {
  const elemento = (fixture.nativeElement as HTMLElement).querySelector<T>(`[data-testid="${id}"]`);
  if (!elemento) throw new Error(`data-testid="${id}" não encontrado`);
  return elemento;
}

function existe(fixture: ComponentFixture<unknown>, id: string): boolean {
  return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`) !== null;
}

describe('Confirmacao', () => {
  it('mostra a URL da aba, o modo e as verificações disponíveis, com confirmar e cancelar', () => {
    const fixture = montar();

    expect(porId(fixture, 'confirmacao-url').textContent).toContain(URL_TESTE);
    expect(porId(fixture, 'confirmacao-modo').textContent).toContain('Sessão manual');
    expect(fixture.nativeElement.textContent).toContain('Processamento');
    expect(fixture.nativeElement.textContent).toContain('Carregamento');
    expect(porId<HTMLButtonElement>(fixture, 'confirmar').disabled).toBe(false);
    expect(existe(fixture, 'desistir')).toBe(true);
  });

  it('abre com a seleção inicial marcada', () => {
    const fixture = montar({ selecaoInicial: ['carregamento'] });
    expect(porId<HTMLInputElement>(fixture, 'verificacao-processamento').checked).toBe(false);
    expect(porId<HTMLInputElement>(fixture, 'verificacao-carregamento').checked).toBe(true);
  });

  it('desabilita a confirmação e explica o motivo quando nenhuma verificação está marcada', () => {
    const fixture = montar();
    porId(fixture, 'verificacao-processamento').click();
    porId(fixture, 'verificacao-carregamento').click();
    fixture.detectChanges();

    expect(porId<HTMLButtonElement>(fixture, 'confirmar').disabled).toBe(true);
    expect(porId(fixture, 'confirmacao-impedimento').textContent).toContain('Marque ao menos uma verificação');

    porId(fixture, 'verificacao-carregamento').click();
    fixture.detectChanges();
    expect(porId<HTMLButtonElement>(fixture, 'confirmar').disabled).toBe(false);
    expect(existe(fixture, 'confirmacao-impedimento')).toBe(false);
  });

  it('confirmar emite só as verificações marcadas, na ordem do registro', () => {
    const fixture = montar();
    const emitidas: Selecao[] = [];
    fixture.componentInstance.confirmar.subscribe((selecao) => emitidas.push(selecao));

    porId(fixture, 'verificacao-processamento').click();
    fixture.detectChanges();
    porId(fixture, 'confirmar').click();

    expect(emitidas).toEqual([['carregamento']]);
  });

  it('cancelar emite a desistência sem confirmar', () => {
    const fixture = montar();
    let confirmou = false;
    let desistiu = false;
    fixture.componentInstance.confirmar.subscribe(() => (confirmou = true));
    fixture.componentInstance.desistir.subscribe(() => (desistiu = true));

    porId(fixture, 'desistir').click();
    expect({ confirmou, desistiu }).toEqual({ confirmou: false, desistiu: true });
  });

  it('bloqueia o início em URL não suportada, com a mensagem recebida', () => {
    const fixture = montar({
      url: 'chrome://extensions',
      bloqueio: 'Páginas chrome:// não podem ser analisadas. Abra uma página http ou https.',
    });

    expect(porId<HTMLButtonElement>(fixture, 'confirmar').disabled).toBe(true);
    expect(porId(fixture, 'confirmacao-impedimento').textContent).toContain('não podem ser analisadas');
  });
});
