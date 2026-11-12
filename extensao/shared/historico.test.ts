import { describe, expect, it } from 'vitest';
import { type Cenario, mascararCenario } from './cenario.ts';
import { PERFIL_PADRAO, condicoesDe } from './condicoes.ts';
import {
  BYTES_POR_MB,
  CONFIGURACAO_PADRAO,
  type RegistroExecucao,
  ehParcial,
  estimarTamanho,
  idsARemover,
  interromperRegistro,
  normalizarConfiguracao,
  podeSerReferencia,
  registroEmAndamento,
  registroFinal,
  resultadoDoRegistro,
  truncarDados,
  usoDoHistorico,
} from './historico.ts';
import { concluir, estadoInicial, iniciar } from './sessao-estado.ts';
import type { Desfecho, EstadoSessao, ResultadoSessao, SessaoEmAndamento } from './types.ts';

const SENHA = 'senha-muito-secreta';

const CENARIO: Cenario = {
  versao_esquema: 1,
  nome: 'abrir-fechar',
  url_inicial: 'http://localhost:4300/protegida',
  execucao: { iteracoes: 3, throttling: 'padrao' },
  sessao: {
    url_login: '/login',
    passos_login: [
      { tipo: 'digitar', seletor: '#usuario', texto: 'maria' },
      { tipo: 'digitar', seletor: '#senha', texto: SENHA },
      { tipo: 'clicar', seletor: '#entrar' },
    ],
  },
  passos: [{ tipo: 'repetir', vezes: 'iteracoes', passos: [{ tipo: 'clicar', seletor: '#abrir' }, { tipo: 'snapshot', rotulo: 'fim' }] }],
};

/** Sessão de cenário ativa, com 3 iterações e dados de todas as verificações. */
function sessaoAtiva(): EstadoSessao {
  const transicao = iniciar(estadoInicial(), {
    id: 'exec-1',
    idAba: 5,
    url: CENARIO.url_inicial,
    selecao: ['processamento', 'erros-pagina', 'memoria', 'cpu'],
    inicio: 1000,
    idsScripts: ['sondagem-sessao'],
    usaDebugger: true,
    condicoes: condicoesDe(PERFIL_PADRAO, { desligado: true, limpo: true }),
    extensoes: [{ id: 'abc', nome: 'Bloqueador' }],
    navegador: { versao: '158.0.8127.18', userAgent: 'Mozilla/5.0 Chrome/158.0.0.0' },
    cenario: {
      definicao: mascararCenario(CENARIO),
      configuracao: { nome: 'abrir-fechar', urlInicial: CENARIO.url_inicial, iteracoes: 3, throttling: 'padrao', versaoBuild: '1.4.2' },
    },
  });
  if (!transicao.ok) throw new Error('não iniciou');
  const sessao = transicao.estado.sessao!;
  const andamento = sessao.cenario!.andamento;
  andamento.estado = 'concluida';
  andamento.iteracao = 3;
  andamento.passosExecutados = 6;
  andamento.ambiente = { versaoNavegador: '158.0.8127.18', userAgent: 'Mozilla/5.0 Chrome/158.0.0.0', janela: { largura: 1280, altura: 720 }, dpr: 2 };
  andamento.iteracoes = [1, 2, 3].map((numero) => ({ numero, inicio: 1000 + numero * 1000, fim: 1800 + numero * 1000, completa: true, passosExecutados: 2 }));
  sessao.dados.longTasks = Array.from({ length: 300 }, (_, i) => ({ inicio: 2000 + i * 10, duracao: 60 + (i % 7), iteracao: (i % 3) + 1 }));
  sessao.dados.interacoes = Array.from({ length: 200 }, (_, i) => ({
    id: i,
    documento: 'doc',
    inicio: 2000 + i * 15,
    duracao: 40,
    tipo: 'click',
    alvo: 'button#abrir',
    iteracao: (i % 3) + 1,
  }));
  sessao.dados.medicoes = [1, 2, 3].map((iteracao) => ({ instante: 1700 + iteracao * 1000, heapUsado: 1_000_000 + iteracao * 1000, nosDom: 50, listeners: 10, iteracao }));
  sessao.dados.snapshots = [
    { rotulo: 'fim', instante: 4900, iteracao: 3, totalObjetos: 1200, construtores: [{ nome: 'Item', contagem: 900 }], outros: { nome: '(outros)', contagem: 300 } },
  ];
  sessao.dados.cpu = {
    estado: 'concluida',
    ativo: true,
    falha: null,
    incompleto: false,
    limiteAtingido: false,
    resumo: {
      tempoAmostrado: 3000,
      tempoAtivo: 900,
      amostras: 18_000,
      categorias: { ocioso: 2100, coletaDeLixo: 10, programa: 30, extensoes: 5 },
      funcoes: [{ nome: 'calculoPesado', arquivo: 'http://localhost:4300/app.js', linha: 4, coluna: 2, tempoProprio: 700, tempoTotal: 720, percentual: 77.7 }],
      outras: null,
    },
  };
  return transicao.estado;
}

