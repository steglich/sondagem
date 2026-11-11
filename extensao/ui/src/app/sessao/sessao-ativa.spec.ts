import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { EstadoExecucao, VisaoSessao } from '../../../../shared/types';
import { URL_TESTE, visaoAtiva } from './apoio-teste';
import { SessaoAtiva } from './sessao-ativa';

function montar(execucao: VisaoSessao['execucao'], errosPagina = 0) {
  const fixture = TestBed.createComponent(SessaoAtiva);
  fixture.componentRef.setInput('url', URL_TESTE);
  fixture.componentRef.setInput('status', visaoAtiva({ errosPagina }).status);
  fixture.componentRef.setInput('execucao', execucao);
  fixture.detectChanges();
  const raiz = fixture.nativeElement as HTMLElement;
  return {
    texto: (id: string) => raiz.querySelector(`[data-testid="${id}"]`)?.textContent?.trim(),
    existe: (id: string) => raiz.querySelector(`[data-testid="${id}"]`) !== null,
    fixture,
  };
}

const execucao = (estado: EstadoExecucao, iteracao: number, totalIteracoes = 20): VisaoSessao['execucao'] => ({
  nome: 'abrir-fechar',
  estado,
  iteracao,
  totalIteracoes,
});

describe('SessaoAtiva', () => {
  it('sessão manual: sem estado de execução, com "Parar" e "Cancelar"', () => {
    const { existe } = montar(null);
    expect(existe('execucao-estado')).toBe(false);
    expect(existe('parar')).toBe(true);
    expect(existe('cancelar')).toBe(true);
  });

  it('cenário: mostra o progresso como "iteração 7 de 20"', () => {
    const { texto } = montar(execucao('executando', 7));
    expect(texto('execucao-cenario')).toBe('abrir-fechar');
    expect(texto('execucao-estado')).toBe('Executando');
    expect(texto('execucao-progresso')).toBe('iteração 7 de 20');
  });

  it.each([
    ['preparando', 'Preparando: abrindo a URL inicial'],
    ['aquecendo', 'Aquecendo'],
    ['executando', 'Executando'],
    ['coletando', 'Coletando'],
  ] as const)('cenário no estado %s mostra "%s"', (estado, rotulo) => {
    expect(montar(execucao(estado, 0)).texto('execucao-estado')).toBe(rotulo);
  });

  it('antes da primeira iteração, o progresso é 0 de N', () => {
    expect(montar(execucao('aquecendo', 0, 5)).texto('execucao-progresso')).toBe('0 de 5 iterações');
  });

  it('cenário só pode ser cancelado: não há "Parar"', () => {
    const { existe, fixture } = montar(execucao('executando', 3));
    let cancelou = false;
    fixture.componentInstance.cancelar.subscribe(() => (cancelou = true));
    expect(existe('parar')).toBe(false);
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="cancelar"]')!.click();
    expect(cancelou).toBe(true);
  });

  it('mostra a contagem de erros da página quando há algum', () => {
    expect(montar(null).existe('status-erros-pagina')).toBe(false);
    expect(montar(null, 3).texto('status-erros-pagina')).toBe('3');
  });
});
