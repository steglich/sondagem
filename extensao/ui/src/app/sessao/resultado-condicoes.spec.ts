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
    textos: (id: string) => Array.from(raiz.querySelectorAll(`[data-testid="${id}"]`), (e) => e.textContent!.trim().replace(/\s+/g, ' ')),
    existe: (id: string) => raiz.querySelector(`[data-testid="${id}"]`) !== null,
  };
}

describe('Resultado: condições de teste', () => {
  it('execução com "padrao": mostra os valores numéricos aplicados e o estado do cache', () => {
    const { texto } = montar(RESULTADO_CENARIO_FIXO);
    expect(texto('condicoes-cpu')).toBe('4×');
    expect(texto('condicoes-latencia')).toBe('150 ms');
    expect(texto('condicoes-download')).toBe('1600 kbps');
    expect(texto('condicoes-upload')).toBe('750 kbps');
    expect(texto('condicoes-cache')).toBe('limpo antes da análise; desligado durante');
    expect(texto('condicoes-limite-rede')).toContain('WebSockets');
    expect(texto('resultado-navegador')).toBe('158.0.8127.18');
  });

  it('sessão manual sem throttling: nada foi alterado', () => {
    const { texto, existe } = montar(RESULTADO_FIXO);
    expect(texto('condicoes-throttling')).toBe('nenhum (sem limitação)');
    expect(texto('condicoes-cpu')).toBe('1×');
    expect(existe('condicoes-latencia')).toBe(false);
    expect(texto('condicoes-cache')).toBe('como estava no navegador');
    expect(existe('condicoes-limite-rede')).toBe(false);
  });

  it('taxa sem limite e cache mantido ligado', () => {
    const { texto } = montar({
      ...RESULTADO_CENARIO_FIXO,
      condicoes: { ...RESULTADO_CENARIO_FIXO.condicoes, perfil: 'personalizado', rede: { latenciaMs: 300, downloadKbps: null, uploadKbps: null }, cacheDesligado: false },
    });
    expect(texto('condicoes-download')).toBe('sem limite');
    expect(texto('condicoes-cache')).toBe('limpo antes da análise; ligado durante');
  });

  it('mostra o storage apagado a pedido do cenário', () => {
    const semLimpeza = montar(RESULTADO_CENARIO_FIXO);
    expect(semLimpeza.existe('condicoes-storage')).toBe(false);

    const { texto } = montar({ ...RESULTADO_CENARIO_FIXO, condicoes: { ...RESULTADO_CENARIO_FIXO.condicoes, storageLimpo: ['local_storage', 'cookies'] } });
    expect(texto('condicoes-storage')).toBe('localStorage, cookies');
  });

  it('as condições desfeitas aparecem na lista do que foi removido', () => {
    const { textos } = montar({ ...RESULTADO_CENARIO_FIXO, limpeza: [...RESULTADO_CENARIO_FIXO.limpeza, { recurso: 'condicao-de-teste', quantidade: 3 }] });
    expect(textos('item-limpeza').at(-1)).toMatch(/Condições de teste \(throttling e cache\) desfeitas\s*3/);
  });
});

describe('Resultado: outras extensões', () => {
  it('lista as extensões ativas durante a análise e avisa da interferência', () => {
    const { texto } = montar({ ...RESULTADO_FIXO, extensoes: [{ id: 'a', nome: 'Bloqueador' }, { id: 'b', nome: 'Tradutor' }] });
    expect(texto('resultado-extensoes')).toBe('2: Bloqueador, Tradutor');
    expect(texto('resultado-aviso-extensoes')).toContain('perfil limpo');
  });

  it('sem outras extensões, diz "nenhuma" e não avisa', () => {
    const { texto, existe } = montar(RESULTADO_FIXO);
    expect(texto('resultado-extensoes')).toBe('nenhuma');
    expect(existe('resultado-aviso-extensoes')).toBe(false);
  });
});

describe('Resultado: falha de sessão', () => {
  const COM_FALHA: ResultadoSessao = {
    ...RESULTADO_CENARIO_FIXO,
    desfecho: 'erro',
    cenario: {
      ...RESULTADO_CENARIO_FIXO.cenario!,
      estadoFinal: 'erro',
      falhaDeSessao: { url: 'http://localhost:4300/login', iteracao: 6 },
      estatisticas: [],
      falhas: [
        {
          caminho: '/passos/0/passos/0',
          tipoPasso: 'clicar',
          iteracao: 6,
          motivo: 'Falha de sessão: a aplicação redirecionou para a tela de login (http://localhost:4300/login).',
          acao: 'interrompeu',
          falhaDeSessao: true,
        },
      ],
    },
  };

  it('indica a falha de sessão e a iteração, e não apresenta estatísticas', () => {
    const { texto, existe } = montar(COM_FALHA);
    expect(texto('resultado-desfecho')).toBe('Erro na execução');
    expect(texto('resultado-falha-sessao')).toContain('Falha de sessão na iteração 6');
    expect(texto('resultado-falha-sessao')).toContain('http://localhost:4300/login');
    expect(texto('resultado-falha-sessao')).toContain('nenhuma estatística desta execução é válida');
    expect(existe('estatisticas')).toBe(false);
    expect(existe('estatistica')).toBe(false);
  });

  it('execução normal não mostra o aviso e mantém as estatísticas', () => {
    const { existe } = montar(RESULTADO_CENARIO_FIXO);
    expect(existe('resultado-falha-sessao')).toBe(false);
    expect(existe('estatisticas')).toBe(true);
  });
});

describe('Resultado: truncamento', () => {
  it('diz quais listas foram removidas e que as estatísticas estão completas', () => {
    const { texto, existe } = montar({ ...RESULTADO_CENARIO_FIXO, truncado: ['longTasks', 'interacoes'] });
    expect(texto('resultado-truncado')).toContain('long tasks, interações');
    expect(texto('resultado-truncado')).toContain('estatísticas foram calculadas antes e estão completas');
    expect(existe('estatisticas')).toBe(true);
  });

  it('sem truncamento não há aviso', () => {
    expect(montar(RESULTADO_CENARIO_FIXO).existe('resultado-truncado')).toBe(false);
  });
});
