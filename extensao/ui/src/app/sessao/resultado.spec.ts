import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { ResultadoSessao } from '../../../../shared/types';
import { RESULTADO_CENARIO_FIXO, RESULTADO_FIXO } from './apoio-teste';
import { Resultado } from './resultado';

function montar(resultado: ResultadoSessao) {
  const fixture = TestBed.createComponent(Resultado);
  fixture.componentRef.setInput('resultado', resultado);
  fixture.detectChanges();
  const raiz = fixture.nativeElement as HTMLElement;
  return {
    texto: (id: string) => raiz.querySelector(`[data-testid="${id}"]`)?.textContent?.trim().replace(/\s+/g, ' '),
    /** Texto de cada linha da lista, com as colunas separadas por espaço. */
    textos: (id: string) =>
      Array.from(raiz.querySelectorAll(`[data-testid="${id}"]`), (linha) =>
        Array.from(linha.children, (coluna) => coluna.textContent?.trim().replace(/\s+/g, ' ')).join(' '),
      ),
    existe: (id: string) => raiz.querySelector(`[data-testid="${id}"]`) !== null,
  };
}

describe('Resultado', () => {
  it('identifica o resultado como sessão manual', () => {
    const { texto } = montar(RESULTADO_FIXO);
    expect(texto('resultado-tipo')).toBe('Sessão manual');
    expect(texto('resultado-desfecho')).toBe('Concluída');
    expect(texto('resultado-url')).toBe(RESULTADO_FIXO.url);
  });

  it('mostra as métricas de carregamento, com a que o navegador não produziu como indisponível', () => {
    const { texto } = montar(RESULTADO_FIXO);
    expect(texto('metrica-fcp')).toBe('120.0 ms');
    expect(texto('metrica-ttfb')).toBe('35.5 ms');
    // CLS igual a zero é um valor medido; LCP nunca foi emitido.
    expect(texto('metrica-cls')).toBe('0.000');
    expect(texto('metrica-lcp')).toBe('indisponível');
  });

  it('mostra o INP, as long tasks e as interações com duração e elemento alvo', () => {
    const { texto, textos } = montar(RESULTADO_FIXO);
    expect(texto('metrica-inp')).toBe('328.0 ms');
    expect(textos('long-task')).toEqual(['2.0 s 312.4 ms', '5.5 s 75.0 ms']);
    expect(textos('interacao')).toEqual(['2.0 s click em button[data-testid="acao-pesada"] 328.0 ms']);
  });

  it('confirma a limpeza e lista o que foi removido', () => {
    const { texto, textos, existe } = montar(RESULTADO_FIXO);
    expect(texto('limpeza-concluida')).toContain('Desconexão concluída');
    expect(textos('item-limpeza')).toEqual([
      'Script de medição registrado 1',
      'Observadores de performance 7',
      'Listeners de eventos 5',
      'Conexões entre a página e a extensão 1',
      'Temporizadores 2',
    ]);
    expect(existe('limpeza-sem-pagina')).toBe(false);
  });

  it('só com "Carregamento", não mostra long tasks, interações nem INP', () => {
    const { existe } = montar({
      ...RESULTADO_FIXO,
      selecao: ['carregamento'],
      dados: { ...RESULTADO_FIXO.dados, longTasks: [], interacoes: [] },
    });
    expect(existe('carregamento')).toBe(true);
    expect(existe('lista-long-tasks')).toBe(false);
    expect(existe('lista-interacoes')).toBe(false);
    expect(existe('metrica-inp')).toBe(false);
  });

  it('só com "Processamento", não mostra métricas de carregamento', () => {
    const { existe } = montar({ ...RESULTADO_FIXO, selecao: ['processamento'] });
    expect(existe('carregamento')).toBe(false);
    expect(existe('metrica-inp')).toBe(true);
  });

  it('sessão interrompida avisa e mantém os dados recebidos', () => {
    const { texto, textos, existe } = montar({
      ...RESULTADO_FIXO,
      desfecho: 'interrompida',
      paginaRespondeu: false,
      limpeza: [{ recurso: 'script-registrado', quantidade: 1 }],
    });
    expect(texto('resultado-desfecho')).toBe('Interrompida');
    expect(existe('resultado-interrompida')).toBe(true);
    expect(textos('long-task')).toHaveLength(2);
    expect(existe('limpeza-sem-pagina')).toBe(true);
  });

  it('análise cancelada mostra só a situação e a limpeza', () => {
    const { texto, existe, textos } = montar({
      ...RESULTADO_FIXO,
      desfecho: 'cancelada',
      dados: { longTasks: [], interacoes: [], documentos: [], errosPagina: [] },
    });
    expect(texto('resultado-desfecho')).toBe('Análise cancelada');
    expect(existe('lista-long-tasks')).toBe(false);
    expect(existe('carregamento')).toBe(false);
    expect(textos('item-limpeza')).toHaveLength(5);
  });

  describe('execução de cenário', () => {
    it('identifica o cenário, a configuração efetiva e o ambiente', () => {
      const { texto } = montar(RESULTADO_CENARIO_FIXO);
      expect(texto('resultado-tipo')).toBe('Cenário');
      expect(texto('resultado-desfecho')).toBe('Concluída');
      expect(texto('cenario-nome')).toBe('abrir-fechar');
      expect(texto('cenario-passos')).toBe('39');
      expect(texto('cenario-throttling')).toBe('padrao (registrado, não aplicado nesta versão)');
      expect(texto('cenario-versao-build')).toBe('1.4.2');
      expect(texto('ambiente-versao')).toBe('158.0.8127.18');
      expect(texto('ambiente-janela')).toBe('1280 × 720');
      expect(texto('ambiente-dpr')).toBe('2');
      expect(texto('ambiente-user-agent')).toBe('Mozilla/5.0 Chrome/158.0.0.0');
    });

    it('resume cada métrica com mediana, p75 e p95 entre as iterações completas', () => {
      const { textos } = montar(RESULTADO_CENARIO_FIXO);
      expect(textos('estatistica')).toEqual([
        'Duração da iteração 1400.0 ms 1450.5 ms 1600.0 ms 19',
        'Tempo em long tasks por iteração 0.0 ms 60.0 ms 118.3 ms 19',
        'Pior interação por iteração — — — 0',
      ]);
    });

    it('mostra as iterações completas e incompletas e o passo pulado', () => {
      const { texto, existe } = montar(RESULTADO_CENARIO_FIXO);
      expect(texto('cenario-iteracoes')).toBe('19 de 20');
      expect(texto('cenario-incompletas')).toBe('1');
      expect(existe('cenario-aviso-incompletas')).toBe(true);
      const falha = texto('falha-passo');
      expect(falha).toContain('Passo pulado');
      expect(falha).toContain('/passos/0/passos/1');
      expect(falha).toContain('iteração 4');
      expect(falha).toContain('Tempo limite de 200 ms');
    });

    it('destaca a quantidade de erros da página e lista cada um com origem e iteração', () => {
      const { texto, textos } = montar(RESULTADO_CENARIO_FIXO);
      expect(texto('erros-pagina-destaque')).toContain('A página teve 2 erros');
      expect(textos('erro-pagina')).toEqual([
        '5.0 s Exceção: Error: falha de propósito http://localhost:4300/erros.ts:12 iteração 5',
        '8.5 s Promise rejeitada: pedido recusado origem não informada fora das iterações',
      ]);
    });

    it('com a verificação marcada e sem erros, diz que não houve nenhum', () => {
      const { existe } = montar({ ...RESULTADO_CENARIO_FIXO, dados: { ...RESULTADO_CENARIO_FIXO.dados, errosPagina: [] } });
      expect(existe('sem-erros-pagina')).toBe(true);
      expect(existe('erros-pagina-destaque')).toBe(false);
    });

    it('sem "Erros da página" na seleção, a seção não aparece', () => {
      const { existe } = montar({ ...RESULTADO_CENARIO_FIXO, selecao: ['processamento'] });
      expect(existe('erros-pagina-destaque')).toBe(false);
      expect(existe('sem-erros-pagina')).toBe(false);
      expect(existe('lista-erros-pagina')).toBe(false);
    });

    it('erro na execução: informa o passo, a iteração e o motivo', () => {
      const { texto } = montar({
        ...RESULTADO_CENARIO_FIXO,
        desfecho: 'erro',
        cenario: {
          ...RESULTADO_CENARIO_FIXO.cenario!,
          estadoFinal: 'erro',
          falhas: [{ caminho: '/passos/0/passos/0', tipoPasso: 'clicar', iteracao: 7, motivo: 'Tempo limite de 10000 ms: nenhum elemento corresponde a "#abrir".', acao: 'interrompeu' }],
        },
      });
      expect(texto('resultado-desfecho')).toBe('Erro na execução');
      const falha = texto('falha-passo');
      expect(falha).toContain('Execução interrompida');
      expect(falha).toContain('/passos/0/passos/0');
      expect(falha).toContain('iteração 7');
      expect(falha).toContain('"#abrir"');
    });

    it('execução cancelada não mostra estatísticas nem erros da página', () => {
      const { texto, existe } = montar({
        ...RESULTADO_CENARIO_FIXO,
        desfecho: 'cancelada',
        cenario: { ...RESULTADO_CENARIO_FIXO.cenario!, estadoFinal: 'cancelada', estatisticas: [] },
      });
      expect(texto('resultado-desfecho')).toBe('Análise cancelada');
      expect(existe('estatisticas')).toBe(false);
      expect(existe('erros-pagina-destaque')).toBe(false);
    });

    it('lista o debugger entre o que foi removido', () => {
      const { textos } = montar(RESULTADO_CENARIO_FIXO);
      expect(textos('item-limpeza')).toContain('Debugger anexado à aba 1');
    });
  });

  describe('conexão perdida', () => {
    it.each([
      ['canceled_by_user', 'A depuração foi cancelada na barra de aviso do Chrome.'],
      ['target_closed', 'A aba analisada foi fechada.'],
      ['replaced_with_devtools', 'O DevTools assumiu a depuração da aba.'],
      ['outro_motivo', 'O Chrome encerrou a depuração da aba (outro_motivo).'],
    ])('%s: explica o motivo e avisa que os dados são parciais', (motivo, explicacao) => {
      const { texto, existe } = montar({ ...RESULTADO_CENARIO_FIXO, desfecho: 'interrompida', conexaoPerdida: motivo });
      expect(texto('resultado-desfecho')).toBe('Interrompida');
      expect(texto('resultado-conexao-perdida')).toContain(explicacao);
      expect(texto('resultado-conexao-perdida')).toContain('parciais');
      expect(existe('resultado-interrompida')).toBe(false);
      // Os dados já coletados continuam no resultado.
      expect(existe('estatisticas')).toBe(true);
    });
  });
});