function resultadoDe(desfecho: Desfecho = 'concluida', estado = sessaoAtiva()): ResultadoSessao {
  const transicao = concluir(estado, { desfecho, fim: 6000, limpeza: [{ recurso: 'depurador', quantidade: 1 }], paginaRespondeu: true });
  if (!transicao.ok) throw new Error('não concluiu');
  return transicao.estado.resultado!;
}

function registro(parcial: Partial<RegistroExecucao>): RegistroExecucao {
  return { ...registroFinal(resultadoDe(), null, Infinity).registro, ...parcial };
}

describe('registro de uma execução', () => {
  it('em andamento: guarda os metadados e o que já foi coletado, sem resumo', () => {
    const sessao = sessaoAtiva().sessao!;
    const { registro: r, dados } = registroEmAndamento(sessao);
    expect(r).toMatchObject({ id: 'exec-1', estado: 'em-andamento', tipo: 'cenario', grupo: 'cenario:abrir-fechar', fim: null, resumo: null });
    expect(r.andamento?.iteracoes).toHaveLength(3);
    expect(dados.longTasks).toHaveLength(300);
    expect(r.tamanho).toBeGreaterThan(estimarTamanho(dados));
  });

  it('terminada: traz todos os metadados da execução', () => {
    const { registro: r } = registroFinal(resultadoDe(), mascararCenario(CENARIO), Infinity);
    expect(r).toMatchObject({
      id: 'exec-1',
      tipo: 'cenario',
      estado: 'concluida',
      nomeCenario: 'abrir-fechar',
      url: CENARIO.url_inicial,
      inicio: 1000,
      fim: 6000,
      versaoBuild: '1.4.2',
      navegador: { versao: '158.0.8127.18' },
      ambiente: { janela: { largura: 1280, altura: 720 }, dpr: 2 },
      condicoes: { perfil: 'padrao', cpu: 4, rede: { latenciaMs: 150, downloadKbps: 1600, uploadKbps: 750 }, cacheDesligado: true, cacheLimpo: true },
      extensoes: [{ id: 'abc', nome: 'Bloqueador' }],
      configuracao: { nome: 'abrir-fechar', iteracoes: 3, throttling: 'padrao' },
      andamento: null,
      truncado: [],
    });
    expect(r.definicao?.nome).toBe('abrir-fechar');
    expect(r.chaveCondicoes).toContain('cpu=4');
    expect(r.resumo?.cenario?.estatisticas).toHaveLength(3);
  });

  it('sessão manual fica no grupo "manual", sem cenário', () => {
    const inicio = iniciar(estadoInicial(), { idAba: 5, url: 'http://localhost:4300/', selecao: ['processamento'], inicio: 10, idsScripts: [] });
    if (!inicio.ok) throw new Error('não iniciou');
    const { registro: r } = registroFinal(resultadoDe('concluida', inicio.estado), null, Infinity);
    expect(r).toMatchObject({ tipo: 'sessao-manual', grupo: 'manual', nomeCenario: null, definicao: null, configuracao: null, condicoes: { perfil: 'nenhum', cpu: 1 } });
  });

  it('o resultado é remontado igual a partir do que foi guardado', () => {
    const resultado = resultadoDe();
    const guardada = registroFinal(resultado, null, Infinity);
    expect(resultadoDoRegistro(guardada)).toEqual(resultado);
    expect(resultadoDoRegistro(registroEmAndamento(sessaoAtiva().sessao!))).toBeNull();
  });
});

