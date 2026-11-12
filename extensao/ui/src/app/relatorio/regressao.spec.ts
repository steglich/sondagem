import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { RESULTADO_FIXO } from '../sessao/apoio-teste';
import { type Ambiente, assentar, comMedianas, consultas, prepararAmbiente, resultadoDeCenario } from './apoio-teste';
import { Regressao } from './regressao';

describe('Regressao', () => {
  let ambiente: Ambiente;
  let fixture: ComponentFixture<Regressao>;
  const c = consultas(() => fixture);

  beforeEach(() => {
    ambiente = prepararAmbiente();
    ambiente.ponte.guardar(comMedianas(resultadoDeCenario('base'), { 'duracao-iteracao': 1000, 'tempo-long-tasks': 100, 'pior-interacao': 120 }), {
      inicio: 1000,
      versaoBuild: '1.4.0',
    });
  });

  async function abrir(id: string): Promise<void> {
    fixture = TestBed.createComponent(Regressao);
    fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    await assentar(fixture);
  }

  const resultados = (): Record<string, string> =>
    Object.fromEntries(
      Array.from(c.raiz().querySelectorAll<HTMLElement>('[data-testid="regressao-metrica"]'), (linha) => [
        linha.dataset['metrica']!,
        linha.querySelector('[data-testid="regressao-resultado"]')!.textContent!.trim(),
      ]),
    );

  it('acima do limite: interação de 120 ms para 180 ms com limite de 20% é sinalizada como regressão', async () => {
    ambiente.ponte.guardar(comMedianas(resultadoDeCenario('nova'), { 'duracao-iteracao': 1000, 'tempo-long-tasks': 100, 'pior-interacao': 180 }), { inicio: 5000 });
    ambiente.ponte.linhasDeBase.set('abrir-fechar', { id: 'base', limites: { 'pior-interacao': 20 } });
    await abrir('nova');

    expect(c.texto('regressao')).toBe('Regressão em relação à linha de base: Pior interação por iteração (+50.0%, limite de 20%).');
    expect(c.porId('regressao').getAttribute('role')).toBe('alert');
    expect(c.existe('sem-regressao')).toBe(false);
    expect(c.texto('regressao-base')).toContain('build 1.4.0');
    expect(resultados()).toEqual({ 'duracao-iteracao': 'dentro do limite', 'tempo-long-tasks': 'dentro do limite', 'pior-interacao': 'regressão' });
  });

  it('dentro do limite em todas as métricas: indica que não houve regressão', async () => {
    ambiente.ponte.guardar(comMedianas(resultadoDeCenario('nova'), { 'duracao-iteracao': 1090, 'tempo-long-tasks': 80, 'pior-interacao': 125 }), { inicio: 5000 });
    ambiente.ponte.linhasDeBase.set('abrir-fechar', { id: 'base', limites: {} });
    await abrir('nova');
    expect(c.texto('sem-regressao')).toBe('Sem regressão em relação à linha de base.');
    expect(c.existe('regressao')).toBe(false);
    expect(Object.values(resultados())).toEqual(['dentro do limite', 'dentro do limite', 'dentro do limite']);
  });

  it('métrica ausente: aparece como "sem dado" e não conta como regressão', async () => {
    ambiente.ponte.guardar(comMedianas(resultadoDeCenario('nova'), { 'duracao-iteracao': 1000, 'tempo-long-tasks': 100, 'pior-interacao': null }), { inicio: 5000 });
    ambiente.ponte.linhasDeBase.set('abrir-fechar', { id: 'base', limites: {} });
    await abrir('nova');
    expect(c.existe('sem-regressao')).toBe(true);
    expect(resultados()['pior-interacao']).toBe('sem dado');
  });

  it('condições diferentes das da linha de base: avisa', async () => {
    const nova = resultadoDeCenario('nova');
    ambiente.ponte.guardar({ ...nova, condicoes: { ...nova.condicoes, cpu: 6 } }, { inicio: 5000 });
    ambiente.ponte.linhasDeBase.set('abrir-fechar', { id: 'base', limites: {} });
    await abrir('nova');
    expect(c.texto('regressao-condicoes')).toContain('fator de cpu');
  });

  it('cenário sem linha de base: não mostra nada', async () => {
    ambiente.ponte.guardar(resultadoDeCenario('nova'), { inicio: 5000 });
    await abrir('nova');
    expect(c.raiz().textContent!.trim()).toBe('');
  });

  it('a própria execução de referência: diz que ela é a linha de base', async () => {
    ambiente.ponte.linhasDeBase.set('abrir-fechar', { id: 'base', limites: {} });
    await abrir('base');
    expect(c.existe('e-linha-de-base')).toBe(true);
    expect(c.existe('regressao-avaliacao')).toBe(false);
  });

  it('sessão manual e resultado parcial não são avaliados', async () => {
    ambiente.ponte.linhasDeBase.set('abrir-fechar', { id: 'base', limites: {} });
    ambiente.ponte.guardar(resultadoDeCenario('parcial', { desfecho: 'interrompida' }), { inicio: 5000 });
    await abrir('parcial');
    expect(c.raiz().textContent!.trim()).toBe('');
    ambiente.ponte.guardar({ ...RESULTADO_FIXO, id: 'manual-1' });
    await abrir('manual-1');
    expect(c.raiz().textContent!.trim()).toBe('');
  });

  it('execução de referência removida do histórico: a linha de base é desfeita e o usuário é avisado', async () => {
    ambiente.ponte.guardar(resultadoDeCenario('nova'), { inicio: 5000 });
    ambiente.ponte.linhasDeBase.set('abrir-fechar', { id: 'base', limites: {} });
    await ambiente.ponte.removerExecucao('base');
    await abrir('nova');
    expect(c.texto('linha-de-base-desfeita')).toContain('foi desfeita');
    expect(ambiente.ponte.linhasDeBase.has('abrir-fechar')).toBe(false);
  });

  it('refaz a avaliação quando a linha de base muda', async () => {
    ambiente.ponte.guardar(comMedianas(resultadoDeCenario('nova'), { 'duracao-iteracao': 1150 }), { inicio: 5000 });
    ambiente.ponte.linhasDeBase.set('abrir-fechar', { id: 'base', limites: {} });
    await abrir('nova');
    expect(c.existe('regressao')).toBe(true);

    ambiente.ponte.linhasDeBase.set('abrir-fechar', { id: 'base', limites: { 'duracao-iteracao': 30 } });
    fixture.componentRef.setInput('versao', 1);
    await assentar(fixture);
    expect(c.existe('regressao')).toBe(false);
    expect(c.existe('sem-regressao')).toBe(true);
  });
});
