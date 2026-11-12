import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { Cenario } from '../../../../shared/cenario';
import type { PerfilThrottling } from '../../../../shared/condicoes';
import type { ExtensaoAtiva } from '../../../../shared/types';
import { VERIFICACOES } from '../../../../shared/verificacoes';
import { CENARIO_TESTE, URL_TESTE } from './apoio-teste';
import { type AnaliseConfirmada, Confirmacao } from './confirmacao';

const LENTO: PerfilThrottling = { nome: 'celular-antigo', cpu: 6, rede: { latenciaMs: 300, downloadKbps: 400, uploadKbps: 200 } };

function montar(entradas: { cenario?: Cenario | null; perfis?: PerfilThrottling[]; extensoes?: ExtensaoAtiva[] } = {}) {
  const fixture = TestBed.createComponent(Confirmacao);
  fixture.componentRef.setInput('url', URL_TESTE);
  fixture.componentRef.setInput('cenario', entradas.cenario ?? null);
  fixture.componentRef.setInput('selecaoCenario', null);
  fixture.componentRef.setInput('verificacoes', VERIFICACOES);
  fixture.componentRef.setInput('selecaoInicial', ['processamento', 'carregamento']);
  fixture.componentRef.setInput('perfis', entradas.perfis ?? []);
  fixture.componentRef.setInput('extensoes', entradas.extensoes ?? []);
  const confirmadas: AnaliseConfirmada[] = [];
  fixture.componentInstance.confirmar.subscribe((analise) => confirmadas.push(analise));
  fixture.detectChanges();
  return { fixture, confirmadas };
}

function porId<T extends HTMLElement>(fixture: ComponentFixture<unknown>, id: string): T {
  const elemento = (fixture.nativeElement as HTMLElement).querySelector<T>(`[data-testid="${id}"]`);
  if (!elemento) throw new Error(`data-testid="${id}" não encontrado`);
  return elemento;
}

