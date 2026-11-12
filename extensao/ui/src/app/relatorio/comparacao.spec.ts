import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOM } from '../../../../shared/exportacao';
import { RESULTADO_FIXO } from '../sessao/apoio-teste';
import { type Ambiente, assentar, comMedianas, consultas, prepararAmbiente, resultadoDeCenario } from './apoio-teste';
import { Comparacao } from './comparacao';

describe('Comparacao', () => {
  let ambiente: Ambiente;
  let fixture: ComponentFixture<Comparacao>;
  const c = consultas(() => fixture);

  beforeEach(() => {
    ambiente = prepararAmbiente();
    ambiente.ponte.guardar(comMedianas(resultadoDeCenario('a'), { 'duracao-iteracao': 1000, 'tempo-long-tasks': 200, 'pior-interacao': null }), {
      inicio: 1000,
      versaoBuild: '1.4.0',
    });
    ambiente.ponte.guardar(comMedianas(resultadoDeCenario('b'), { 'duracao-iteracao': 1100, 'tempo-long-tasks': 150, 'pior-interacao': 90 }), {
      inicio: 5000,
      versaoBuild: '1.5.0',
    });
  });

  async function abrir(idA: string, idB: string): Promise<void> {
    fixture = TestBed.createComponent(Comparacao);
    fixture.componentRef.setInput('idA', idA);
    fixture.componentRef.setInput('idB', idB);
    fixture.detectChanges();
    await assentar(fixture);
  }

  const linhas = (): string[][] =>
    Array.from(c.raiz().querySelectorAll('[data-testid="comparacao-metrica"]'), (linha) => Array.from(linha.children, (celula) => celula.textContent!.trim()));

  it('duas versões do build: mostra as versões e, por métrica, os dois valores e a diferença absoluta e percentual', async () => {
    await abrir('a', 'b');
    expect(c.texto('comparacao-cenario')).toBe('abrir-fechar');
    expect(c.texto('build-a')).toBe('1.4.0');
    expect(c.texto('build-b')).toBe('1.5.0');
    expect(linhas()).toEqual([
      ['Duração da iteração', '1000.0 ms', '1100.0 ms', '+100.0 ms', '+10.0%', 'piorou'],
      ['Tempo em long tasks por iteração', '200.0 ms', '150.0 ms', '-50.0 ms', '-25.0%', 'melhorou'],
      ['Pior interação por iteração', 'sem dado', '90.0 ms', '—', '—', 'sem dado'],
    ]);
    expect(c.existe('aviso-condicoes')).toBe(false);
    expect(c.existe('aviso-ambiente')).toBe(false);
    // Só os registros leves foram lidos.
    expect(ambiente.ponte.leiturasDeDetalhes).toEqual([]);
  });

  it('perfis de throttling diferentes: avisa que as condições diferem e lista as diferenças', async () => {
    const base = resultadoDeCenario('sem-limite');
    ambiente.ponte.guardar({ ...base, condicoes: { ...base.condicoes, perfil: 'nenhum', cpu: 1, rede: null } }, { inicio: 9000 });
    await abrir('a', 'sem-limite');
    expect(c.texto('aviso-condicoes')).toContain('As condições de teste diferem');
    expect(c.textos('diferenca-condicao')).toEqual([
      'Perfil de throttling: padrao em A, nenhum em B',
      'Fator de CPU: 4× em A, 1× em B',
      'Rede: rede com 150 ms de latência, download de 1600 kbps e upload de 750 kbps em A, sem limitação em B',
    ]);
    // A comparação é mostrada mesmo assim.
    expect(linhas()).toHaveLength(3);
  });

  it('ambiente diferente (navegador, extensões): é destacado', async () => {
    ambiente.ponte.guardar(resultadoDeCenario('outro-ambiente'), { inicio: 9000, extensoes: [{ id: 'x', nome: 'Bloqueador' }] });
    await abrir('a', 'outro-ambiente');
    expect(c.textos('diferenca-ambiente')).toEqual(['Outras extensões ativas: — em A, Bloqueador em B']);
  });

  it('cenários diferentes: a comparação é recusada, com o motivo', async () => {
    ambiente.ponte.guardar(resultadoDeCenario('checkout-1'), { grupo: 'cenario:checkout', nomeCenario: 'checkout' });
    await abrir('a', 'checkout-1');
    expect(c.texto('comparacao-recusada')).toContain('cenários diferentes ("abrir-fechar" e "checkout")');
    expect(c.existe('comparacao-metricas')).toBe(false);
    expect(c.existe('exportar-comparacao')).toBe(false);
  });

  it('resultado parcial ou sessão manual: a comparação é recusada', async () => {
    ambiente.ponte.guardar(resultadoDeCenario('parcial', { desfecho: 'interrompida' }));
    await abrir('a', 'parcial');
    expect(c.texto('comparacao-recusada')).toContain('Só execuções completas podem ser comparadas');

    ambiente.ponte.guardar({ ...RESULTADO_FIXO, id: 'manual-1' });
    await abrir('a', 'manual-1');
    expect(c.texto('comparacao-recusada')).toContain('Sessões manuais não podem ser comparadas');
  });

  it('a seleção das duas execuções lista só as completas de cenário, e trocar uma delas navega para a nova comparação', async () => {
    ambiente.ponte.guardar(resultadoDeCenario('c'), { inicio: 9000, versaoBuild: '1.6.0' });
    ambiente.ponte.guardar(resultadoDeCenario('parcial', { desfecho: 'erro' }));
    ambiente.ponte.guardar({ ...RESULTADO_FIXO, id: 'manual-1' });
    await abrir('a', 'b');

    const opcoes = (id: string): string[] => Array.from(c.porId<HTMLSelectElement>(id).options, (o) => o.value);
    expect(opcoes('execucao-a')).toEqual(['c', 'b', 'a']);
    expect(opcoes('execucao-b')).toEqual(['c', 'b', 'a']);
    expect(c.porId<HTMLSelectElement>('execucao-a').selectedOptions[0]!.textContent).toContain('build 1.4.0');
    expect(c.porId<HTMLSelectElement>('execucao-b').value).toBe('b');

    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await c.preencher('execucao-b', 'c');
    expect(navegar).toHaveBeenCalledWith(['/relatorio/comparar', 'a', 'c']);
    await c.preencher('execucao-a', 'b');
    expect(navegar).toHaveBeenLastCalledWith(['/relatorio/comparar', 'b', 'b']);
  });

  it('os parâmetros da rota mudam: a comparação é refeita', async () => {
    ambiente.ponte.guardar(comMedianas(resultadoDeCenario('c'), { 'duracao-iteracao': 500 }), { inicio: 9000, versaoBuild: '1.6.0' });
    await abrir('a', 'b');
    fixture.componentRef.setInput('idB', 'c');
    await assentar(fixture);
    expect(c.texto('build-b')).toBe('1.6.0');
    expect(linhas()[0]).toEqual(['Duração da iteração', '1000.0 ms', '500.0 ms', '-500.0 ms', '-50.0%', 'melhorou']);
  });

  it('execução que não está mais no histórico: avisa', async () => {
    await abrir('a', 'sumiu');
    expect(c.texto('comparacao-ausente')).toContain('Uma das execuções não está no histórico');
  });

  it('exporta a comparação em CSV, com o separador escolhido', async () => {
    await abrir('a', 'b');
    await c.clicar('exportar-comparacao');
    expect(ambiente.ponte.baixados).toHaveLength(1);
    const [arquivo] = ambiente.ponte.baixados;
    expect(arquivo!.nome).toMatch(/^sondagem_comparacao_abrir-fechar_1\.4\.0_vs_1\.5\.0_\d{4}-\d{2}-\d{2}_\d{4}\.csv$/);
    expect(arquivo!.tipo).toBe('text/csv;charset=utf-8');
    expect(arquivo!.conteudo.startsWith(BOM)).toBe(true);
    expect(arquivo!.conteudo.slice(1).split('\r\n')).toEqual([
      'Métrica,Unidade,A (build 1.4.0),B (build 1.5.0),Diferença,Diferença (%)',
      'Duração da iteração,ms,1000,1100,100,10',
      'Tempo em long tasks por iteração,ms,200,150,-50,-25',
      'Pior interação por iteração,ms,,90,,',
      '',
    ]);

    await c.preencher('separador-csv', ';');
    await c.clicar('exportar-comparacao');
    expect(ambiente.ponte.baixados[1]!.conteudo.slice(1).split('\r\n')[1]).toBe('Duração da iteração;ms;1000;1100;100;10');
  });
});
