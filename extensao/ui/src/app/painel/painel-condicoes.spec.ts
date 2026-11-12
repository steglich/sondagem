import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CENARIO_TESTE, PonteSimulada, RESULTADO_CENARIO_FIXO, RESULTADO_FIXO, VISAO_OCIOSA, registroDe } from '../sessao/apoio-teste';
import { PonteExtensao } from '../sessao/ponte';
import { Painel } from './painel';

describe('Painel: condições, limpeza e histórico', () => {
  let ponte: PonteSimulada;
  let fixture: ComponentFixture<Painel>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    ponte = new PonteSimulada();
    TestBed.configureTestingModule({ providers: [{ provide: PonteExtensao, useValue: ponte }] });
  });

  afterEach(() => vi.useRealTimers());

  async function assentar(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 10; j++) await Promise.resolve();
      fixture.detectChanges();
    }
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
  const existe = (id: string): boolean => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`) !== null;

  async function clicar(id: string): Promise<void> {
    porId(id).click();
    await assentar();
  }

  const iniciar = () => ponte.comandos.find((c) => c.tipo === 'iniciar');

  it('sessão manual sem escolha: o comando vai sem throttling', async () => {
    await abrir();
    await clicar('analisar');
    await clicar('confirmar');
    expect(iniciar()).toEqual({ tipo: 'iniciar', idAba: 5, selecao: ['processamento', 'carregamento'] });
  });

  it('sessão manual com um perfil salvo escolhido: o comando leva o nome do perfil', async () => {
    ponte.perfis.set('celular-antigo', { nome: 'celular-antigo', cpu: 6, rede: null });
    await abrir();
    await clicar('analisar');
    const seletor = porId<HTMLSelectElement>('throttling-manual');
    seletor.value = 'celular-antigo';
    seletor.dispatchEvent(new Event('change'));
    await assentar();
    await clicar('confirmar');
    expect(iniciar()).toMatchObject({ tipo: 'iniciar', throttling: 'celular-antigo' });
    expect(iniciar()).not.toHaveProperty('cenario');
  });

  it('cenário com `limpar_storage`: sem confirmar não inicia; confirmado, envia os tipos', async () => {
    ponte.cenarios.set('abrir-fechar', { ...CENARIO_TESTE, limpar_storage: ['local_storage'] });
    ponte.cenarioSelecionado = 'abrir-fechar';
    await abrir();
    await clicar('analisar');

    expect(porId('confirmacao-tipos-storage').textContent).toContain('localStorage');
    await clicar('confirmar');
    expect(iniciar()).toBeUndefined();

    await clicar('confirmar-limpeza-storage');
    await clicar('confirmar');
    expect(iniciar()).toMatchObject({ tipo: 'iniciar', cenario: { storageConfirmado: ['local_storage'] } });
    expect(iniciar()).not.toHaveProperty('throttling');
  });

  it('cenário sem `limpar_storage`: o pedido não leva nenhum tipo confirmado', async () => {
    ponte.cenarios.set('abrir-fechar', CENARIO_TESTE);
    ponte.cenarioSelecionado = 'abrir-fechar';
    await abrir();
    await clicar('analisar');
    await clicar('confirmar');
    const comando = iniciar();
    expect(comando?.tipo === 'iniciar' && comando.cenario).not.toHaveProperty('storageConfirmado');
  });

  it('a confirmação alerta sobre as outras extensões ativas, consultadas a cada "Analisar"', async () => {
    await abrir();
    await clicar('analisar');
    expect(existe('confirmacao-aviso-extensoes')).toBe(false);
    await clicar('desistir');

    ponte.extensoes = [{ id: 'a', nome: 'Bloqueador' }];
    await clicar('analisar');
    expect(porId('confirmacao-aviso-extensoes').textContent).toContain('Bloqueador');
    await clicar('confirmar');
    expect(iniciar()).toBeDefined();
  });

  it('ocioso, mostra o histórico e a tela de perfis', async () => {
    ponte.historico = [registroDe(RESULTADO_CENARIO_FIXO)];
    await abrir();
    expect(porId('execucao-nome').textContent).toContain('abrir-fechar');
    expect(existe('salvar-perfil')).toBe(true);
  });

  it('abre um resultado do histórico no lugar do último, e volta', async () => {
    ponte.visao = { ...VISAO_OCIOSA, resultado: RESULTADO_FIXO };
    ponte.historico = [registroDe(RESULTADO_FIXO), registroDe(RESULTADO_CENARIO_FIXO)];
    ponte.resultados.set(RESULTADO_CENARIO_FIXO.id, RESULTADO_CENARIO_FIXO);
    await abrir();
    expect(porId('resultado-tipo').textContent).toContain('Sessão manual');

    await clicar(`abrir-execucao-${RESULTADO_CENARIO_FIXO.id}`);
    expect(porId('resultado-tipo').textContent).toContain('Cenário');
    expect(existe('resultado-do-historico')).toBe(true);

    await clicar('fechar-resultado');
    expect(porId('resultado-tipo').textContent).toContain('Sessão manual');
    expect(existe('resultado-do-historico')).toBe(false);
  });

  it('remover do histórico a execução aberta volta ao último resultado', async () => {
    ponte.visao = { ...VISAO_OCIOSA, resultado: RESULTADO_FIXO };
    ponte.historico = [registroDe(RESULTADO_CENARIO_FIXO)];
    ponte.resultados.set(RESULTADO_CENARIO_FIXO.id, RESULTADO_CENARIO_FIXO);
    await abrir();
    await clicar(`abrir-execucao-${RESULTADO_CENARIO_FIXO.id}`);
    expect(existe('resultado-do-historico')).toBe(true);

    await clicar(`remover-execucao-${RESULTADO_CENARIO_FIXO.id}`);
    expect(existe('resultado-do-historico')).toBe(false);
    expect(porId('resultado-tipo').textContent).toContain('Sessão manual');
  });
});