describe('o que não é guardado', () => {
  /** Percorre o valor e devolve o caminho de toda chave e de todo texto. */
  function percorrer(valor: unknown, caminho = '', saida: { chaves: string[]; textos: string[] } = { chaves: [], textos: [] }) {
    if (typeof valor === 'string') saida.textos.push(valor);
    else if (Array.isArray(valor)) valor.forEach((item, i) => percorrer(item, `${caminho}/${i}`, saida));
    else if (valor && typeof valor === 'object') {
      for (const [chave, filho] of Object.entries(valor)) {
        saida.chaves.push(chave);
        percorrer(filho, `${caminho}/${chave}`, saida);
      }
    }
    return saida;
  }

  it('um resultado salvo não tem snapshot bruto, perfil bruto nem dado de autenticação', () => {
    const guardada = registroFinal(resultadoDe(), mascararCenario(CENARIO), Infinity);
    const { chaves, textos } = percorrer(guardada);

    // Heap snapshot bruto (formato do DevTools) e perfil de CPU bruto (formato do CDP e do trace).
    for (const proibida of ['nodes', 'edges', 'strings', 'trace_function_infos', 'samples', 'timeDeltas', 'callFrame', 'cpuProfile', 'traceEvents']) {
      expect(chaves).not.toContain(proibida);
    }
    // Cookies, tokens e conteúdo de storage da aplicação.
    for (const proibida of ['cookies', 'cookie', 'token', 'authorization', 'localStorage', 'sessionStorage', 'senha', 'password']) {
      expect(chaves.map((c) => c.toLowerCase())).not.toContain(proibida.toLowerCase());
    }
    expect(textos).not.toContain(SENHA);
    expect(textos).not.toContain('maria');
    expect(JSON.stringify(guardada)).not.toContain(SENHA);

    // O que fica são resumos: contagem por construtor e tempo por função.
    expect(guardada.dados.snapshots[0]).toEqual({
      rotulo: 'fim',
      instante: 4900,
      iteracao: 3,
      totalObjetos: 1200,
      construtores: [{ nome: 'Item', contagem: 900 }],
      outros: { nome: '(outros)', contagem: 300 },
    });
    expect(Object.keys(guardada.dados.cpu!.resumo!)).toEqual(['tempoAmostrado', 'tempoAtivo', 'amostras', 'categorias', 'funcoes', 'outras']);
  });

  it('o cenário guardado mantém os passos de login, sem o que foi digitado', () => {
    const { registro: r } = registroFinal(resultadoDe(), mascararCenario(CENARIO), Infinity);
    expect(r.definicao?.sessao?.passos_login).toEqual([
      { tipo: 'digitar', seletor: '#usuario', texto: '***' },
      { tipo: 'digitar', seletor: '#senha', texto: '***' },
      { tipo: 'clicar', seletor: '#entrar' },
    ]);
    // O cenário original não é alterado.
    expect(CENARIO.sessao?.passos_login?.[1]).toMatchObject({ texto: SENHA });
  });
});

describe('limite por execução', () => {
  it('dentro do limite nada é cortado', () => {
    const resultado = resultadoDe();
    const guardada = registroFinal(resultado, null, 20 * BYTES_POR_MB);
    expect(guardada.registro.truncado).toEqual([]);
    expect(guardada.dados).toEqual(resultado.dados);
    expect(guardada.resultado.truncado).toEqual([]);
  });

  it('acima do limite: corta primeiro long tasks e interações, mantém as estatísticas e indica o truncamento', () => {
    const resultado = resultadoDe();
    const semListas = estimarTamanho({ ...resultado.dados, longTasks: [], interacoes: [] });
    const fixo = estimarTamanho(registroFinal(resultado, null, Infinity).registro);
    const guardada = registroFinal(resultado, null, fixo + semListas + 200);

    expect(guardada.registro.truncado).toEqual(['longTasks', 'interacoes']);
    expect(guardada.dados.longTasks).toEqual([]);
    expect(guardada.dados.interacoes).toEqual([]);
    // O que não precisou sair continua lá.
    expect(guardada.dados.snapshots).toEqual(resultado.dados.snapshots);
    expect(guardada.dados.medicoes).toEqual(resultado.dados.medicoes);
    // As estatísticas foram calculadas antes do corte e ficam inteiras.
    expect(guardada.registro.resumo?.cenario?.estatisticas).toEqual(resultado.cenario?.estatisticas);
    expect(guardada.registro.resumo?.cenario?.estatisticas.find((e) => e.id === 'tempo-long-tasks')?.mediana).toBeGreaterThan(0);
    expect(guardada.registro.resumo?.memoria).toEqual(resultado.memoria);
    // O resultado devolvido à interface diz o que foi removido.
    expect(guardada.resultado.truncado).toEqual(['longTasks', 'interacoes']);
    expect(guardada.registro.tamanho).toBeLessThanOrEqual(fixo + semListas + 200);
  });

  it('só as long tasks saem se isso basta', () => {
    const { dados } = resultadoDe();
    const corte = truncarDados(dados, 0, estimarTamanho({ ...dados, longTasks: [] }));
    expect(corte.truncado).toEqual(['longTasks']);
    expect(corte.dados.interacoes).toHaveLength(200);
  });

  it('com limite zero saem todas as listas detalhadas, e as medições por iteração ficam', () => {
    const { dados } = resultadoDe();
    const corte = truncarDados(dados, 0, 0);
    expect(corte.truncado).toEqual(['longTasks', 'interacoes', 'snapshots', 'funcoesCpu']);
    expect(corte.dados.medicoes).toHaveLength(3);
    expect(corte.dados.snapshots[0]).toMatchObject({ rotulo: 'fim', totalObjetos: 1200, construtores: [] });
    expect(corte.dados.cpu?.resumo).toMatchObject({ tempoAtivo: 900, funcoes: [] });
    // O original não é alterado.
    expect(dados.longTasks).toHaveLength(300);
  });
});

