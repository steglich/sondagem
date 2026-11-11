import { describe, expect, it } from 'vitest';
import { criarObservadorSimulado } from './apoio-teste.ts';
import { criarColeta, descreverAlvo } from './observers.ts';

const botao = {
  tagName: 'BUTTON',
  id: '',
  className: 'primario grande',
  getAttribute: (nome: string) => (nome === 'data-testid' ? 'acao-pesada' : null),
};

function coletar(coletores: Parameters<typeof criarColeta>[0]['coletores']) {
  const fabrica = criarObservadorSimulado();
  const coleta = criarColeta({ coletores, Observador: fabrica.Observador, origemTempo: 10_000, documento: 'doc-1' });
  return { fabrica, coleta };
}

describe('coleta de long tasks', () => {
  it('registra início absoluto e duração, acumulando em memória até drenar', () => {
    const { fabrica, coleta } = coletar(['long-tasks']);
    const [observador] = fabrica.doTipo('longtask');

    observador!.emitir([{ startTime: 500, duration: 310 }]);
    observador!.emitir([
      { startTime: 900, duration: 60 },
      { startTime: 1200, duration: 75 },
    ]);

    expect(coleta.drenar().longTasks).toEqual([
      { inicio: 10_500, duracao: 310 },
      { inicio: 10_900, duracao: 60 },
      { inicio: 11_200, duracao: 75 },
    ]);
    expect(coleta.drenar().longTasks).toEqual([]);
  });

  it('não pede entradas anteriores ao início da análise', () => {
    const { fabrica } = coletar(['long-tasks', 'interacoes']);
    expect(fabrica.criados.flatMap((o) => o.opcoes).every((opcoes) => !opcoes.buffered)).toBe(true);
  });
});

describe('coleta de interações', () => {
  it('observa eventos a partir de 40 ms', () => {
    const { fabrica } = coletar(['interacoes']);
    expect(fabrica.doTipo('event')[0]?.opcoes).toEqual([{ type: 'event', durationThreshold: 40 }]);
  });

  it('registra duração, tipo e elemento alvo', () => {
    const { fabrica, coleta } = coletar(['interacoes']);
    fabrica.doTipo('event')[0]!.emitir([
      { name: 'click', startTime: 2000, duration: 320, interactionId: 41, target: botao },
    ]);

    expect(coleta.drenar().interacoes).toEqual([
      {
        id: 41,
        documento: 'doc-1',
        inicio: 12_000,
        duracao: 320,
        tipo: 'click',
        alvo: 'button[data-testid="acao-pesada"]',
      },
    ]);
  });

  it('une os eventos da mesma interação e fica com o mais demorado', () => {
    const { fabrica, coleta } = coletar(['interacoes']);
    fabrica.doTipo('event')[0]!.emitir([
      { name: 'pointerdown', startTime: 2000, duration: 48, interactionId: 41, target: botao },
      { name: 'click', startTime: 2010, duration: 320, interactionId: 41, target: null },
      { name: 'pointerup', startTime: 2008, duration: 56, interactionId: 41, target: botao },
    ]);

    const { interacoes } = coleta.drenar();
    expect(interacoes).toHaveLength(1);
    expect(interacoes[0]).toMatchObject({ tipo: 'click', duracao: 320, alvo: 'button[data-testid="acao-pesada"]' });
  });

  it('o primeiro evento sem alvo recebe o alvo de outro evento da mesma interação, mesmo de igual duração', () => {
    const { fabrica, coleta } = coletar(['interacoes']);
    fabrica.doTipo('event')[0]!.emitir([
      { name: 'pointerdown', startTime: 2000, duration: 304, interactionId: 41, target: null },
      { name: 'pointerup', startTime: 2001, duration: 304, interactionId: 41, target: null },
      { name: 'click', startTime: 2001, duration: 304, interactionId: 41, target: botao },
    ]);

    expect(coleta.drenar().interacoes).toEqual([
      expect.objectContaining({ tipo: 'pointerdown', duracao: 304, alvo: 'button[data-testid="acao-pesada"]' }),
    ]);
  });

  it('ignora eventos que não são interações do usuário', () => {
    const { fabrica, coleta } = coletar(['interacoes']);
    fabrica.doTipo('event')[0]!.emitir([{ name: 'mouseover', startTime: 1, duration: 90, interactionId: 0 }]);
    expect(coleta.drenar().interacoes).toEqual([]);
  });
});

describe('parar', () => {
  it('desconecta os observadores e deixa de acumular', () => {
    const { fabrica, coleta } = coletar(['long-tasks', 'interacoes']);
    const [observador] = fabrica.doTipo('longtask');
    coleta.parar();

    observador!.emitir([{ startTime: 1, duration: 100 }]);
    expect(fabrica.tiposAtivos()).toEqual([]);
    expect(coleta.drenar().longTasks).toEqual([]);
  });
});

describe('descreverAlvo', () => {
  it('prefere data-testid, depois id, depois classes', () => {
    expect(descreverAlvo(botao)).toBe('button[data-testid="acao-pesada"]');
    expect(descreverAlvo({ tagName: 'INPUT', id: 'busca', className: 'campo' })).toBe('input#busca');
    expect(descreverAlvo({ tagName: 'DIV', className: 'cartao destaque largo' })).toBe('div.cartao.destaque');
    expect(descreverAlvo({ tagName: 'svg', className: { baseVal: 'icone' } })).toBe('svg');
  });

  it('indica quando o elemento já não existe', () => {
    expect(descreverAlvo(null)).toBe('(elemento removido)');
  });
});
