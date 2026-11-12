import { TestBed } from '@angular/core/testing';
import { dadosVazios } from '../../../../shared/agregacao';
import { describe, expect, it } from 'vitest';
import type { ResultadoSessao } from '../../../../shared/types';
import { RESULTADO_CENARIO_FIXO, RESULTADO_CPU_FIXO, RESULTADO_FIXO, RESULTADO_MEMORIA_FIXO } from './apoio-teste';
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
      dados: dadosVazios(),
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
      expect(texto('condicoes-throttling')).toBe('padrao (CPU 4× mais lenta; rede com 150 ms de latência, download de 1600 kbps e upload de 750 kbps)');
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

  describe('memória', () => {
    it('apresenta "vazamento provável" como indício que depende de análise dos objetos', () => {
      const { texto } = montar(RESULTADO_MEMORIA_FIXO);
      expect(texto('memoria-classificacao')).toBe('Vazamento provável');
      const indicio = texto('memoria-indicio')!;
      expect(indicio).toContain('o heap subiu em 5 de 5 transições (+300.0 KB no total); o número de nós DOM subiu em 5 de 5 transições (+2020 no total)');
      expect(indicio).toContain('Isto é um indício, não uma confirmação');
      expect(indicio).toContain('confirme analisando os objetos dos construtores listados abaixo');
    });

    it('mostra a série por iteração em tabela, com o crescimento médio', () => {
      const { textos } = montar(RESULTADO_MEMORIA_FIXO);
      const linhas = textos('memoria-iteracao');
      expect(linhas).toHaveLength(6);
      expect(linhas[0]).toBe('1 1.95 MB 850 15');
      expect(linhas[5]).toBe('6 2.25 MB 2870 15');
      expect(textos('memoria-crescimento')).toEqual(['Crescimento médio por iteração +60.0 KB +404 0']);
    });

    it('mostra a variação de nós desanexados e de listeners', () => {
      const { texto } = montar(RESULTADO_MEMORIA_FIXO);
      expect(texto('memoria-nos-desanexados')).toBe('203 → 1421 (+1218)');
      expect(texto('memoria-listeners')).toBe('15 → 15 (0)');
    });

    it('lista os 20 construtores que mais cresceram, e só os que cresceram', () => {
      const { textos } = montar(RESULTADO_MEMORIA_FIXO);
      const linhas = textos('memoria-construtor');
      // A comparação tem 21 que cresceram e 1 que diminuiu.
      expect(linhas).toHaveLength(20);
      expect(linhas[0]).toBe('HTMLLIElement 200 1400 +1200');
      expect(linhas[1]).toBe('Classe1 (novo) 0 30 +30');
      expect(linhas[19]).toBe('Classe19 10 12 +2');
      expect(linhas.join(' ')).not.toContain('Temporario');
    });

    it('diz que a lista é por número de objetos e remete ao DevTools para o tamanho', () => {
      const { texto } = montar(RESULTADO_MEMORIA_FIXO);
      expect(texto('memoria-comparacao')).toContain('Número de objetos vivos por construtor, entre “inicio” e “fim”');
      expect(texto('memoria-comparacao')).toContain('não tem acesso ao tamanho dos objetos');
    });

    it('lista os censos com o rótulo e o total de objetos', () => {
      const { textos } = montar(RESULTADO_MEMORIA_FIXO);
      expect(textos('memoria-snapshot')).toEqual(['inicio 1434 objetos', 'fim 2652 objetos']);
    });

    it('sem indício e dados insuficientes têm o seu texto, sem tom de alerta', () => {
      const com = (classificacao: 'sem-indicio' | 'dados-insuficientes') =>
        montar({ ...RESULTADO_MEMORIA_FIXO, memoria: { ...RESULTADO_MEMORIA_FIXO.memoria!, classificacao } });
      expect(com('sem-indicio').texto('memoria-classificacao')).toBe('Sem indício de vazamento');
      expect(com('sem-indicio').texto('memoria-indicio')).toBe('Heap, nós DOM e listeners não cresceram de forma consistente entre as iterações.');
      expect(com('dados-insuficientes').texto('memoria-classificacao')).toBe('Dados insuficientes');
      expect(com('dados-insuficientes').texto('memoria-indicio')).toContain('ao menos 5 iterações completas');
    });

    it('nenhum construtor cresceu: diz isso em vez de uma tabela vazia', () => {
      const memoria = RESULTADO_MEMORIA_FIXO.memoria!;
      const { existe, texto } = montar({
        ...RESULTADO_MEMORIA_FIXO,
        memoria: { ...memoria, comparacao: { ...memoria.comparacao!, construtores: memoria.comparacao!.construtores.slice(-1) } },
      });
      expect(existe('memoria-construtores')).toBe(false);
      expect(texto('memoria-sem-crescimento')).toBe('Nenhum construtor ganhou objetos entre os dois censos.');
    });

    it('só com "DOM e listeners": mostra a variação, sem classificação nem série', () => {
      const { existe, texto } = montar({
        ...RESULTADO_MEMORIA_FIXO,
        selecao: ['dom-listeners'],
        memoria: { classificacao: null, series: [], comparacao: null, domListeners: { nosDesanexados: null, listeners: { antes: 16, depois: 26, variacao: 10 } } },
      });
      expect(existe('memoria-classificacao')).toBe(false);
      expect(existe('memoria-sem-classificacao')).toBe(false);
      expect(existe('memoria-serie')).toBe(false);
      expect(texto('memoria-listeners')).toBe('16 → 26 (+10)');
      expect(texto('memoria-nos-desanexados')).toBe('indisponível');
    });

    it('sessão manual: medições e snapshots, sem classificação de vazamento', () => {
      const { existe, texto } = montar({
        ...RESULTADO_FIXO,
        selecao: ['memoria'],
        dados: {
          ...RESULTADO_FIXO.dados,
          medicoes: [
            { instante: 1000, heapUsado: 1024 * 1024, nosDom: 50, listeners: 10 },
            { instante: 6000, heapUsado: 2 * 1024 * 1024, nosDom: 80, listeners: 12 },
          ],
          snapshots: [RESULTADO_MEMORIA_FIXO.dados.snapshots[0]!],
        },
        memoria: { classificacao: null, series: [], comparacao: null, domListeners: null },
      });
      expect(existe('memoria-classificacao')).toBe(false);
      expect(texto('memoria-sem-classificacao')).toContain('não é classificado');
      expect(texto('memoria-medicoes-quantidade')).toBe('2');
      expect(texto('memoria-medicoes')).toContain('1.00 MB → 2.00 MB');
      expect(existe('memoria-snapshot')).toBe(true);
      expect(existe('memoria-serie')).toBe(false);
    });

    it('cenário sem passos de memória: diz que nada foi medido', () => {
      const { texto } = montar({
        ...RESULTADO_CENARIO_FIXO,
        selecao: ['memoria'],
        memoria: { classificacao: 'dados-insuficientes', series: [], comparacao: null, domListeners: null },
      });
      expect(texto('memoria-sem-dados')).toContain('Nenhuma medição de memória');
    });

    it('sem as verificações de memória, ou com a análise cancelada, a seção não aparece', () => {
      expect(montar(RESULTADO_CENARIO_FIXO).existe('memoria-classificacao')).toBe(false);
      const cancelada = montar({ ...RESULTADO_MEMORIA_FIXO, desfecho: 'cancelada', memoria: null });
      expect(cancelada.existe('memoria-classificacao')).toBe(false);
      expect(cancelada.existe('memoria-serie')).toBe(false);
    });

    it('marca a long task causada pelo heap snapshot', () => {
      const { textos } = montar({
        ...RESULTADO_FIXO,
        dados: { ...RESULTADO_FIXO.dados, longTasks: [{ inicio: 3000, duracao: 900, causadaPelaMedicao: true }, { inicio: 6500, duracao: 75 }] },
      });
      expect(textos('long-task')).toEqual(['2.0 s causada pelo censo de objetos, fora das estatísticas 900.0 ms', '5.5 s 75.0 ms']);
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

  describe('CPU', () => {
    const comCpu = (cpu: Partial<NonNullable<ResultadoSessao['dados']['cpu']>>): ResultadoSessao => ({
      ...RESULTADO_CPU_FIXO,
      dados: { ...RESULTADO_CPU_FIXO.dados, cpu: { ...RESULTADO_CPU_FIXO.dados.cpu!, ...cpu } },
    });

    it('sem a verificação "CPU" não há seção de CPU nem aviso de perfil ligado', () => {
      const { existe } = montar(RESULTADO_FIXO);
      expect(existe('cpu-categorias')).toBe(false);
      expect(existe('cpu-funcoes')).toBe(false);
      expect(existe('resultado-perfil-cpu')).toBe(false);
    });

    it('mostra as categorias do motor separadas das funções', () => {
      const { texto } = montar(RESULTADO_CPU_FIXO);
      expect(texto('cpu-amostrado')).toBe('2000.0 ms');
      expect(texto('cpu-ativo')).toBe('500.0 ms (25.0%)');
      expect(texto('cpu-ocioso')).toBe('1500.0 ms (75.0%)');
      expect(texto('cpu-coleta-de-lixo')).toBe('20.0 ms (1.0%)');
      expect(texto('cpu-programa')).toBe('50.0 ms (2.5%)');
      expect(texto('cpu-extensoes')).toBe('10.0 ms (0.5%)');
    });

    it('lista as 30 primeiras funções com nome, origem, tempo próprio, tempo total e percentual', () => {
      const { textos, texto } = montar(RESULTADO_CPU_FIXO);
      const linhas = textos('cpu-funcao');
      expect(linhas).toHaveLength(30);
      // Na primeira coluna, o nome e a origem ficam em elementos seguidos.
      expect(texto('cpu-funcao-nome')).toBe('calculoPesado');
      expect(texto('cpu-funcao-origem')).toBe('http://localhost:4300/cpu-pesada.ts:4');
      expect(linhas.slice(0, 3)).toEqual([
        'calculoPesadohttp://localhost:4300/cpu-pesada.ts:4 300.0 ms 310.5 ms 60.0%',
        '(anônima)http://localhost:4300/cpu-pesada.ts:15 40.0 ms 350.5 ms 8.0%',
        'sortorigem não informada 12.3 ms 12.3 ms 2.5%',
      ]);
      expect(linhas.at(-1)).toBe('auxiliar27http://localhost:4300/comum.ts:27 1.0 ms 1.0 ms 0.2%');
    });

    it('soma em "outras" o que ficou fora da lista: as funções além das 30 e o resto do resumo', () => {
      const { textos } = montar(RESULTADO_CPU_FIXO);
      // 5 funções de 1 ms além das 30, mais 12 funções (3 ms) já agregadas no resumo: 8 ms de 500 ms.
      expect(textos('cpu-outras')).toEqual(['Outras (17 funções) 8.0 ms — 1.6%']);
    });

    it('sem nada fora da lista, a linha "outras" não aparece', () => {
      const resumo = RESULTADO_CPU_FIXO.dados.cpu!.resumo!;
      const { existe, textos } = montar(comCpu({ resumo: { ...resumo, funcoes: resumo.funcoes.slice(0, 2), outras: null } }));
      expect(textos('cpu-funcao')).toHaveLength(2);
      expect(existe('cpu-outras')).toBe(false);
    });

    it('página só ociosa: categorias sem lista de funções', () => {
      const resumo = RESULTADO_CPU_FIXO.dados.cpu!.resumo!;
      const { existe, texto } = montar(comCpu({ resumo: { ...resumo, funcoes: [], outras: null } }));
      expect(texto('cpu-ocioso')).toBe('1500.0 ms (75.0%)');
      expect(existe('cpu-funcoes')).toBe(false);
      expect(texto('cpu-sem-funcoes')).toContain('Nenhuma função');
    });

    it('avisa que as métricas foram coletadas com o perfil de CPU ligado', () => {
      const { texto, existe } = montar(RESULTADO_CPU_FIXO);
      expect(texto('resultado-perfil-cpu')).toContain('coletadas com o perfil de CPU ligado');
      expect(existe('cpu-limite')).toBe(false);
      expect(existe('cpu-incompleto')).toBe(false);
      expect(existe('cpu-falha')).toBe(false);
    });

    it('avisa quando o perfil parou no limite de duração da sessão manual', () => {
      const { texto, existe } = montar(comCpu({ limiteAtingido: true }));
      expect(texto('cpu-limite')).toContain('limite de 5 minutos');
      expect(existe('cpu-funcoes')).toBe(true);
    });

    it('avisa quando o perfil veio incompleto, mantendo o resumo', () => {
      const { texto, existe } = montar(comCpu({ incompleto: true }));
      expect(texto('cpu-incompleto')).toContain('incompleto');
      expect(existe('cpu-funcoes')).toBe(true);
    });

    it('perfil não coletado: mostra o motivo, sem resumo e sem o aviso de perfil ligado', () => {
      const falha = 'O perfil de CPU não foi coletado: o navegador já tem um trace em andamento.';
      const { texto, existe } = montar(comCpu({ estado: 'falhou', ativo: false, resumo: null, falha }));
      expect(texto('cpu-falha')).toBe(falha);
      expect(existe('cpu-categorias')).toBe(false);
      expect(existe('resultado-perfil-cpu')).toBe(false);
    });

    it('análise cancelada não mostra a seção de CPU', () => {
      const { existe } = montar({ ...RESULTADO_CPU_FIXO, desfecho: 'cancelada' });
      expect(existe('cpu-categorias')).toBe(false);
      expect(existe('resultado-perfil-cpu')).toBe(false);
    });
  });
});
