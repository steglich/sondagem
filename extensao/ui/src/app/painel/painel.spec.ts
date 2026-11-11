import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PonteSimulada, RESULTADO_FIXO, URL_TESTE, VISAO_OCIOSA, visaoAtiva } from '../sessao/apoio-teste';
import { PonteExtensao } from '../sessao/ponte';
import { Painel } from './painel';

describe('Painel', () => {
  let ponte: PonteSimulada;
  let fixture: ComponentFixture<Painel>;

  beforeEach(() => {
    // Só os temporizadores são simulados: as promessas da ponte resolvem normalmente.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    ponte = new PonteSimulada();
    TestBed.configureTestingModule({ providers: [{ provide: PonteExtensao, useValue: ponte }] });
  });

  afterEach(() => vi.useRealTimers());

  /** Deixa as promessas pendentes resolverem e redesenha. */
  async function assentar(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.detectChanges();
  }

  async function abrir(): Promise<void> {
    fixture = TestBed.createComponent(Painel);
    await assentar();
  }

  function porId<T extends HTMLElement>(id: string): T {
    const elemento = (fixture.nativeElement as HTMLElement).querySelector<T>(`[data-testid="${id}"]`);
    if (!elemento) throw new Error(`data-testid="${id}" não encontrado`);
    return elemento;
  }

  function existe(id: string): boolean {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`) !== null;
  }

  async function clicar(id: string): Promise<void> {
    porId(id).click();
    await assentar();
  }

  describe('acionamento', () => {
    it('abrir o painel só consulta o estado: nenhuma análise começa', async () => {
      await abrir();
      expect(ponte.comandos).toEqual([{ tipo: 'obter-visao' }]);
      expect(existe('analisar')).toBe(true);
      expect(existe('confirmar')).toBe(false);
    });

    it('"Analisar" abre a confirmação com a URL, o modo e as verificações, ainda sem iniciar', async () => {
      await abrir();
      await clicar('analisar');

      expect(porId('confirmacao-url').textContent).toContain(URL_TESTE);
      expect(porId('confirmacao-modo').textContent).toContain('Sessão manual');
      expect(existe('verificacao-processamento')).toBe(true);
      expect(existe('verificacao-carregamento')).toBe(true);
      expect(ponte.comandos.some((c) => c.tipo === 'iniciar')).toBe(false);
    });

    it('desistir na confirmação não inicia nada', async () => {
      await abrir();
      await clicar('analisar');
      await clicar('desistir');

      expect(ponte.comandos.some((c) => c.tipo === 'iniciar')).toBe(false);
      expect(existe('analisar')).toBe(true);
    });

    it('confirmar inicia a sessão na aba alvo com a seleção marcada', async () => {
      await abrir();
      await clicar('analisar');
      await clicar('verificacao-processamento');
      await clicar('confirmar');

      expect(ponte.comandos.at(-1)).toEqual({ tipo: 'iniciar', idAba: 5, selecao: ['carregamento'] });
      expect(existe('parar')).toBe(true);
      expect(existe('cancelar')).toBe(true);
    });

    it('sem verificação marcada, confirmar fica desabilitado e nada é enviado', async () => {
      await abrir();
      await clicar('analisar');
      await clicar('verificacao-processamento');
      await clicar('verificacao-carregamento');

      expect(porId<HTMLButtonElement>('confirmar').disabled).toBe(true);
      await clicar('confirmar');
      expect(ponte.comandos.some((c) => c.tipo === 'iniciar')).toBe(false);
    });

    it('informa quando já há uma análise em andamento', async () => {
      ponte.recusaAoIniciar = {
        ok: false,
        motivo: 'sessao-ativa',
        mensagem: 'Já existe uma análise em andamento.',
        visao: VISAO_OCIOSA,
      };
      await abrir();
      await clicar('analisar');
      await clicar('confirmar');

      expect(porId('erro').textContent).toContain('Já existe uma análise em andamento.');
      expect(existe('parar')).toBe(false);
    });

    it('com sessão já ativa ao abrir, mostra a sessão em vez do botão "Analisar"', async () => {
      ponte.visao = visaoAtiva({ longTasks: 3 });
      await abrir();
      expect(existe('analisar')).toBe(false);
      expect(porId('status-long-tasks').textContent).toBe('3');
    });
  });

  describe('URLs não suportadas', () => {
    it.each(['chrome://extensions', 'chrome-extension://abc/index.html', 'https://chromewebstore.google.com/'])(
      'bloqueia o início em %s com mensagem clara',
      async (url) => {
        ponte.aba = { id: 9, url };
        await abrir();
        await clicar('analisar');

        expect(porId<HTMLButtonElement>('confirmar').disabled).toBe(true);
        expect(porId('confirmacao-impedimento').textContent?.trim()).not.toBe('');
        await clicar('confirmar');
        expect(ponte.comandos.some((c) => c.tipo === 'iniciar')).toBe(false);
      },
    );

    it('bloqueia quando a aba não pôde ser identificada', async () => {
      ponte.aba = null;
      await abrir();
      await clicar('analisar');

      expect(porId<HTMLButtonElement>('confirmar').disabled).toBe(true);
      expect(porId('confirmacao-impedimento').textContent).toContain('Não foi possível identificar a aba');
    });
  });

  describe('memória da seleção', () => {
    it('a seleção confirmada volta marcada na próxima confirmação', async () => {
      await abrir();
      await clicar('analisar');
      await clicar('verificacao-processamento');
      await clicar('confirmar');
      expect(ponte.selecoes.get('manual')).toEqual(['carregamento']);

      await clicar('parar');
      await clicar('analisar');

      expect(porId<HTMLInputElement>('verificacao-processamento').checked).toBe(false);
      expect(porId<HTMLInputElement>('verificacao-carregamento').checked).toBe(true);
    });

    it('sem seleção salva, abre com tudo marcado', async () => {
      await abrir();
      await clicar('analisar');
      expect(porId<HTMLInputElement>('verificacao-processamento').checked).toBe(true);
      expect(porId<HTMLInputElement>('verificacao-carregamento').checked).toBe(true);
    });
  });

  describe('sessão ativa', () => {
    async function iniciar(): Promise<void> {
      await abrir();
      await clicar('analisar');
      await clicar('confirmar');
    }

    it('o status não é atualizado mais de uma vez por segundo', async () => {
      await iniciar();
      const exibidos: string[] = [porId('status-long-tasks').textContent ?? ''];
      const registrar = (): void => {
        fixture.detectChanges();
        const atual = porId('status-long-tasks').textContent ?? '';
        if (atual !== exibidos.at(-1)) exibidos.push(atual);
      };

      // 50 publicações por segundo durante 3 segundos.
      for (let i = 1; i <= 150; i++) {
        ponte.publicar(visaoAtiva({ longTasks: i }));
        registrar();
        vi.advanceTimersByTime(20);
        registrar();
      }

      // Valor inicial mais, no máximo, uma atualização por segundo decorrido.
      expect(exibidos.length).toBeLessThanOrEqual(1 + 3);
      expect(exibidos.length).toBeGreaterThanOrEqual(3);

      vi.advanceTimersByTime(1000);
      fixture.detectChanges();
      expect(porId('status-long-tasks').textContent).toBe('150');
    });

    it('mostra só o status resumido, sem registros detalhados', async () => {
      await iniciar();
      ponte.publicar(visaoAtiva({ longTasks: 2, piorLongTask: 312.4, interacoes: 1 }));
      vi.advanceTimersByTime(1000);
      fixture.detectChanges();

      expect(porId('status-pior-long-task').textContent).toBe('312.4 ms');
      expect(porId('status-interacoes').textContent).toBe('1');
      expect(existe('lista-long-tasks')).toBe(false);
    });

    it('"Parar" encerra e mostra o resultado com a confirmação de limpeza', async () => {
      await iniciar();
      await clicar('parar');

      expect(ponte.comandos.at(-1)).toEqual({ tipo: 'parar' });
      expect(porId('resultado-tipo').textContent).toContain('Sessão manual');
      expect(porId('limpeza-concluida').textContent).toContain('Desconexão concluída');
      expect(existe('analisar')).toBe(true);
    });

    it('"Cancelar" encerra e indica que a análise foi cancelada', async () => {
      await iniciar();
      await clicar('cancelar');

      expect(ponte.comandos.at(-1)).toEqual({ tipo: 'cancelar' });
      expect(porId('resultado-desfecho').textContent).toContain('Análise cancelada');
    });

    it('a mudança de fase publicada pelo service worker aparece na hora', async () => {
      await iniciar();
      ponte.publicar(visaoAtiva({ longTasks: 1 }));
      ponte.publicar({ ...VISAO_OCIOSA, resultado: { ...RESULTADO_FIXO, desfecho: 'interrompida' } });
      fixture.detectChanges();

      expect(porId('resultado-desfecho').textContent).toContain('Interrompida');
    });
  });

  it('deixa de ouvir o service worker quando o painel é destruído', async () => {
    await abrir();
    expect(ponte.assinantes).toBe(1);
    TestBed.resetTestingModule();
    expect(ponte.assinantes).toBe(0);
  });

  it('o botão de relatório abre o relatório', async () => {
    await abrir();
    await clicar('abrir-relatorio');
    expect(ponte.relatoriosAbertos).toBe(1);
  });
});