describe('limite do histórico', () => {
  const config = { limiteHistoricoMb: 500 };

  it('abaixo de 80% não avisa', () => {
    expect(usoDoHistorico(399 * BYTES_POR_MB, config)).toMatchObject({ aviso: false, cheio: false });
  });

  it('a partir de 80% avisa, antes de o limite ser atingido', () => {
    const uso = usoDoHistorico(400 * BYTES_POR_MB, config);
    expect(uso).toMatchObject({ aviso: true, cheio: false, limiteBytes: 500 * BYTES_POR_MB });
    expect(uso.fracao).toBeCloseTo(0.8);
  });

  it('no limite, está cheio', () => {
    expect(usoDoHistorico(500 * BYTES_POR_MB, config)).toMatchObject({ aviso: true, cheio: true });
  });
});

describe('configuração de armazenamento', () => {
  it('os padrões: 20 MB por execução, 500 MB de histórico, 50 execuções por cenário, variação de 10%', () => {
    expect(normalizarConfiguracao(undefined)).toEqual(CONFIGURACAO_PADRAO);
    expect(CONFIGURACAO_PADRAO).toEqual({
      limiteExecucaoMb: 20,
      limiteHistoricoMb: 500,
      retencao: { maximoPorCenario: 50, idadeMaximaDias: null },
      limiteVariacao: 10,
    });
  });

  it('aceita o que o usuário definiu e troca o inválido pelo padrão', () => {
    expect(
      normalizarConfiguracao({ limiteExecucaoMb: 5, limiteHistoricoMb: -1, retencao: { maximoPorCenario: null, idadeMaximaDias: 30 }, limiteVariacao: 'x' }),
    ).toEqual({ limiteExecucaoMb: 5, limiteHistoricoMb: 500, retencao: { maximoPorCenario: null, idadeMaximaDias: 30 }, limiteVariacao: 10 });
    expect(normalizarConfiguracao({ retencao: { maximoPorCenario: 0 } }).retencao.maximoPorCenario).toBe(50);
  });
});

describe('retenção', () => {
  const DIA = 24 * 60 * 60 * 1000;
  const execucoes = (grupo: string, quantidade: number, base = 0): RegistroExecucao[] =>
    Array.from({ length: quantidade }, (_, i) => registro({ id: `${grupo}-${i + 1}`, grupo, inicio: base + (i + 1) * 1000 }));

  it('com 50 por cenário, salvar a 51ª remove a mais antiga daquele cenário', () => {
    const registros = [...execucoes('cenario:a', 51), ...execucoes('cenario:b', 3)];
    expect(idsARemover(registros, { maximoPorCenario: 50, idadeMaximaDias: null }, 0)).toEqual(['cenario:a-1']);
  });

  it('a quantidade vale por cenário, não no total', () => {
    const registros = [...execucoes('cenario:a', 2), ...execucoes('cenario:b', 2), ...execucoes('manual', 2)];
    expect(idsARemover(registros, { maximoPorCenario: 2, idadeMaximaDias: null }, 0)).toEqual([]);
    expect(idsARemover(registros, { maximoPorCenario: 1, idadeMaximaDias: null }, 0).sort()).toEqual(['cenario:a-1', 'cenario:b-1', 'manual-1']);
  });

  it('por idade máxima', () => {
    const agora = 100 * DIA;
    const registros = [registro({ id: 'velha', inicio: agora - 31 * DIA }), registro({ id: 'nova', inicio: agora - 29 * DIA })];
    expect(idsARemover(registros, { maximoPorCenario: null, idadeMaximaDias: 30 }, agora)).toEqual(['velha']);
  });

  it('sem limite de quantidade nem de idade, nada sai', () => {
    expect(idsARemover(execucoes('cenario:a', 80), { maximoPorCenario: null, idadeMaximaDias: null }, 1e12)).toEqual([]);
  });

  it('uma análise em andamento nunca é removida nem conta para a quantidade', () => {
    const registros = [registro({ id: 'rodando', estado: 'em-andamento', inicio: 1 }), ...execucoes('cenario:abrir-fechar', 2, 10)];
    expect(idsARemover(registros, { maximoPorCenario: 2, idadeMaximaDias: 1 }, 1000)).toEqual([]);
  });
});

