import { describe, expect, it } from 'vitest';
import {
  PERFIL_NENHUM,
  PERFIL_PADRAO,
  PERFIL_PERSONALIZADO,
  type PerfilThrottling,
  SEM_CONDICOES,
  casaUrlLogin,
  chaveDasCondicoes,
  condicoesDe,
  descreverCondicoes,
  erroDoPerfil,
  perfisDisponiveis,
  resolverThrottling,
  semLimitacao,
} from './condicoes.ts';

const LENTO: PerfilThrottling = { nome: 'celular-antigo', cpu: 6, rede: { latenciaMs: 300, downloadKbps: 400, uploadKbps: 200 } };

describe('perfis de throttling', () => {
  it('"nenhum" não limita nada, e sem `throttling` vale "nenhum"', () => {
    expect(PERFIL_NENHUM).toEqual({ nome: 'nenhum', cpu: 1, rede: null });
    expect(semLimitacao(PERFIL_NENHUM)).toBe(true);
    expect(resolverThrottling(undefined, [])).toEqual({ ok: true, perfil: PERFIL_NENHUM });
    expect(resolverThrottling(null, [])).toEqual({ ok: true, perfil: PERFIL_NENHUM });
    expect(resolverThrottling('nenhum', [])).toEqual({ ok: true, perfil: PERFIL_NENHUM });
  });

  it('"padrao" é CPU 4× e rede 4G lenta', () => {
    expect(resolverThrottling('padrao', [])).toEqual({
      ok: true,
      perfil: { nome: 'padrao', cpu: 4, rede: { latenciaMs: 150, downloadKbps: 1600, uploadKbps: 750 } },
    });
    expect(semLimitacao(PERFIL_PADRAO)).toBe(false);
  });

  it('resolve um perfil salvo pelo nome', () => {
    expect(resolverThrottling('celular-antigo', [LENTO])).toEqual({ ok: true, perfil: LENTO });
  });

  it('resolve valores declarados no cenário, com CPU 6 e latência de 300 ms', () => {
    const resolucao = resolverThrottling({ cpu: 6, rede: { latencia_ms: 300 } }, []);
    expect(resolucao).toEqual({
      ok: true,
      perfil: { nome: PERFIL_PERSONALIZADO, cpu: 6, rede: { latenciaMs: 300, downloadKbps: null, uploadKbps: null } },
    });
  });

  it('valores inline parciais: só a rede, com as taxas', () => {
    expect(resolverThrottling({ rede: { download_kbps: 500, upload_kbps: 0 } }, [])).toEqual({
      ok: true,
      perfil: { nome: PERFIL_PERSONALIZADO, cpu: 1, rede: { latenciaMs: 0, downloadKbps: 500, uploadKbps: null } },
    });
  });

  it('perfil inexistente é erro, e a mensagem lista os disponíveis', () => {
    const resolucao = resolverThrottling('3g', [LENTO]);
    expect(resolucao).toEqual({
      ok: false,
      mensagem: 'O perfil de throttling "3g" não existe. Perfis disponíveis: "nenhum", "padrao", "celular-antigo".',
    });
  });

  it('lista os embutidos antes dos salvos, e um salvo não substitui um embutido', () => {
    const impostor: PerfilThrottling = { nome: 'padrao', cpu: 20, rede: null };
    expect(perfisDisponiveis([LENTO, impostor]).map((p) => p.nome)).toEqual(['nenhum', 'padrao', 'celular-antigo']);
    expect(resolverThrottling('padrao', [impostor])).toEqual({ ok: true, perfil: PERFIL_PADRAO });
  });

  it('confere um perfil informado pelo usuário', () => {
    expect(erroDoPerfil(LENTO)).toBeNull();
    expect(erroDoPerfil({ ...LENTO, nome: '  ' })).toMatch(/nome/);
    expect(erroDoPerfil({ ...LENTO, nome: 'padrao' })).toMatch(/reservado/);
    expect(erroDoPerfil({ ...LENTO, cpu: 0.5 })).toMatch(/CPU/);
    expect(erroDoPerfil({ ...LENTO, rede: { latenciaMs: -1, downloadKbps: null, uploadKbps: null } })).toMatch(/latência/);
    expect(erroDoPerfil({ ...LENTO, rede: { latenciaMs: 0, downloadKbps: 0, uploadKbps: null } })).toMatch(/taxas/);
  });
});

