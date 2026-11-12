import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { BOM, type ExportacaoJson } from '../../../../shared/exportacao';
import type { RegistroExecucao } from '../../../../shared/historico';
import { RESULTADO_FIXO } from '../sessao/apoio-teste';
import { type Ambiente, assentar, consultas, prepararAmbiente, resultadoDeCenario } from './apoio-teste';
import { Exportar } from './exportar';

describe('Exportar', () => {
  let ambiente: Ambiente;
  let fixture: ComponentFixture<Exportar>;
  const c = consultas(() => fixture);

  beforeEach(() => {
    ambiente = prepararAmbiente();
  });

  async function abrir(registro: RegistroExecucao): Promise<void> {
    fixture = TestBed.createComponent(Exportar);
    fixture.componentRef.setInput('registro', registro);
    fixture.detectChanges();
    await assentar(fixture);
  }

  it('"Exportar JSON" baixa um arquivo com a versão do formato, o registro e os detalhes', async () => {
    const registro = ambiente.ponte.guardar(resultadoDeCenario('exec-1'), { versaoBuild: '1.5.0' });
    await abrir(registro);
    // Nada é lido antes do clique.
    expect(ambiente.ponte.leiturasDeDetalhes).toEqual([]);
    await c.clicar('exportar-json');

    expect(ambiente.ponte.baixados).toHaveLength(1);
    const [arquivo] = ambiente.ponte.baixados;
    expect(arquivo!.nome).toMatch(/^sondagem_abrir-fechar_1\.5\.0_\d{4}-\d{2}-\d{2}_\d{4}\.json$/);
    expect(arquivo!.tipo).toBe('application/json');
    const exportado = JSON.parse(arquivo!.conteudo) as ExportacaoJson;
    expect(exportado.versao_exportacao).toBe(1);
    expect(exportado.execucao).toEqual(registro);
    expect(exportado.detalhes).toEqual(ambiente.ponte.resultados.get('exec-1')!.dados);
  });

  it('"Exportar CSV" baixa as medições por iteração, com o separador escolhido', async () => {
    const registro = ambiente.ponte.guardar(resultadoDeCenario('exec-1'));
    await abrir(registro);
    await c.clicar('exportar-csv');
    const [arquivo] = ambiente.ponte.baixados;
    expect(arquivo!.nome).toMatch(/^sondagem_abrir-fechar_1\.4\.2_.*\.csv$/);
    expect(arquivo!.tipo).toBe('text/csv;charset=utf-8');
    expect(arquivo!.conteudo.startsWith(BOM)).toBe(true);
    const linhas = arquivo!.conteudo.slice(1).trimEnd().split('\r\n');
    expect(linhas).toHaveLength(4);
    expect(linhas[0]).toContain('Duração da iteração (ms)');
    expect(linhas[1]).toBe('1,sim,1000,120,1,,0,0');

    await c.preencher('separador-csv', ';');
    await c.clicar('exportar-csv');
    expect(ambiente.ponte.baixados[1]!.conteudo.slice(1).split('\r\n')[1]).toBe('1;sim;1000;120;1;;0;0');
  });

  it('sessão manual: só o JSON, porque não há iterações para o CSV', async () => {
    const registro = ambiente.ponte.guardar({ ...RESULTADO_FIXO, id: 'manual-1' });
    await abrir(registro);
    expect(c.existe('exportar-json')).toBe(true);
    expect(c.existe('exportar-csv')).toBe(false);
    await c.clicar('exportar-json');
    expect(ambiente.ponte.baixados[0]!.nome).toMatch(/^sondagem_sessao-manual_\d{4}-/);
  });

  it('detalhes que não existem mais: avisa e não baixa nada', async () => {
    const registro = ambiente.ponte.guardar(resultadoDeCenario('exec-1'));
    ambiente.ponte.resultados.delete('exec-1');
    await abrir(registro);
    await c.clicar('exportar-json');
    expect(c.texto('exportar-erro')).toContain('não estão mais no histórico');
    expect(ambiente.ponte.baixados).toEqual([]);
  });
});