describe('execução interrompida', () => {
  it('fecha como interrompida com as iterações já gravadas, e a que estava em curso fica incompleta', () => {
    const sessao: SessaoEmAndamento = sessaoAtiva().sessao!;
    const andamento = sessao.cenario!.andamento;
    andamento.estado = 'executando';
    andamento.iteracoes = [...andamento.iteracoes.slice(0, 2), { numero: 3, inicio: 4000, fim: null, completa: true, passosExecutados: 1 }];
    const fechada = interromperRegistro(registroEmAndamento(sessao), 9000, Infinity);

    expect(fechada.registro).toMatchObject({ id: 'exec-1', estado: 'interrompida', fim: 9000, andamento: null });
    expect(fechada.registro.resumo).toMatchObject({
      desfecho: 'interrompida',
      cenario: { estadoFinal: 'erro', iteracoesCompletas: 2, iteracoesIncompletas: 1 },
    });
    expect(fechada.registro.resumo?.cenario?.falhas.at(-1)).toMatchObject({ iteracao: 3, motivo: 'A extensão foi suspensa durante a execução.' });
    expect(fechada.dados.longTasks).toHaveLength(300);
    expect(fechada.dados.medicoes).toHaveLength(3);
  });

  it('sessão manual interrompida mantém os dados', () => {
    const inicio = iniciar(estadoInicial(), { id: 'manual-1', idAba: 5, url: 'http://localhost:4300/', selecao: ['processamento'], inicio: 10, idsScripts: [] });
    if (!inicio.ok) throw new Error('não iniciou');
    inicio.estado.sessao!.dados.longTasks.push({ inicio: 20, duracao: 80 });
    const fechada = interromperRegistro(registroEmAndamento(inicio.estado.sessao!), 500, Infinity);
    expect(fechada.registro).toMatchObject({ estado: 'interrompida', tipo: 'sessao-manual', resumo: { desfecho: 'interrompida', cenario: null } });
    expect(fechada.dados.longTasks).toEqual([{ inicio: 20, duracao: 80 }]);
  });
});

describe('resultado parcial', () => {
  it('só uma execução de cenário concluída serve de referência', () => {
    expect(podeSerReferencia(registro({ estado: 'concluida' }))).toBe(true);
    for (const estado of ['interrompida', 'cancelada', 'erro', 'em-andamento'] as const) {
      expect(podeSerReferencia(registro({ estado }))).toBe(false);
      expect(ehParcial(registro({ estado }))).toBe(true);
    }
    expect(ehParcial(registro({ estado: 'concluida' }))).toBe(false);
    expect(podeSerReferencia(registro({ estado: 'concluida', tipo: 'sessao-manual' }))).toBe(false);
  });

  it('com falha de sessão não há estatística, e o resultado não serve de referência', () => {
    const estado = sessaoAtiva();
    const andamento = estado.sessao!.cenario!.andamento;
    andamento.estado = 'erro';
    andamento.falhaDeSessao = { url: 'http://localhost:4300/login', iteracao: 3 };
    const resultado = resultadoDe('erro', estado);
    expect(resultado.cenario).toMatchObject({ falhaDeSessao: { iteracao: 3 }, estatisticas: [] });
    expect(podeSerReferencia({ ...registroFinal(resultado, null, Infinity).registro, estado: 'concluida' })).toBe(false);
  });
});
