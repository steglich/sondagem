import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { Cenario } from '../../../../shared/cenario';
import type { Selecao } from '../../../../shared/types';
import { VERIFICACOES } from '../../../../shared/verificacoes';
import { CENARIO_TESTE, URL_TESTE } from './apoio-teste';
import { type AnaliseConfirmada, Confirmacao } from './confirmacao';

function montar(
  entradas: {
    selecaoInicial?: Selecao;
    bloqueio?: string | null;
    url?: string;
    cenario?: Cenario | null;
    selecaoCenario?: Selecao | null;
  } = {},
) {
  const fixture = TestBed.createComponent(Confirmacao);
  fixture.componentRef.setInput('url', entradas.url ?? URL_TESTE);
  fixture.componentRef.setInput('cenario', entradas.cenario ?? null);
  fixture.componentRef.setInput('selecaoCenario', entradas.selecaoCenario ?? null);
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
    const emitidas: AnaliseConfirmada[] = [];
    fixture.componentInstance.confirmar.subscribe((analise) => emitidas.push(analise));

    porId(fixture, 'verificacao-processamento').click();
    fixture.detectChanges();
    porId(fixture, 'confirmar').click();

    expect(emitidas).toEqual([{ modo: 'manual', selecao: ['carregamento'] }]);
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

  it('sem cenário escolhido, não oferece a troca de modo nem os campos de cenário', () => {
    const fixture = montar();
    expect(existe(fixture, 'modo-cenario')).toBe(false);
    expect(existe(fixture, 'confirmacao-iteracoes')).toBe(false);
    expect(existe(fixture, 'confirmacao-cenario')).toBe(false);
  });

  it('avisa da barra de depuração quando a sessão manual marca uma verificação que usa o debugger', () => {
    const fixture = montar();
    expect(existe(fixture, 'confirmacao-aviso-debugger')).toBe(false);
    porId(fixture, 'verificacao-erros-pagina').click();
    fixture.detectChanges();
    expect(existe(fixture, 'confirmacao-aviso-debugger')).toBe(true);
  });

  describe('com um cenário escolhido', () => {
    function digitar(fixture: ComponentFixture<unknown>, id: string, valor: string): void {
      const campo = porId<HTMLInputElement>(fixture, id);
      campo.value = valor;
      campo.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    it('abre no modo cenário, com nome, URL inicial, iterações e throttling', () => {
      const fixture = montar({ cenario: CENARIO_TESTE });

      expect(porId<HTMLInputElement>(fixture, 'modo-cenario').checked).toBe(true);
      expect(porId(fixture, 'confirmacao-modo').textContent).toContain('Cenário');
      expect(porId(fixture, 'confirmacao-cenario').textContent).toContain('abrir-fechar');
      expect(porId(fixture, 'confirmacao-url-inicial').textContent).toContain('http://localhost:4300/limpa');
      expect(porId<HTMLInputElement>(fixture, 'confirmacao-iteracoes').value).toBe('20');
      expect(porId(fixture, 'confirmacao-throttling').textContent).toContain('padrao');
      expect(porId<HTMLInputElement>(fixture, 'confirmacao-versao-build').value).toBe('');
      expect(existe(fixture, 'verificacao-processamento')).toBe(true);
    });

    it('cenário sem iterações nem throttling declarados: 5 iterações, throttling nenhum', () => {
      const fixture = montar({ cenario: { ...CENARIO_TESTE, execucao: undefined } });
      expect(porId<HTMLInputElement>(fixture, 'confirmacao-iteracoes').value).toBe('5');
      expect(porId(fixture, 'confirmacao-throttling').textContent).toContain('nenhum');
    });

    it('confirmar emite o modo, a seleção, as iterações alteradas e a versão do build', () => {
      const fixture = montar({ cenario: CENARIO_TESTE, selecaoCenario: ['processamento', 'erros-pagina'] });
      const emitidas: AnaliseConfirmada[] = [];
      fixture.componentInstance.confirmar.subscribe((analise) => emitidas.push(analise));

      digitar(fixture, 'confirmacao-iteracoes', '10');
      digitar(fixture, 'confirmacao-versao-build', '  1.4.2 ');
      porId(fixture, 'confirmar').click();

      expect(emitidas).toEqual([
        { modo: 'cenario', selecao: ['processamento', 'erros-pagina'], iteracoes: 10, versaoBuild: '1.4.2' },
      ]);
    });

    it('sem versão do build, o campo não é enviado', () => {
      const fixture = montar({ cenario: CENARIO_TESTE });
      const emitidas: AnaliseConfirmada[] = [];
      fixture.componentInstance.confirmar.subscribe((analise) => emitidas.push(analise));
      porId(fixture, 'confirmar').click();

      expect(emitidas).toEqual([{ modo: 'cenario', selecao: ['processamento', 'carregamento'], iteracoes: 20 }]);
    });

    it.each(['0', '-2', '1.5', '', 'abc'])('iterações inválidas (%j) impedem a execução', (valor) => {
      const fixture = montar({ cenario: CENARIO_TESTE });
      digitar(fixture, 'confirmacao-iteracoes', valor);

      expect(porId<HTMLButtonElement>(fixture, 'confirmar').disabled).toBe(true);
      expect(porId(fixture, 'confirmacao-impedimento').textContent).toContain('número inteiro de iterações');
    });

    describe('aviso de memória', () => {
      const COM_MEMORIA: Cenario = {
        ...CENARIO_TESTE,
        passos: [
          { tipo: 'forcar_gc' },
          { tipo: 'snapshot', rotulo: 'inicio' },
          { tipo: 'repetir', vezes: 'iteracoes', passos: [{ tipo: 'clicar', seletor: '#abrir' }, { tipo: 'medir', metricas: ['heap_usado'] }] },
          { tipo: 'snapshot', rotulo: 'fim' },
        ],
      };
      const TUDO: Selecao = ['processamento', 'carregamento', 'erros-pagina', 'memoria', 'dom-listeners', 'cpu'];

      it('oferece "Memória" e "DOM e listeners" entre as verificações', () => {
        const fixture = montar({ cenario: COM_MEMORIA, selecaoCenario: TUDO });
        expect(porId<HTMLInputElement>(fixture, 'verificacao-memoria').checked).toBe(true);
        expect(porId<HTMLInputElement>(fixture, 'verificacao-dom-listeners').checked).toBe(true);
        expect(fixture.nativeElement.textContent).toContain('Memória');
        expect(fixture.nativeElement.textContent).toContain('DOM e listeners');
        expect(existe(fixture, 'confirmacao-aviso-memoria')).toBe(false);
      });

      it('oferece "CPU" entre as verificações', () => {
        const fixture = montar({ cenario: COM_MEMORIA, selecaoCenario: TUDO });
        expect(porId<HTMLInputElement>(fixture, 'verificacao-cpu').checked).toBe(true);
        expect(fixture.nativeElement.textContent).toContain('CPU');
      });

      it('desmarcar "Memória" avisa que o vazamento não será confirmado, sem bloquear a execução', () => {
        const fixture = montar({ cenario: COM_MEMORIA, selecaoCenario: TUDO });
        const confirmadas: AnaliseConfirmada[] = [];
        fixture.componentInstance.confirmar.subscribe((analise) => confirmadas.push(analise));

        porId<HTMLInputElement>(fixture, 'verificacao-memoria').click();
        fixture.detectChanges();

        expect(porId(fixture, 'confirmacao-aviso-memoria').textContent).toContain('um vazamento não será confirmado');
        expect(existe(fixture, 'confirmacao-impedimento')).toBe(false);
        expect(porId<HTMLButtonElement>(fixture, 'confirmar').disabled).toBe(false);

        porId<HTMLButtonElement>(fixture, 'confirmar').click();
        expect(confirmadas).toEqual([
          expect.objectContaining({ modo: 'cenario', selecao: ['processamento', 'carregamento', 'erros-pagina', 'dom-listeners', 'cpu'] }),
        ]);

        // Marcar de novo tira o aviso.
        porId<HTMLInputElement>(fixture, 'verificacao-memoria').click();
        fixture.detectChanges();
        expect(existe(fixture, 'confirmacao-aviso-memoria')).toBe(false);
      });

      it('cenário sem passos de memória não avisa', () => {
        const fixture = montar({ cenario: CENARIO_TESTE, selecaoCenario: ['processamento'] });
        expect(existe(fixture, 'confirmacao-aviso-memoria')).toBe(false);
      });

      it('na sessão manual o aviso não se aplica', () => {
        const fixture = montar({ cenario: COM_MEMORIA, selecaoCenario: ['processamento'] });
        expect(existe(fixture, 'confirmacao-aviso-memoria')).toBe(true);
        porId<HTMLInputElement>(fixture, 'modo-manual').click();
        fixture.detectChanges();
        expect(existe(fixture, 'confirmacao-aviso-memoria')).toBe(false);
      });
    });

    it('trocar para sessão manual esconde o resumo do cenário e usa a seleção da sessão manual', () => {
      const fixture = montar({ cenario: CENARIO_TESTE, selecaoInicial: ['carregamento'], selecaoCenario: ['processamento'] });
      const emitidas: AnaliseConfirmada[] = [];
      fixture.componentInstance.confirmar.subscribe((analise) => emitidas.push(analise));
      expect(porId<HTMLInputElement>(fixture, 'verificacao-processamento').checked).toBe(true);

      porId(fixture, 'modo-manual').click();
      fixture.detectChanges();

      expect(porId(fixture, 'confirmacao-modo').textContent).toContain('Sessão manual');
      expect(existe(fixture, 'confirmacao-cenario')).toBe(false);
      expect(existe(fixture, 'confirmacao-iteracoes')).toBe(false);
      expect(porId<HTMLInputElement>(fixture, 'verificacao-processamento').checked).toBe(false);
      expect(porId<HTMLInputElement>(fixture, 'verificacao-carregamento').checked).toBe(true);

      porId(fixture, 'confirmar').click();
      expect(emitidas).toEqual([{ modo: 'manual', selecao: ['carregamento'] }]);
    });
  });
});
