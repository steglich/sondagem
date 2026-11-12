import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { BYTES_POR_MB, CONFIGURACAO_PADRAO, type RegistroExecucao } from '../../../../shared/historico';
import type { ResultadoSessao } from '../../../../shared/types';
import { PonteSimulada, RESULTADO_CENARIO_FIXO, RESULTADO_FIXO, registroDe } from '../sessao/apoio-teste';
import { PonteExtensao } from '../sessao/ponte';
import { Historico } from './historico';

/** Execução concluída do cenário, com a mediana de duração dada. */
function execucao(id: string, inicio: number, duracao: number, parcial: Partial<RegistroExecucao> = {}): RegistroExecucao {
  const cenario = RESULTADO_CENARIO_FIXO.cenario!;
  const resultado: ResultadoSessao = {
    ...RESULTADO_CENARIO_FIXO,
    id,
    inicio,
    cenario: { ...cenario, estatisticas: cenario.estatisticas.map((e) => (e.id === 'duracao-iteracao' ? { ...e, mediana: duracao } : e)) },
  };
  return registroDe(resultado, { id, inicio, ...parcial });
}

describe('Historico', () => {
  let ponte: PonteSimulada;
  let fixture: ComponentFixture<Historico>;
  const abertas: string[] = [];
  const removidas: string[] = [];

  beforeEach(() => {
    ponte = new PonteSimulada();
    abertas.length = 0;
    removidas.length = 0;
    TestBed.configureTestingModule({ providers: [{ provide: PonteExtensao, useValue: ponte }] });
  });

  async function assentar(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    fixture.detectChanges();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    fixture.detectChanges();
  }

  async function abrir(): Promise<void> {
    fixture = TestBed.createComponent(Historico);
    fixture.componentInstance.abrir.subscribe((id) => abertas.push(id));
    fixture.componentInstance.removida.subscribe((id) => removidas.push(id));
    fixture.detectChanges();
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

  function preencher(id: string, valor: string): void {
    const campo = porId<HTMLInputElement>(id);
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  describe('lista', () => {
    it('sem nada guardado, diz que está vazio', async () => {
      await abrir();
      expect(existe('historico-vazio')).toBe(true);
      expect(porId('historico-uso').textContent).toContain('0 análises guardadas');
      expect(existe('historico-aviso-limite')).toBe(false);
    });

    it('lista as análises da mais recente para a mais antiga, com o tipo e a situação', async () => {
      ponte.historico = [
        registroDe(RESULTADO_FIXO, { id: 'manual', inicio: 1000 }),
        execucao('cenario', 3000, 1400),
        execucao('quebrada', 2000, 1400, { estado: 'erro' }),
      ];
      await abrir();

      expect(textos('execucao-nome')).toEqual(['abrir-fechar', 'abrir-fechar', 'Sessão manual']);
      expect(textos('execucao-estado')).toEqual(['Concluída', 'Erro na execução', 'Concluída']);
      expect(porId('historico-uso').textContent).toContain('3 análises guardadas');
    });

    it.each([
      ['interrompida', 'Interrompida'],
      ['cancelada', 'Cancelada'],
      ['erro', 'Erro na execução'],
    ] as const)('resultado %s aparece marcado como tal e como parcial, sem servir de referência', async (estado, rotulo) => {
      ponte.historico = [execucao('parcial', 2000, 1400, { estado }), execucao('boa', 1000, 1400)];
      await abrir();

      expect(textos('execucao-estado')).toEqual([rotulo, 'Concluída']);
      const [parcial, boa] = Array.from(raiz().querySelectorAll('[data-testid="execucao"]'));
      expect(parcial!.querySelector('[data-testid="execucao-parcial"]')?.textContent).toContain('não serve de referência');
      expect(parcial!.querySelector('[data-testid="execucao-estado"]')?.classList.contains('parcial')).toBe(true);
      expect(boa!.querySelector('[data-testid="execucao-parcial"]')).toBeNull();
    });

    it('execução com falha de sessão é identificada como falha de sessão', async () => {
      const registro = execucao('sessao', 1000, 1400, { estado: 'erro' });
      registro.resumo!.cenario!.falhaDeSessao = { url: 'http://localhost:4300/login', iteracao: 6 };
      ponte.historico = [registro];
      await abrir();
      expect(textos('execucao-estado')).toEqual(['Falha de sessão']);
      expect(existe('execucao-parcial')).toBe(true);
    });

    it('execução truncada é sinalizada', async () => {
      ponte.historico = [execucao('cheia', 1000, 1400, { truncado: ['longTasks'] })];
      await abrir();
      expect(porId('execucao-truncada').textContent).toContain('Listas detalhadas removidas');
    });

    it('"Abrir" pede o resultado daquela execução', async () => {
      ponte.historico = [execucao('a', 1000, 1400)];
      await abrir();
      porId('abrir-execucao-a').click();
      expect(abertas).toEqual(['a']);
    });

    it('remove uma execução individualmente', async () => {
      ponte.historico = [execucao('a', 2000, 1400), execucao('b', 1000, 1400)];
      await abrir();
      porId('remover-execucao-a').click();
      await assentar();

      expect(ponte.historico.map((r) => r.id)).toEqual(['b']);
      expect(textos('execucao')).toHaveLength(1);
      expect(removidas).toEqual(['a']);
    });

    it('análise em andamento não pode ser aberta nem removida', async () => {
      ponte.historico = [execucao('rodando', 1000, 1400, { estado: 'em-andamento' })];
      await abrir();
      expect(textos('execucao-estado')).toEqual(['Em andamento']);
      expect(porId<HTMLButtonElement>('abrir-execucao-rodando').disabled).toBe(true);
      expect(porId<HTMLButtonElement>('remover-execucao-rodando').disabled).toBe(true);
    });

    it('relê a lista quando uma nova análise termina', async () => {
      await abrir();
      expect(existe('historico-vazio')).toBe(true);

      ponte.historico = [execucao('nova', 1000, 1400)];
      fixture.componentRef.setInput('versao', 'nova');
      await assentar();
      expect(textos('execucao-nome')).toEqual(['abrir-fechar']);
    });
  });

  describe('limite do histórico', () => {
    const comTamanho = (id: string, inicio: number, megabytes: number): RegistroExecucao => execucao(id, inicio, 1400, { tamanho: megabytes * BYTES_POR_MB });

    it('abaixo de 80% do limite não avisa', async () => {
      ponte.historico = [comTamanho('a', 1000, 399)];
      await abrir();
      expect(existe('historico-aviso-limite')).toBe(false);
    });

    it('em 80% do limite: avisa e oferece a remoção das execuções mais antigas', async () => {
      ponte.historico = Array.from({ length: 12 }, (_, i) => comTamanho(`e${i + 1}`, (i + 1) * 1000, i === 0 ? 400 : 0.001));
      await abrir();

      expect(porId('historico-aviso-limite').textContent).toContain('80%');
      expect(porId('historico-aviso-limite').textContent).toContain('Remova execuções antigas');
      expect(porId('remover-antigas').textContent).toContain('Remover as 10 mais antigas');

      porId('remover-antigas').click();
      await assentar();
      // Ficam as duas mais recentes; a que ocupava o espaço era a mais antiga.
      expect(ponte.historico.map((r) => r.id).sort()).toEqual(['e11', 'e12']);
      expect(removidas).toHaveLength(10);
      expect(existe('historico-aviso-limite')).toBe(false);
    });

    it('no limite: explica que as novas análises ficam só com as estatísticas', async () => {
      ponte.historico = [comTamanho('a', 1000, 500)];
      await abrir();
      expect(porId('historico-aviso-limite').textContent).toContain('só com as estatísticas');
    });

    it('o aviso segue o limite configurado', async () => {
      ponte.configuracao = { ...CONFIGURACAO_PADRAO, limiteHistoricoMb: 100 };
      ponte.historico = [comTamanho('a', 1000, 85)];
      await abrir();
      expect(porId('historico-aviso-limite').textContent).toContain('85%');
    });
  });

  describe('variação entre execuções', () => {
    it('três execuções com variação acima do limite: a métrica é sinalizada como instável', async () => {
      ponte.historico = [execucao('a', 1000, 1000), execucao('b', 2000, 1400), execucao('c', 3000, 1800)];
      await abrir();

      const linhas = textos('variacao-metrica');
      expect(linhas.find((l) => l.startsWith('Duração da iteração'))).toMatch(/28\.6% instável$/);
      expect(existe('metrica-instavel')).toBe(true);
      expect(porId('variacao').textContent).toContain('3 execuções');
    });

    it('variação dentro do limite não é sinalizada', async () => {
      ponte.historico = [execucao('a', 1000, 1400), execucao('b', 2000, 1410), execucao('c', 3000, 1390)];
      await abrir();
      expect(textos('variacao-metrica').find((l) => l.startsWith('Duração da iteração'))).toMatch(/0\.7%$/);
      expect(existe('metrica-instavel')).toBe(false);
    });

    it('resultado parcial não entra na variação', async () => {
      ponte.historico = [execucao('a', 1000, 1400), execucao('b', 2000, 9000, { estado: 'interrompida' })];
      await abrir();
      expect(existe('variacao')).toBe(false);
    });
  });

  describe('configuração', () => {
    it('abre com os valores salvos', async () => {
      await abrir();
      expect(porId<HTMLInputElement>('config-limite-execucao').value).toBe('20');
      expect(porId<HTMLInputElement>('config-limite-historico').value).toBe('500');
      expect(porId<HTMLInputElement>('config-maximo-por-cenario').value).toBe('50');
      expect(porId<HTMLInputElement>('config-idade-maxima').value).toBe('');
      expect(porId<HTMLInputElement>('config-limite-variacao').value).toBe('10');
    });

    it('salva a política de retenção por quantidade e por idade, e os limites', async () => {
      await abrir();
      preencher('config-limite-execucao', '5');
      preencher('config-limite-historico', '100');
      preencher('config-maximo-por-cenario', '');
      preencher('config-idade-maxima', '30');
      preencher('config-limite-variacao', '15');
      porId('salvar-config').click();
      await assentar();

      expect(ponte.configuracao).toEqual({
        limiteExecucaoMb: 5,
        limiteHistoricoMb: 100,
        retencao: { maximoPorCenario: null, idadeMaximaDias: 30 },
        limiteVariacao: 15,
      });
      expect(existe('config-salva')).toBe(true);
    });

    it.each([
      ['config-limite-execucao', '0', 'O limite por execução deve ser um número maior que zero.'],
      ['config-limite-historico', '', 'O limite do histórico deve ser um número maior que zero.'],
      ['config-limite-execucao', '900', 'O limite por execução não pode ser maior que o do histórico.'],
      ['config-maximo-por-cenario', '2.5', 'A quantidade por cenário deve ser um número inteiro maior que zero, ou vazia.'],
      ['config-idade-maxima', '-1', 'A idade máxima deve ser um número inteiro de dias maior que zero, ou vazia.'],
      ['config-limite-variacao', '0', 'A variação máxima deve ser um número maior que zero.'],
    ])('valor inválido em %s (%j): mostra o erro e não grava', async (campo, valor, mensagem) => {
      await abrir();
      preencher(campo, valor);
      porId('salvar-config').click();
      await assentar();

      expect(porId('config-erro').textContent).toContain(mensagem);
      expect(ponte.configuracao).toEqual(CONFIGURACAO_PADRAO);
      expect(existe('config-salva')).toBe(false);
    });

    it('o novo limite de variação vale na hora para a sinalização', async () => {
      ponte.historico = [execucao('a', 1000, 1000), execucao('b', 2000, 1100), execucao('c', 3000, 1200)];
      await abrir();
      // Variação de 9,1%: dentro dos 10% padrão.
      expect(existe('metrica-instavel')).toBe(false);

      preencher('config-limite-variacao', '5');
      porId('salvar-config').click();
      await assentar();
      expect(existe('metrica-instavel')).toBe(true);
    });
  });
});