const existe = (fixture: ComponentFixture<unknown>, id: string): boolean =>
  (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`) !== null;

const texto = (fixture: ComponentFixture<unknown>, id: string): string => porId(fixture, id).textContent!.trim().replace(/\s+/g, ' ');

describe('Confirmacao: throttling na sessão manual', () => {
  it('abre com "nenhum": confirma sem throttling e sem aviso de depuração', () => {
    const { fixture, confirmadas } = montar();
    expect(porId<HTMLSelectElement>(fixture, 'throttling-manual').value).toBe('nenhum');
    expect(existe(fixture, 'confirmacao-aviso-throttling')).toBe(false);

    porId(fixture, 'confirmar').click();
    expect(confirmadas).toEqual([{ modo: 'manual', selecao: ['processamento', 'carregamento'] }]);
  });

  it('oferece "nenhum", "padrao" e os perfis salvos, com os valores de cada um', () => {
    const { fixture } = montar({ perfis: [LENTO] });
    const opcoes = Array.from(porId<HTMLSelectElement>(fixture, 'throttling-manual').options, (opcao) => opcao.textContent!.trim());
    expect(opcoes).toEqual([
      'nenhum (sem limitação)',
      'padrao (CPU 4× mais lenta; rede com 150 ms de latência, download de 1600 kbps e upload de 750 kbps)',
      'celular-antigo (CPU 6× mais lenta; rede com 300 ms de latência, download de 400 kbps e upload de 200 kbps)',
    ]);
  });

  it('escolher um perfil avisa o que muda na página e que o debugger será usado, e confirma com o perfil', () => {
    const { fixture, confirmadas } = montar();
    const seletor = porId<HTMLSelectElement>(fixture, 'throttling-manual');
    seletor.value = 'padrao';
    seletor.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(texto(fixture, 'confirmacao-aviso-throttling')).toContain('CPU 4× mais lenta');
    expect(texto(fixture, 'confirmacao-aviso-throttling')).toContain('barra de depuração');
    porId(fixture, 'confirmar').click();
    expect(confirmadas).toEqual([{ modo: 'manual', selecao: ['processamento', 'carregamento'], throttling: 'padrao' }]);
  });

  it('no modo cenário não há escolha: vale o throttling do cenário, mostrado em números', () => {
    const { fixture, confirmadas } = montar({ cenario: CENARIO_TESTE });
    expect(existe(fixture, 'throttling-manual')).toBe(false);
    expect(texto(fixture, 'confirmacao-throttling')).toBe('padrao (CPU 4× mais lenta; rede com 150 ms de latência, download de 1600 kbps e upload de 750 kbps)');
    expect(texto(fixture, 'confirmacao-cache')).toBe('limpo antes da execução; desligado durante');

    porId(fixture, 'confirmar').click();
    expect(confirmadas[0]).not.toHaveProperty('throttling');
  });

  it('cenário com perfil que não existe: não executa, e a mensagem lista os disponíveis', () => {
    const { fixture } = montar({ cenario: { ...CENARIO_TESTE, execucao: { throttling: '3g' } }, perfis: [LENTO] });
    expect(porId<HTMLButtonElement>(fixture, 'confirmar').disabled).toBe(true);
    expect(texto(fixture, 'confirmacao-impedimento')).toBe(
      'O perfil de throttling "3g" não existe. Perfis disponíveis: "nenhum", "padrao", "celular-antigo".',
    );
  });

  it('cenário que usa um perfil salvo mostra os valores dele', () => {
    const { fixture } = montar({ cenario: { ...CENARIO_TESTE, execucao: { throttling: 'celular-antigo' } }, perfis: [LENTO] });
    expect(texto(fixture, 'confirmacao-throttling')).toContain('celular-antigo (CPU 6× mais lenta');
    expect(porId<HTMLButtonElement>(fixture, 'confirmar').disabled).toBe(false);
  });
});

describe('Confirmacao: limpeza de storage', () => {
  const COM_LIMPEZA: Cenario = { ...CENARIO_TESTE, limpar_storage: ['local_storage', 'cookies', 'cache_storage'] };

  it('avisa quais tipos serão apagados, de qual origem, e exige a confirmação específica', () => {
    const { fixture, confirmadas } = montar({ cenario: COM_LIMPEZA });

    expect(texto(fixture, 'confirmacao-tipos-storage')).toBe('localStorage, cookies');
    expect(texto(fixture, 'confirmacao-aviso-storage')).toContain('http://localhost:4300');
    expect(texto(fixture, 'confirmacao-aviso-storage')).toContain('você será deslogado');
    expect(porId<HTMLInputElement>(fixture, 'confirmar-limpeza-storage').checked).toBe(false);
    expect(porId<HTMLButtonElement>(fixture, 'confirmar').disabled).toBe(true);
    expect(texto(fixture, 'confirmacao-impedimento')).toContain('Confirme a limpeza de localStorage, cookies');

    // Sem a confirmação, o botão não emite nada: a execução não começa.
    porId(fixture, 'confirmar').click();
    expect(confirmadas).toEqual([]);
  });

  it('confirmada: executa, levando só os tipos que o usuário viu na tela', () => {
    const { fixture, confirmadas } = montar({ cenario: COM_LIMPEZA });
    porId(fixture, 'confirmar-limpeza-storage').click();
    fixture.detectChanges();

    expect(porId<HTMLButtonElement>(fixture, 'confirmar').disabled).toBe(false);
    porId(fixture, 'confirmar').click();
    expect(confirmadas).toHaveLength(1);
    // O Cache Storage não entra: já é limpo antes de toda execução, sem confirmação.
    expect(confirmadas[0]).toMatchObject({ modo: 'cenario', storageConfirmado: ['local_storage', 'cookies'] });
  });

  it('cenário sem `limpar_storage`: nenhum aviso, e nada vai como confirmado', () => {
    const { fixture, confirmadas } = montar({ cenario: CENARIO_TESTE });
    expect(existe(fixture, 'confirmacao-aviso-storage')).toBe(false);
    porId(fixture, 'confirmar').click();
    expect(confirmadas[0]).not.toHaveProperty('storageConfirmado');
  });

  it('só o Cache Storage declarado não pede confirmação', () => {
    const { fixture } = montar({ cenario: { ...CENARIO_TESTE, limpar_storage: ['cache_storage'] } });
    expect(existe(fixture, 'confirmacao-aviso-storage')).toBe(false);
    expect(porId<HTMLButtonElement>(fixture, 'confirmar').disabled).toBe(false);
  });

  it('trocar para a sessão manual tira o aviso, e voltar ao cenário exige confirmar de novo', () => {
    const { fixture, confirmadas } = montar({ cenario: COM_LIMPEZA });
    porId(fixture, 'confirmar-limpeza-storage').click();
    fixture.detectChanges();

    porId(fixture, 'modo-manual').click();
    fixture.detectChanges();
    expect(existe(fixture, 'confirmacao-aviso-storage')).toBe(false);
    porId(fixture, 'confirmar').click();
    expect(confirmadas[0]).toEqual({ modo: 'manual', selecao: ['processamento', 'carregamento'] });

    porId(fixture, 'modo-cenario').click();
    fixture.detectChanges();
    expect(porId<HTMLInputElement>(fixture, 'confirmar-limpeza-storage').checked).toBe(false);
    expect(porId<HTMLButtonElement>(fixture, 'confirmar').disabled).toBe(true);
  });
});

describe('Confirmacao: sessão da aplicação', () => {
  it('cenário sem `sessao.url_login`: informa que a sessão expirada não será detectada', () => {
    const { fixture } = montar({ cenario: CENARIO_TESTE });
    expect(texto(fixture, 'confirmacao-aviso-sessao')).toContain('sessao.url_login');
    expect(porId<HTMLButtonElement>(fixture, 'confirmar').disabled).toBe(false);
  });

  it('com `url_login` declarado, não há aviso', () => {
    const { fixture } = montar({ cenario: { ...CENARIO_TESTE, sessao: { url_login: '/login' } } });
    expect(existe(fixture, 'confirmacao-aviso-sessao')).toBe(false);
  });

  it('na sessão manual o aviso não se aplica', () => {
    expect(existe(montar().fixture, 'confirmacao-aviso-sessao')).toBe(false);
  });

  it('diz que cookies e dados da aplicação não são tocados pela limpeza de cache', () => {
    const { fixture } = montar({ cenario: CENARIO_TESTE });
    expect(texto(fixture, 'confirmacao-aviso-cenario')).toContain('cookies e os outros dados da aplicação não são tocados');
  });
});

describe('Confirmacao: outras extensões', () => {
  const EXTENSOES: ExtensaoAtiva[] = [
    { id: 'a', nome: 'Bloqueador' },
    { id: 'b', nome: 'Tradutor' },
  ];

  it('com outras extensões ativas: alerta com os nomes e a recomendação de perfil limpo, sem impedir', () => {
    const { fixture, confirmadas } = montar({ extensoes: EXTENSOES });
    const nomes = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="confirmacao-extensao"]'), (li) => li.textContent!.trim());

    expect(nomes).toEqual(['Bloqueador', 'Tradutor']);
    expect(texto(fixture, 'confirmacao-aviso-extensoes')).toContain('2 outras extensões ativas');
    expect(texto(fixture, 'confirmacao-aviso-extensoes')).toContain('perfil limpo');
    expect(existe(fixture, 'confirmacao-impedimento')).toBe(false);
    expect(porId<HTMLButtonElement>(fixture, 'confirmar').disabled).toBe(false);
    porId(fixture, 'confirmar').click();
    expect(confirmadas).toHaveLength(1);
  });

  it('o alerta aparece também no modo cenário', () => {
    const { fixture } = montar({ cenario: CENARIO_TESTE, extensoes: [EXTENSOES[0]!] });
    expect(texto(fixture, 'confirmacao-aviso-extensoes')).toContain('1 outra extensão ativa');
    expect(porId<HTMLButtonElement>(fixture, 'confirmar').disabled).toBe(false);
  });

  it('perfil limpo: nenhum alerta', () => {
    expect(existe(montar().fixture, 'confirmacao-aviso-extensoes')).toBe(false);
  });
});
