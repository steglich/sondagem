import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { PonteSimulada } from '../sessao/apoio-teste';
import { PonteExtensao } from '../sessao/ponte';
import { Perfis } from './perfis';

describe('Perfis', () => {
  let ponte: PonteSimulada;
  let fixture: ComponentFixture<Perfis>;

  beforeEach(() => {
    ponte = new PonteSimulada();
    TestBed.configureTestingModule({ providers: [{ provide: PonteExtensao, useValue: ponte }] });
  });

  async function assentar(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    fixture.detectChanges();
  }

  async function abrir(): Promise<void> {
    fixture = TestBed.createComponent(Perfis);
    await assentar();
  }

  const raiz = (): HTMLElement => fixture.nativeElement as HTMLElement;
  function porId<T extends HTMLElement>(id: string): T {
    const elemento = raiz().querySelector<T>(`[data-testid="${id}"]`);
    if (!elemento) throw new Error(`data-testid="${id}" não encontrado`);
    return elemento;
  }
  const existe = (id: string): boolean => raiz().querySelector(`[data-testid="${id}"]`) !== null;
  const textos = (id: string): string[] => Array.from(raiz().querySelectorAll(`[data-testid="${id}"]`), (e) => e.textContent!.trim().replace(/\s+/g, ' '));

  function preencher(campos: Partial<Record<'nome' | 'cpu' | 'latencia' | 'download' | 'upload', string>>): void {
    for (const [campo, valor] of Object.entries(campos)) {
      const entrada = porId<HTMLInputElement>(`perfil-campo-${campo}`);
      entrada.value = valor;
      entrada.dispatchEvent(new Event('input'));
    }
    fixture.detectChanges();
  }

  async function salvar(): Promise<void> {
    porId('salvar-perfil').click();
    await assentar();
  }

  it('lista os perfis embutidos, que não podem ser removidos', async () => {
    await abrir();
    expect(textos('perfil-embutido')).toEqual([
      'nenhumsem limitação (embutido)',
      'padraoCPU 4× mais lenta; rede com 150 ms de latência, download de 1600 kbps e upload de 750 kbps (embutido)',
    ]);
    expect(existe('perfil')).toBe(false);
    expect(existe('remover-perfil-padrao')).toBe(false);
  });

  it('salva um perfil com fator de CPU 6 e latência de 300 ms, e ele aparece na lista', async () => {
    await abrir();
    preencher({ nome: 'celular-antigo', cpu: '6', latencia: '300' });
    await salvar();

    expect(ponte.perfis.get('celular-antigo')).toEqual({ nome: 'celular-antigo', cpu: 6, rede: { latenciaMs: 300, downloadKbps: null, uploadKbps: null } });
    expect(textos('perfil-nome')).toEqual(['celular-antigo']);
    expect(textos('perfil-descricao')).toEqual(['CPU 6× mais lenta; rede com 300 ms de latência, download de sem limite e upload de sem limite']);
    expect(porId('perfil-salvo').textContent).toContain('celular-antigo');
    // O formulário volta ao estado inicial.
    expect(porId<HTMLInputElement>('perfil-campo-nome').value).toBe('');
    expect(porId<HTMLInputElement>('perfil-campo-cpu').value).toBe('1');
  });

  it('com taxas de download e upload, e sem preencher a rede: só CPU', async () => {
    await abrir();
    preencher({ nome: 'rede-lenta', cpu: '1', latencia: '100', download: '500', upload: '250' });
    await salvar();
    preencher({ nome: 'so-cpu', cpu: '2.5' });
    await salvar();

    expect(ponte.perfis.get('rede-lenta')).toEqual({ nome: 'rede-lenta', cpu: 1, rede: { latenciaMs: 100, downloadKbps: 500, uploadKbps: 250 } });
    expect(ponte.perfis.get('so-cpu')).toEqual({ nome: 'so-cpu', cpu: 2.5, rede: null });
    expect(textos('perfil-nome')).toEqual(['rede-lenta', 'so-cpu']);
  });

  it.each([
    [{ nome: '', cpu: '4' }, 'Dê um nome ao perfil.'],
    [{ nome: 'padrao', cpu: '4' }, 'O nome "padrao" é reservado.'],
    [{ nome: 'x', cpu: '0' }, 'O fator de CPU deve ser um número maior ou igual a 1.'],
    [{ nome: 'x', cpu: '2', latencia: '-5' }, 'A latência deve ser um número maior ou igual a zero.'],
    [{ nome: 'x', cpu: '2', download: '0' }, 'As taxas de download e upload devem ser maiores que zero (ou vazias, para não limitar).'],
  ])('perfil inválido %j: mostra o erro e não grava', async (campos, mensagem) => {
    await abrir();
    preencher(campos);
    await salvar();

    expect(porId('perfil-erro').textContent).toContain(mensagem);
    expect(ponte.perfis.size).toBe(0);
    expect(existe('perfil-salvo')).toBe(false);
  });

  it('remove um perfil salvo', async () => {
    ponte.perfis.set('celular-antigo', { nome: 'celular-antigo', cpu: 6, rede: null });
    await abrir();
    expect(textos('perfil-nome')).toEqual(['celular-antigo']);

    porId('remover-perfil-celular-antigo').click();
    await assentar();
    expect(ponte.perfis.size).toBe(0);
    expect(existe('perfil')).toBe(false);
  });

  it('salvar com um nome já usado substitui o perfil', async () => {
    ponte.perfis.set('celular-antigo', { nome: 'celular-antigo', cpu: 6, rede: null });
    await abrir();
    preencher({ nome: 'celular-antigo', cpu: '8' });
    await salvar();
    expect(textos('perfil-nome')).toEqual(['celular-antigo']);
    expect(ponte.perfis.get('celular-antigo')?.cpu).toBe(8);
  });
});
