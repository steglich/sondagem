import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { iteracoes } from '../../../../shared/apoio-registro';
import type { ErroPagina, Interacao, LongTask } from '../../../../shared/types';
import { RESULTADO_CPU_FIXO, RESULTADO_FIXO, RESULTADO_MEMORIA_FIXO } from '../sessao/apoio-teste';
import { type Ambiente, assentar, comMedianas, consultas, prepararAmbiente, resultadoDeCenario } from './apoio-teste';
import { Relatorio } from './relatorio';

describe('Relatorio', () => {
  let ambiente: Ambiente;
  let fixture: ComponentFixture<Relatorio>;
  const c = consultas(() => fixture);

  beforeEach(() => {
    ambiente = prepararAmbiente();
  });

  async function abrir(id?: string): Promise<void> {
    fixture = TestBed.createComponent(Relatorio);
    if (id !== undefined) fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    await assentar(fixture);
  }

  describe('cabeçalho', () => {
    it('execução concluída: metadados, condições, ambiente e o estado sem destaque de parcial', async () => {
      ambiente.ponte.guardar(resultadoDeCenario('exec-1'), { extensoes: [{ id: 'x', nome: 'Bloqueador' }] });
      await abrir('exec-1');

      expect(c.texto('relatorio-nome')).toBe('abrir-fechar');
      expect(c.texto('relatorio-estado')).toBe('Concluída');
      expect(c.porId('relatorio-estado').classList.contains('parcial')).toBe(false);
      expect(c.existe('relatorio-parcial')).toBe(false);
      expect(c.existe('relatorio-parada')).toBe(false);

      expect(c.texto('relatorio-build')).toBe('1.4.2');
      expect(c.texto('relatorio-iteracoes')).toBe('3 de 3 completas');
      expect(c.texto('relatorio-verificacoes')).toBe('Processamento, Erros da página');
      expect(c.texto('relatorio-metadados')).toContain('http://localhost:4300/');
      const condicoes = c.texto('relatorio-condicoes');
      expect(condicoes).toContain('padrao');
      expect(condicoes).toContain('CPU 4× mais lenta');
      expect(condicoes).toContain('150 ms de latência');
      expect(condicoes).toContain('desligado durante a análise, limpo antes de começar');
      const ambienteExibido = c.texto('relatorio-ambiente');
      expect(ambienteExibido).toContain('158.0.8127.18');
      expect(ambienteExibido).toContain('1280×720, densidade 2');
      expect(c.texto('relatorio-extensoes')).toBe('Bloqueador');
    });

    it('execução interrompida na iteração 8: destaca "Interrompida" e informa a iteração e o motivo', async () => {
      const feitas = iteracoes(8).map((i) => (i.numero === 8 ? { ...i, completa: false } : i));
      ambiente.ponte.guardar(
        resultadoDeCenario(
          'exec-1',
          { desfecho: 'interrompida' },
          {
            configuracao: { nome: 'abrir-fechar', urlInicial: 'http://localhost:4300/', iteracoes: 20, throttling: null, versaoBuild: null },
            estadoFinal: 'erro',
            iteracoes: feitas,
            iteracoesCompletas: 7,
            iteracoesIncompletas: 1,
            falhas: [{ caminho: '', tipoPasso: '', iteracao: 8, motivo: 'A extensão foi suspensa durante a execução.', acao: 'interrompeu' }],
          },
        ),
      );
      await abrir('exec-1');

      expect(c.texto('relatorio-estado')).toBe('Interrompida');
      expect(c.porId('relatorio-estado').classList.contains('parcial')).toBe(true);
      expect(c.existe('relatorio-parcial')).toBe(true);
      expect(c.texto('relatorio-parada')).toContain('Parou na iteração 8 de 20 (7 completas).');
      expect(c.texto('relatorio-motivo')).toBe('A extensão foi suspensa durante a execução.');
      expect(c.texto('relatorio-build')).toBe('não informada');
    });

    it('execução cancelada: destaca "Cancelada", diz onde parou e que as medições foram descartadas', async () => {
      const feitas = iteracoes(2).map((i) => (i.numero === 2 ? { ...i, completa: false } : i));
      ambiente.ponte.guardar(
        resultadoDeCenario('exec-1', { desfecho: 'cancelada' }, { estadoFinal: 'cancelada', iteracoes: feitas, iteracoesCompletas: 1, iteracoesIncompletas: 1, estatisticas: [] }),
      );
      await abrir('exec-1');

      expect(c.texto('relatorio-estado')).toBe('Cancelada');
      expect(c.porId('relatorio-estado').classList.contains('parcial')).toBe(true);
      expect(c.texto('relatorio-parada')).toContain('Parou na iteração 2 de 3 (1 completa).');
      expect(c.texto('relatorio-motivo')).toBe('Cancelada pelo usuário.');
      expect(c.texto('sem-secoes')).toContain('cancelada');
      expect(c.texto('sem-estatisticas')).toContain('descartadas');
    });

    it('execução com erro: destaca "Erro na execução" e mostra o passo que interrompeu', async () => {
      const feitas = iteracoes(3).map((i) => (i.numero === 3 ? { ...i, completa: false } : i));
      ambiente.ponte.guardar(
        resultadoDeCenario(
          'exec-1',
          { desfecho: 'erro' },
          {
            estadoFinal: 'erro',
            iteracoes: feitas,
            iteracoesCompletas: 2,
            iteracoesIncompletas: 1,
            falhas: [{ caminho: '/passos/0/passos/1', tipoPasso: 'esperar', iteracao: 3, motivo: 'Tempo limite de 5000 ms: nenhum elemento corresponde a "#x".', acao: 'interrompeu' }],
          },
        ),
      );
      await abrir('exec-1');

      expect(c.texto('relatorio-estado')).toBe('Erro na execução');
      expect(c.porId('relatorio-estado').classList.contains('parcial')).toBe(true);
      expect(c.texto('relatorio-parada')).toContain('Parou na iteração 3 de 3 (2 completas).');
      expect(c.texto('relatorio-motivo')).toContain('Tempo limite de 5000 ms');
    });

    it('falha de sessão: tem nome próprio, é parcial e não apresenta estatísticas', async () => {
      ambiente.ponte.guardar(resultadoDeCenario('exec-1', {}, { falhaDeSessao: { url: 'http://localhost:4300/login', iteracao: 3 }, estatisticas: [] }));
      await abrir('exec-1');
      expect(c.texto('relatorio-estado')).toBe('Falha de sessão');
      expect(c.porId('relatorio-estado').classList.contains('parcial')).toBe(true);
      expect(c.texto('relatorio-parada')).toContain('Parou na iteração 3');
      expect(c.texto('relatorio-motivo')).toBe('A aplicação pediu o login (http://localhost:4300/login).');
      expect(c.texto('sem-estatisticas')).toContain('login');
    });

    it('sessão manual interrompida: sem iteração, com o motivo da desconexão', async () => {
      ambiente.ponte.guardar({ ...RESULTADO_FIXO, id: 'manual-1', desfecho: 'interrompida', conexaoPerdida: 'target_closed' });
      await abrir('manual-1');
      expect(c.texto('relatorio-nome')).toBe('Sessão manual');
      expect(c.texto('relatorio-estado')).toBe('Interrompida');
      expect(c.texto('relatorio-parada')).toContain('A sessão não chegou ao fim.');
      expect(c.texto('relatorio-motivo')).toBe('O debugger foi desanexado (target_closed).');
    });
  });

  describe('abertura', () => {
    it('lê só o registro leve: os detalhes ficam para quando uma seção é aberta, e são lidos uma vez', async () => {
      ambiente.ponte.guardar(resultadoDeCenario('exec-1'));
      await abrir('exec-1');
      expect(ambiente.ponte.leiturasDeDetalhes).toEqual([]);
      // O cabeçalho e as estatísticas já estão na tela.
      expect(c.texto('relatorio-estado')).toBe('Concluída');
      expect(c.existe('estatisticas')).toBe(true);
      expect(c.existe('lista-long-tasks')).toBe(false);

      await c.alternarSecao('processamento');
      expect(ambiente.ponte.leiturasDeDetalhes).toEqual(['exec-1']);
      expect(c.existe('lista-long-tasks')).toBe(true);

      await c.alternarSecao('erros');
      expect(ambiente.ponte.leiturasDeDetalhes).toEqual(['exec-1']);
      expect(c.existe('lista-erros')).toBe(true);
    });

    it('execução que não existe mais: avisa e oferece a lista', async () => {
      await abrir('sumiu');
      expect(c.texto('relatorio-ausente')).toContain('não está no histórico');
      expect(c.existe('relatorio-estado')).toBe(false);
    });

    it('detalhes que não existem mais: a seção avisa', async () => {
      const registro = ambiente.ponte.guardar(resultadoDeCenario('exec-1'));
      ambiente.ponte.resultados.delete(registro.id);
      await abrir('exec-1');
      await c.alternarSecao('processamento');
      expect(c.texto('detalhes-falha')).toContain('não estão mais no histórico');
    });

    it('registro em um formato mais novo do que a extensão conhece: avisa', async () => {
      ambiente.ponte.guardar(resultadoDeCenario('exec-1'), { versaoFormato: 2 });
      await abrir('exec-1');
      expect(c.texto('relatorio-formato-desconhecido')).toContain('formato 2');
      ambiente.ponte.guardar(resultadoDeCenario('exec-2'));
      fixture.componentRef.setInput('id', 'exec-2');
      await assentar(fixture);
      expect(c.existe('relatorio-formato-desconhecido')).toBe(false);
    });

    it('listas truncadas pelo limite de armazenamento são informadas', async () => {
      ambiente.ponte.guardar(resultadoDeCenario('exec-1'), { truncado: ['longTasks', 'interacoes'] });
      await abrir('exec-1');
      expect(c.texto('relatorio-truncado')).toContain('long tasks, interações');
      await c.alternarSecao('processamento');
      expect(c.existe('long-tasks-truncadas')).toBe(true);
      expect(c.existe('interacoes-truncadas')).toBe(true);
    });

    it('sem id, lista as execuções do histórico com o link de cada relatório', async () => {
      await abrir();
      expect(c.texto('relatorio-vazio')).toBe('Nenhuma análise ainda.');

      ambiente.ponte.guardar(resultadoDeCenario('exec-1'), { inicio: 1000 });
      ambiente.ponte.guardar(resultadoDeCenario('exec-2'), { inicio: 2000, estado: 'interrompida' });
      await abrir();
      const itens = Array.from(c.porId('relatorio-lista').querySelectorAll('li'), (li) => li.textContent!.replace(/\s+/g, ' ').trim());
      expect(itens).toHaveLength(2);
      expect(itens[0]).toContain('Interrompida');
      expect(c.porId<HTMLAnchorElement>('relatorio-de-exec-1').getAttribute('href')).toBe('/relatorio/exec-1');
    });
  });

  describe('estatísticas', () => {
    it('mostra a mediana, o p75 e o p95 de cada métrica; sem amostra, "sem dado"', async () => {
      ambiente.ponte.guardar(resultadoDeCenario('exec-1'));
      await abrir('exec-1');
      const linhas = Array.from(c.raiz().querySelectorAll('[data-testid="estatistica"]'), (linha) =>
        Array.from(linha.querySelectorAll('th, td'), (celula) => celula.textContent!.trim()),
      );
      expect(linhas).toEqual([
        ['Duração da iteração', '1400.0 ms', '1450.5 ms', '1600.0 ms'],
        ['Tempo em long tasks por iteração', '0.0 ms', '60.0 ms', '118.3 ms'],
        ['Pior interação por iteração', 'sem dado', 'sem dado', 'sem dado'],
      ]);
    });

    it('sessão manual não tem estatísticas por iteração', async () => {
      ambiente.ponte.guardar({ ...RESULTADO_FIXO, id: 'manual-1' });
      await abrir('manual-1');
      expect(c.texto('sem-estatisticas')).toContain('Sessão manual');
      expect(c.existe('estatisticas')).toBe(false);
    });
  });

  describe('seções', () => {
    it('só aparecem as das verificações que rodaram: sem "CPU", não há seção de CPU', async () => {
      ambiente.ponte.guardar(resultadoDeCenario('exec-1', { selecao: ['processamento', 'erros-pagina'] }));
      await abrir('exec-1');
      expect(Array.from(c.raiz().querySelectorAll('details'), (d) => d.dataset['testid'])).toEqual(['secao-processamento', 'secao-erros']);
      expect(c.existe('secao-cpu')).toBe(false);
      expect(c.existe('secao-memoria')).toBe(false);
      expect(c.existe('secao-carregamento')).toBe(false);
    });

    it('todas as verificações: uma seção para cada uma, com "Memória" e "DOM e listeners" juntas', async () => {
      ambiente.ponte.guardar({ ...RESULTADO_MEMORIA_FIXO, id: 'exec-1', selecao: ['processamento', 'carregamento', 'erros-pagina', 'memoria', 'dom-listeners', 'cpu'] });
      await abrir('exec-1');
      expect(Array.from(c.raiz().querySelectorAll('details > summary'), (s) => s.textContent!.trim())).toEqual([
        'Processamento',
        'Carregamento',
        'Memória',
        'CPU',
        'Erros da página',
      ]);
    });

    it('sem nenhuma verificação com seção, diz isso', async () => {
      ambiente.ponte.guardar(resultadoDeCenario('exec-1', { selecao: [] }));
      await abrir('exec-1');
      expect(c.raiz().querySelectorAll('details')).toHaveLength(0);
      expect(c.texto('sem-secoes')).toContain('Nenhuma verificação');
      expect(c.existe('abrir-secoes')).toBe(false);
    });

    it('o gráfico não é criado com a seção fechada; é criado quando ela abre e destruído quando fecha', async () => {
      const longTasks: LongTask[] = [
        { inicio: 1100, duracao: 60, iteracao: 1 },
        { inicio: 2100, duracao: 90, iteracao: 2 },
      ];
      const interacoes: Interacao[] = [{ id: 1, documento: 'd', inicio: 3100, duracao: 48, tipo: 'click', alvo: 'button#abrir', iteracao: 3 }];
      const base = resultadoDeCenario('exec-1');
      ambiente.ponte.guardar({ ...base, dados: { ...base.dados, longTasks, interacoes } });
      await abrir('exec-1');
      expect(ambiente.graficos).toHaveLength(0);
      expect(c.existe('grafico')).toBe(false);

      await c.alternarSecao('processamento');
      expect(ambiente.graficos).toHaveLength(1);
      const [grafico] = ambiente.graficos;
      // Eixo X com as iterações, e uma série para cada métrica.
      expect(grafico!.dados).toEqual([
        [1, 2, 3],
        [60, 90, 0],
        [null, null, 48],
      ]);
      expect(grafico!.opcoes.series.map((s) => s.label)).toEqual(['Iteração', 'Tempo em long tasks', 'Pior interação']);
      expect(grafico!.opcoes.scales?.['x']?.time).toBe(false);

      await c.alternarSecao('processamento', false);
      expect(grafico!.destruido).toBe(true);
      expect(c.existe('grafico')).toBe(false);
    });

    it('"Abrir todas as seções" abre todas e lê os detalhes uma vez', async () => {
      ambiente.ponte.guardar(resultadoDeCenario('exec-1'));
      await abrir('exec-1');
      await c.clicar('abrir-secoes');
      expect(Array.from(c.raiz().querySelectorAll('details'), (d) => d.open)).toEqual([true, true]);
      expect(ambiente.ponte.leiturasDeDetalhes).toEqual(['exec-1']);
      expect(c.existe('lista-long-tasks')).toBe(true);
      expect(c.existe('lista-erros')).toBe(true);
    });
  });

  describe('seção de processamento', () => {
    it('listas de long tasks e de interações virtualizadas: milhares de itens, poucas dezenas de linhas no DOM', async () => {
      const longTasks: LongTask[] = Array.from({ length: 5000 }, (_, i) => ({ inicio: 1000 + i, duracao: 50 + (i % 7), iteracao: (i % 3) + 1 }));
      longTasks[1] = { inicio: 1500, duracao: 400, iteracao: 1, causadaPelaMedicao: true };
      const interacoes: Interacao[] = Array.from({ length: 3000 }, (_, i) => ({
        id: i,
        documento: 'd',
        inicio: 1000 + i,
        duracao: 40,
        tipo: 'click',
        alvo: `button[data-testid="acao-${i}"]`,
        iteracao: 1,
      }));
      const base = resultadoDeCenario('exec-1');
      ambiente.ponte.guardar({ ...base, dados: { ...base.dados, longTasks, interacoes } });
      await abrir('exec-1');
      await c.alternarSecao('processamento');

      const tarefas = c.linhas('lista-long-tasks');
      expect(tarefas.length).toBeGreaterThan(0);
      expect(tarefas.length).toBeLessThan(100);
      expect(tarefas[0]).toEqual(['0.00 s', '50.0 ms', '1', '']);
      expect(tarefas[1]).toEqual(['0.50 s', '400.0 ms', '1', 'pausa da medição (fora das estatísticas)']);
      expect(c.textos('lista-total', c.porId('lista-long-tasks'))).toEqual(['5000 itens']);

      const cliques = c.linhas('lista-interacoes');
      expect(cliques.length).toBeLessThan(100);
      expect(cliques[0]).toEqual(['0.00 s', '40.0 ms', '1', 'click', 'button[data-testid="acao-0"]']);
      expect(c.textos('lista-total', c.porId('lista-interacoes'))).toEqual(['3000 itens']);
    });

    it('sem long tasks nem interações, diz isso em vez de mostrar listas vazias', async () => {
      const base = resultadoDeCenario('exec-1');
      ambiente.ponte.guardar({ ...base, dados: { ...base.dados, longTasks: [], interacoes: [] } });
      await abrir('exec-1');
      await c.alternarSecao('processamento');
      expect(c.existe('sem-long-tasks')).toBe(true);
      expect(c.existe('sem-interacoes')).toBe(true);
    });

    it('sessão manual: as listas aparecem, sem gráfico por iteração', async () => {
      ambiente.ponte.guardar({ ...RESULTADO_FIXO, id: 'manual-1' });
      await abrir('manual-1');
      await c.alternarSecao('processamento');
      expect(c.texto('processamento-sem-grafico')).toContain('sessão manual não tem iterações');
      expect(ambiente.graficos).toHaveLength(0);
      expect(c.linhas('lista-long-tasks').length).toBe(RESULTADO_FIXO.dados.longTasks.length);
    });
  });

  describe('seção de memória', () => {
    it('a partir de um resultado fixo: classificação, um gráfico por métrica e os construtores por crescimento', async () => {
      ambiente.ponte.guardar({ ...RESULTADO_MEMORIA_FIXO, id: 'exec-1' });
      await abrir('exec-1');
      expect(ambiente.graficos).toHaveLength(0);
      await c.alternarSecao('memoria');

      expect(c.texto('memoria-classificacao')).toBe('Vazamento provável');
      expect(c.porId('memoria-classificacao').classList.contains('vazamento')).toBe(true);
      expect(c.texto('memoria-variacao-heap')).toBe('Heap usado: de 1.95 MB para 2.25 MB (+300.0 KB).');

      expect(ambiente.graficos.map((g) => g.opcoes.series[1]!.label)).toEqual(['Heap usado', 'Nós DOM', 'Listeners']);
      const KB = 1024;
      expect(ambiente.graficos[0]!.dados).toEqual([[1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5].map((i) => 2000 * KB + i * 60 * KB)]);
      expect(ambiente.graficos[1]!.dados[1]).toEqual([850, 1254, 1658, 2062, 2466, 2870]);
      expect(ambiente.graficos[2]!.dados[1]).toEqual([15, 15, 15, 15, 15, 15]);
      expect(c.textos('grafico').map((t) => t.replace(/\s.*$/, ''))).toHaveLength(3);

      const construtores = c.linhas('lista-construtores');
      expect(construtores[0]).toEqual(['HTMLLIElement', '200', '1400', '+1200', '']);
      expect(construtores[1]).toEqual(['Classe1', '0', '30', '+30', 'só no último censo']);
      // Ordenados pelo crescimento, do maior para o menor.
      const variacoes = construtores.map((linha) => Number(linha[3]));
      expect(variacoes).toEqual([...variacoes].sort((a, b) => b - a));
      expect(c.textos('lista-total', c.porId('lista-construtores'))).toEqual(['22 itens']);

      const dom = c.texto('memoria-dom');
      expect(dom).toContain('Nós DOM desanexados: de 203 para 1421 (+1218).');
      expect(dom).toContain('Listeners: de 15 para 15 (0).');
    });

    it('sessão manual com medições: o gráfico é ao longo do tempo, sem classificação', async () => {
      ambiente.ponte.guardar({
        ...RESULTADO_FIXO,
        id: 'manual-1',
        selecao: ['memoria'],
        dados: {
          ...RESULTADO_FIXO.dados,
          medicoes: [
            { instante: RESULTADO_FIXO.inicio, heapUsado: 1000, nosDom: null, listeners: null },
            { instante: RESULTADO_FIXO.inicio + 5000, heapUsado: 3000, nosDom: null, listeners: null },
          ],
        },
        memoria: { classificacao: null, series: [], comparacao: null, domListeners: null },
      });
      await abrir('manual-1');
      await c.alternarSecao('memoria');
      expect(c.existe('memoria-classificacao')).toBe(false);
      expect(ambiente.graficos).toHaveLength(1);
      expect(ambiente.graficos[0]!.dados).toEqual([
        [0, 5],
        [1000, 3000],
      ]);
      expect(ambiente.graficos[0]!.opcoes.series[0]!.label).toBe('Segundos desde o início');
    });
  });

  describe('seção de CPU', () => {
    it('mostra as categorias e a lista de funções por tempo próprio', async () => {
      ambiente.ponte.guardar({ ...RESULTADO_CPU_FIXO, id: 'manual-1' });
      await abrir('manual-1');
      await c.alternarSecao('cpu');

      expect(c.texto('cpu-resumo')).toBe('500.0 ms de processamento em 2000.0 ms amostrados (12000 amostras).');
      const categorias = Array.from(c.porId('cpu-categorias').querySelectorAll('tr'), (tr) =>
        Array.from(tr.children, (celula) => celula.textContent!.trim()).join(' '),
      );
      expect(categorias).toEqual(['Ocioso 1500.0 ms', 'Coleta de lixo 20.0 ms', 'Motor do navegador 50.0 ms', 'Extensões 10.0 ms']);

      const funcoes = c.linhas('lista-funcoes');
      expect(funcoes[0]).toEqual(['calculoPesado', 'http://localhost:4300/cpu-pesada.ts:4', '300.0 ms', '310.5 ms', '60.0']);
      expect(funcoes[2]).toEqual(['sort', '(nativa ou avaliada)', '12.3 ms', '12.3 ms', '2.5']);
      expect(c.textos('lista-total', c.porId('lista-funcoes'))).toEqual(['35 itens']);
      expect(c.texto('cpu-outras')).toBe('Mais 12 funções fora da lista: 3.0 ms (0.6%).');
    });

    it('perfil que falhou: mostra o motivo, sem lista', async () => {
      ambiente.ponte.guardar({
        ...RESULTADO_CPU_FIXO,
        id: 'manual-1',
        dados: { ...RESULTADO_CPU_FIXO.dados, cpu: { estado: 'falhou', ativo: false, resumo: null, falha: 'Já há um trace em andamento.', incompleto: false, limiteAtingido: false } },
      });
      await abrir('manual-1');
      await c.alternarSecao('cpu');
      expect(c.texto('cpu-falha')).toContain('Já há um trace em andamento.');
      expect(c.existe('lista-funcoes')).toBe(false);
    });
  });

  describe('seção de erros', () => {
    it('lista os erros por iteração, em ordem, com os de fora das iterações por último', async () => {
      const errosPagina: ErroPagina[] = [
        { tipo: 'rejeicao', mensagem: 'pedido recusado', arquivo: null, linha: null, coluna: null, instante: 1500, iteracao: null },
        { tipo: 'excecao', mensagem: 'Error: terceira', arquivo: 'http://localhost:4300/erros.ts', linha: 12, coluna: 9, instante: 3500, iteracao: 3 },
        { tipo: 'excecao', mensagem: 'Error: primeira', arquivo: 'http://localhost:4300/erros.ts', linha: 7, coluna: 1, instante: 2000, iteracao: 1 },
        { tipo: 'excecao', mensagem: 'Error: primeira de novo', arquivo: null, linha: null, coluna: null, instante: 1800, iteracao: 1 },
      ];
      const base = resultadoDeCenario('exec-1');
      ambiente.ponte.guardar({ ...base, dados: { ...base.dados, errosPagina } });
      await abrir('exec-1');
      await c.alternarSecao('erros');

      expect(c.texto('erros-resumo')).toBe('4 erros em 2 iterações (1 fora das iterações).');
      expect(c.linhas('lista-erros')).toEqual([
        ['1', '0.80 s', 'Exceção', 'Error: primeira de novo', '—'],
        ['1', '1.00 s', 'Exceção', 'Error: primeira', 'http://localhost:4300/erros.ts:7'],
        ['3', '2.50 s', 'Exceção', 'Error: terceira', 'http://localhost:4300/erros.ts:12'],
        ['—', '0.50 s', 'Promise rejeitada', 'pedido recusado', '—'],
      ]);
    });

    it('sem erros, diz isso', async () => {
      const base = resultadoDeCenario('exec-1');
      ambiente.ponte.guardar({ ...base, dados: { ...base.dados, errosPagina: [] } });
      await abrir('exec-1');
      await c.alternarSecao('erros');
      expect(c.texto('sem-erros')).toBe('Nenhum erro da página.');
    });
  });

  describe('linha de base e comparação', () => {
    it('sessão manual: as opções de linha de base e de comparação não estão disponíveis', async () => {
      ambiente.ponte.guardar({ ...RESULTADO_FIXO, id: 'manual-1' });
      await abrir('manual-1');
      expect(c.texto('sem-comparacao')).toContain('Sessão manual');
      expect(c.existe('marcar-linha-de-base')).toBe(false);
      expect(c.existe('comparar-com')).toBe(false);
      expect(c.existe('comparar')).toBe(false);
      expect(c.existe('regressao-avaliacao')).toBe(false);
      // A exportação continua disponível.
      expect(c.existe('exportar-json')).toBe(true);
    });

    it('resultado interrompido, cancelado, com erro ou com falha de sessão: também não', async () => {
      ambiente.ponte.guardar(resultadoDeCenario('completa'), { inicio: 500 });
      ambiente.ponte.linhasDeBase.set('abrir-fechar', { id: 'completa', limites: {} });
      for (const desfecho of ['interrompida', 'cancelada', 'erro'] as const) {
        ambiente.ponte.guardar(resultadoDeCenario(`exec-${desfecho}`, { desfecho }));
        await abrir(`exec-${desfecho}`);
        expect(c.texto('sem-comparacao')).toContain('Resultado parcial');
        expect(c.existe('marcar-linha-de-base')).toBe(false);
        expect(c.existe('comparar-com')).toBe(false);
        expect(c.existe('regressao-avaliacao')).toBe(false);
      }
      ambiente.ponte.guardar(resultadoDeCenario('expirada', {}, { falhaDeSessao: { url: 'http://localhost:4300/login', iteracao: 2 }, estatisticas: [] }));
      await abrir('expirada');
      expect(c.existe('sem-comparacao')).toBe(true);
      expect(c.existe('marcar-linha-de-base')).toBe(false);
    });

    it('execução completa: oferece a linha de base e a comparação só com as outras execuções completas do mesmo cenário', async () => {
      ambiente.ponte.guardar(resultadoDeCenario('nova'), { inicio: 5000 });
      ambiente.ponte.guardar(resultadoDeCenario('antiga'), { inicio: 1000, versaoBuild: '1.3.0' });
      ambiente.ponte.guardar(resultadoDeCenario('parcial', { desfecho: 'erro' }), { inicio: 2000 });
      ambiente.ponte.guardar(resultadoDeCenario('outro-cenario'), { inicio: 3000, grupo: 'cenario:checkout', nomeCenario: 'checkout' });
      ambiente.ponte.guardar({ ...RESULTADO_FIXO, id: 'manual-1' });
      await abrir('nova');

      expect(c.existe('sem-comparacao')).toBe(false);
      expect(c.existe('marcar-linha-de-base')).toBe(true);
      const opcoes = Array.from(c.porId<HTMLSelectElement>('comparar-com').options, (o) => o.value);
      expect(opcoes).toEqual(['antiga']);

      const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      await c.clicar('comparar');
      // A mais antiga é a referência (A).
      expect(navegar).toHaveBeenCalledWith(['/relatorio/comparar', 'antiga', 'nova']);
    });

    it('sem outra execução completa do cenário, diz que não há com o que comparar', async () => {
      ambiente.ponte.guardar(resultadoDeCenario('unica'));
      await abrir('unica');
      expect(c.existe('sem-outra-execucao')).toBe(true);
      expect(c.existe('comparar')).toBe(false);
    });

    it('marcar como linha de base, definir limites e desmarcar', async () => {
      ambiente.ponte.guardar(resultadoDeCenario('exec-1'));
      await abrir('exec-1');
      expect(c.existe('linha-de-base-atual')).toBe(false);

      await c.clicar('marcar-linha-de-base');
      expect(ambiente.ponte.linhasDeBase.get('abrir-fechar')).toEqual({ id: 'exec-1', limites: {} });
      expect(c.texto('linha-de-base-atual')).toContain('linha de base de “abrir-fechar”');
      expect(c.existe('e-linha-de-base')).toBe(true);
      // Sem limite próprio, o campo mostra o padrão de 10% como sugestão.
      expect(c.porId<HTMLInputElement>('limite-pior-interacao').placeholder).toBe('10');

      await c.preencher('limite-pior-interacao', '20');
      await c.preencher('limite-duracao-iteracao', '-3');
      await c.clicar('salvar-limites');
      expect(c.texto('limites-erro')).toContain('Duração da iteração');
      expect(ambiente.ponte.linhasDeBase.get('abrir-fechar')).toEqual({ id: 'exec-1', limites: {} });

      await c.preencher('limite-duracao-iteracao', '');
      await c.clicar('salvar-limites');
      expect(c.existe('limites-erro')).toBe(false);
      expect(c.existe('limites-salvos')).toBe(true);
      expect(ambiente.ponte.linhasDeBase.get('abrir-fechar')).toEqual({ id: 'exec-1', limites: { 'pior-interacao': 20 } });

      await c.clicar('desmarcar-linha-de-base');
      expect(ambiente.ponte.linhasDeBase.has('abrir-fechar')).toBe(false);
      expect(c.existe('marcar-linha-de-base')).toBe(true);
      expect(c.existe('e-linha-de-base')).toBe(false);
    });

    it('marcar outra execução substitui a referência e mantém os limites do cenário', async () => {
      ambiente.ponte.guardar(resultadoDeCenario('antiga'), { inicio: 1000 });
      ambiente.ponte.guardar(resultadoDeCenario('nova'), { inicio: 5000 });
      ambiente.ponte.linhasDeBase.set('abrir-fechar', { id: 'antiga', limites: { 'pior-interacao': 20 } });
      await abrir('nova');
      expect(c.existe('linha-de-base-outra')).toBe(true);
      await c.clicar('marcar-linha-de-base');
      expect(ambiente.ponte.linhasDeBase.get('abrir-fechar')).toEqual({ id: 'nova', limites: { 'pior-interacao': 20 } });
    });

    it('com linha de base definida, o relatório de uma nova execução sinaliza a regressão', async () => {
      const base = comMedianas(resultadoDeCenario('base'), { 'duracao-iteracao': 1000, 'pior-interacao': 120 });
      const nova = comMedianas(resultadoDeCenario('nova'), { 'duracao-iteracao': 1000, 'pior-interacao': 180 });
      ambiente.ponte.guardar(base, { inicio: 1000 });
      ambiente.ponte.guardar(nova, { inicio: 5000 });
      ambiente.ponte.linhasDeBase.set('abrir-fechar', { id: 'base', limites: { 'pior-interacao': 20 } });
      await abrir('nova');
      expect(c.texto('regressao')).toContain('Pior interação por iteração (+50.0%, limite de 20%)');
      expect(c.existe('sem-regressao')).toBe(false);
    });
  });
});
