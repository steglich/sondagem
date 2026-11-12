import { describe, expect, it } from 'vitest';
import { outrasExtensoesAtivas } from './extensoes.ts';

const PROPRIA = 'idsondagem';

describe('outras extensões ativas', () => {
  it('lista as extensões ligadas, fora a própria, em ordem alfabética', () => {
    const instaladas = [
      { id: PROPRIA, name: 'Sondagem', enabled: true, type: 'extension' },
      { id: 'b', name: 'Tradutor', enabled: true, type: 'extension' },
      { id: 'a', name: 'Bloqueador', enabled: true, type: 'extension' },
    ];
    expect(outrasExtensoesAtivas(instaladas, PROPRIA)).toEqual([
      { id: 'a', nome: 'Bloqueador' },
      { id: 'b', nome: 'Tradutor' },
    ]);
  });

  it('desligadas, temas e aplicativos não contam', () => {
    const instaladas = [
      { id: 'a', name: 'Desligada', enabled: false, type: 'extension' },
      { id: 'b', name: 'Tema escuro', enabled: true, type: 'theme' },
      { id: 'c', name: 'Aplicativo', enabled: true, type: 'hosted_app' },
    ];
    expect(outrasExtensoesAtivas(instaladas, PROPRIA)).toEqual([]);
  });

  it('perfil limpo: só a própria extensão', () => {
    expect(outrasExtensoesAtivas([{ id: PROPRIA, name: 'Sondagem', enabled: true, type: 'extension' }], PROPRIA)).toEqual([]);
  });
});