describe('condições efetivas', () => {
  it('registram os números do perfil, não só o nome', () => {
    expect(condicoesDe(PERFIL_PADRAO, { desligado: true, limpo: true })).toEqual({
      perfil: 'padrao',
      cpu: 4,
      rede: { latenciaMs: 150, downloadKbps: 1600, uploadKbps: 750 },
      cacheDesligado: true,
      cacheLimpo: true,
      storageLimpo: [],
    });
  });

  it('a chave muda com os números, e não com o nome do perfil', () => {
    const padrao = condicoesDe(PERFIL_PADRAO, { desligado: true, limpo: true });
    const mesmoComOutroNome = condicoesDe({ ...PERFIL_PADRAO, nome: 'meu-4g' }, { desligado: true, limpo: true });
    expect(chaveDasCondicoes(mesmoComOutroNome)).toBe(chaveDasCondicoes(padrao));
    expect(chaveDasCondicoes(condicoesDe({ ...PERFIL_PADRAO, cpu: 6 }, { desligado: true, limpo: true }))).not.toBe(chaveDasCondicoes(padrao));
    expect(chaveDasCondicoes(condicoesDe(PERFIL_PADRAO, { desligado: false, limpo: true }))).not.toBe(chaveDasCondicoes(padrao));
    expect(chaveDasCondicoes(SEM_CONDICOES)).not.toBe(chaveDasCondicoes(padrao));
  });

  it('descreve em texto', () => {
    expect(descreverCondicoes(SEM_CONDICOES)).toBe('sem limitação');
    expect(descreverCondicoes(PERFIL_PADRAO)).toBe('CPU 4× mais lenta; rede com 150 ms de latência, download de 1600 kbps e upload de 750 kbps');
  });
});

describe('URL de login', () => {
  it('sem asterisco, o padrão é um prefixo', () => {
    expect(casaUrlLogin('http://localhost:4300/login', 'http://localhost:4300/login')).toBe(true);
    expect(casaUrlLogin('http://localhost:4300/login?voltar=%2Fprotegida', 'http://localhost:4300/login')).toBe(true);
  });

  it('não casa com outra página nem com outra origem', () => {
    expect(casaUrlLogin('http://localhost:4300/protegida', 'http://localhost:4300/login')).toBe(false);
    expect(casaUrlLogin('http://outro.exemplo/login', 'http://localhost:4300/login')).toBe(false);
  });

  it('com asterisco, cada um vale qualquer trecho e o padrão cobre a URL inteira', () => {
    expect(casaUrlLogin('https://sso.exemplo.com/auth/realms/app/login?x=1', 'https://sso.exemplo.com/*/login*')).toBe(true);
    expect(casaUrlLogin('https://app.exemplo.com/entrar', '*/entrar')).toBe(true);
    expect(casaUrlLogin('https://app.exemplo.com/entrar/ajuda', '*/entrar')).toBe(false);
    // O ponto do padrão é literal, não "qualquer caractere".
    expect(casaUrlLogin('https://ssoXexemplo.com/login', 'https://sso.exemplo.com/*')).toBe(false);
  });

  it('um padrão que começa com "/" é comparado com o caminho, em qualquer origem', () => {
    expect(casaUrlLogin('http://localhost:4300/login?voltar=x', '/login')).toBe(true);
    expect(casaUrlLogin('http://localhost:4300/#/login', '/#/login')).toBe(true);
    expect(casaUrlLogin('http://localhost:4300/conta/login', '/login')).toBe(false);
    expect(casaUrlLogin('http://localhost:4300/conta/login', '/*/login')).toBe(true);
    expect(casaUrlLogin('nao-e-url', '/login')).toBe(false);
  });
});
