import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { CENARIO_TESTE, PonteSimulada } from '../sessao/apoio-teste';
import { PonteExtensao } from '../sessao/ponte';
import { Cenarios } from './cenarios';

describe('Cenarios', () => {
  let ponte: PonteSimulada;
  let fixture: ComponentFixture<Cenarios>;

  beforeEach(() => {
    ponte = new PonteSimulada();
    TestBed.configureTestingModule({ providers: [{ provide: PonteExtensao, useValue: ponte }] });
  });

  async function assentar(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((resolver) => setTimeout(resolver));
    fixture.detectChanges();
  }

  async function abrir(): Promise<void> {
    fixture = TestBed.createComponent(Cenarios);
    await assentar();
  }

  const raiz = (): HTMLElement => fixture.nativeElement as HTMLElement;
  function porId<T extends HTMLElement>(id: string): T {
    const elemento = raiz().querySelector<T>(`[data-testid="${id}"]`);
    if (!elemento) throw new Error(`data-testid="${id}" não encontrado`);
    return elemento;
  }
  const existe = (id: string): boolean => raiz().querySelector(`[data-testid="${id}"]`) !== null;
  const nomes = (): string[] =>
    Array.from(raiz().querySelectorAll('[data-testid="cenario"] input'), (campo) =>
      campo.getAttribute('data-testid')!.replace('selecionar-cenario-', ''),
    );

  async function colar(texto: string): Promise<void> {
    const area = porId<HTMLTextAreaElement>('texto-cenario');
    area.value = texto;
    area.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    porId('salvar-cenario').click();
    await assentar();
  }

  async function carregar(conteudo: string, nome = 'cenario.json'): Promise<void> {
    const campo = porId<HTMLInputElement>('arquivo-cenario');
    const arquivo = new File([conteudo], nome, { type: 'application/json' });
    Object.defineProperty(campo, 'files', { value: [arquivo], configurable: true });
    campo.dispatchEvent(new Event('change'));
    await assentar();
  }

  const texto = (cenario: unknown): string => JSON.stringify(cenario, null, 2);

  it('sem cenários salvos, mostra a lista vazia com "Nenhum" selecionado', async () => {
    await abrir();
    expect(existe('sem-cenarios')).toBe(true);
    expect(porId<HTMLInputElement>('selecionar-nenhum').checked).toBe(true);
    expect(porId<HTMLButtonElement>('salvar-cenario').disabled).toBe(true);
  });

  it('lista os cenários salvos com o selecionado marcado', async () => {
    ponte.cenarios.set('abrir-fechar', CENARIO_TESTE);
    ponte.cenarios.set('busca', { ...CENARIO_TESTE, nome: 'busca' });
    ponte.cenarioSelecionado = 'busca';
    await abrir();

    expect(nomes()).toEqual(['abrir-fechar', 'busca']);
    expect(porId<HTMLInputElement>('selecionar-cenario-busca').checked).toBe(true);
    expect(porId<HTMLInputElement>('selecionar-cenario-abrir-fechar').checked).toBe(false);
  });

  it('texto colado válido: salva, lista e seleciona o cenário', async () => {
    await abrir();
    await colar(texto(CENARIO_TESTE));

    expect(ponte.cenarios.get('abrir-fechar')).toEqual(CENARIO_TESTE);
    expect(ponte.cenarioSelecionado).toBe('abrir-fechar');
    expect(nomes()).toEqual(['abrir-fechar']);
    expect(porId<HTMLInputElement>('selecionar-cenario-abrir-fechar').checked).toBe(true);
    expect(porId('cenario-salvo').textContent).toContain('abrir-fechar');
    expect(existe('erros-cenario')).toBe(false);
    expect(porId<HTMLTextAreaElement>('texto-cenario').value).toBe('');
  });

  it('arquivo válido: o cenário aparece na lista e pode ser escolhido', async () => {
    await abrir();
    await carregar(texto(CENARIO_TESTE));

    expect(nomes()).toEqual(['abrir-fechar']);
    expect(ponte.cenarioSelecionado).toBe('abrir-fechar');
  });

  it('cenário inválido: não salva e mostra cada erro com o caminho do campo', async () => {
    await abrir();
    const invalido = structuredClone(CENARIO_TESTE) as unknown as { passos: { vezes: unknown; passos: Record<string, unknown>[] }[] };
    delete invalido.passos[0]!.passos[0]!['seletor'];
    invalido.passos[0]!.passos[1]!['em_erro'] = 'ignorar';
    invalido.passos[0]!.vezes = 0;
    await colar(texto(invalido));

    expect(ponte.cenarios.size).toBe(0);
    expect(existe('cenario-salvo')).toBe(false);
    const caminhos = Array.from(raiz().querySelectorAll('[data-testid="erro-cenario-caminho"]'), (e) => e.textContent);
    expect(caminhos.sort()).toEqual(['/passos/0/passos/0/seletor', '/passos/0/passos/1/em_erro', '/passos/0/vezes']);
    expect(porId('erros-cenario').textContent).toContain('os 3 erros');
    expect(porId('erros-cenario').textContent).toContain('Campo obrigatório "seletor" ausente.');
    // O texto fica no campo para ser corrigido.
    expect(porId<HTMLTextAreaElement>('texto-cenario').value).not.toBe('');
  });

  it('arquivo com JSON malformado: rejeita indicando linha e coluna', async () => {
    await abrir();
    await carregar('{\n  "versao_esquema": 1,\n  "nome": "x",,\n}');

    expect(ponte.cenarios.size).toBe(0);
    expect(porId('erro-cenario').textContent).toContain('JSON malformado na linha 3, coluna 15');
  });

  it('corrigir o cenário limpa os erros anteriores', async () => {
    await abrir();
    await colar('{');
    expect(existe('erros-cenario')).toBe(true);

    await colar(texto(CENARIO_TESTE));
    expect(existe('erros-cenario')).toBe(false);
    expect(nomes()).toEqual(['abrir-fechar']);
  });

  it('selecionar grava a escolha; "Nenhum" volta para a sessão manual', async () => {
    ponte.cenarios.set('abrir-fechar', CENARIO_TESTE);
    await abrir();

    porId('selecionar-cenario-abrir-fechar').click();
    await assentar();
    expect(ponte.cenarioSelecionado).toBe('abrir-fechar');

    porId('selecionar-nenhum').click();
    await assentar();
    expect(ponte.cenarioSelecionado).toBeNull();
  });

  it('remover tira o cenário da lista e desfaz a seleção dele', async () => {
    ponte.cenarios.set('abrir-fechar', CENARIO_TESTE);
    ponte.cenarios.set('busca', { ...CENARIO_TESTE, nome: 'busca' });
    ponte.cenarioSelecionado = 'busca';
    await abrir();

    porId('remover-cenario-busca').click();
    await assentar();

    expect(nomes()).toEqual(['abrir-fechar']);
    expect(ponte.cenarios.has('busca')).toBe(false);
    expect(porId<HTMLInputElement>('selecionar-nenhum').checked).toBe(true);
  });

  it('salvar um cenário com o nome de outro substitui o anterior', async () => {
    ponte.cenarios.set('abrir-fechar', CENARIO_TESTE);
    await abrir();
    await colar(texto({ ...CENARIO_TESTE, execucao: { iteracoes: 3 } }));

    expect(nomes()).toEqual(['abrir-fechar']);
    expect(ponte.cenarios.get('abrir-fechar')?.execucao?.iteracoes).toBe(3);
  });
});
