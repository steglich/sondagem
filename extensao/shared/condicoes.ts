/**
 * Condições de teste: perfis de throttling, resolução do que o cenário declara e
 * casamento da URL de login. Funções puras; quem aplica é `background/condicoes.ts`.
 */
import type { Throttling, TipoStorage } from './cenario.ts';
import type { CondicoesDeTeste, CondicoesRede } from './types.ts';

/** Um perfil de throttling com valores numéricos. */
export interface PerfilThrottling {
  nome: string;
  /** Fator de desaceleração da CPU; 1 é sem limitação. */
  cpu: number;
  rede: CondicoesRede | null;
}

export const PERFIL_NENHUM: PerfilThrottling = { nome: 'nenhum', cpu: 1, rede: null };

/** CPU 4 vezes mais lenta e rede equivalente ao "Slow 4G" do Lighthouse. */
export const PERFIL_PADRAO: PerfilThrottling = {
  nome: 'padrao',
  cpu: 4,
  rede: { latenciaMs: 150, downloadKbps: 1600, uploadKbps: 750 },
};

export const PERFIS_EMBUTIDOS: readonly PerfilThrottling[] = [PERFIL_NENHUM, PERFIL_PADRAO];

/** Nome registrado quando os valores vêm declarados no próprio cenário. */
export const PERFIL_PERSONALIZADO = 'personalizado';

/** Embutidos primeiro, depois os salvos pelo usuário em ordem alfabética. */
export function perfisDisponiveis(salvos: readonly PerfilThrottling[]): PerfilThrottling[] {
  const embutidos = new Set(PERFIS_EMBUTIDOS.map((perfil) => perfil.nome));
  const proprios = salvos.filter((perfil) => !embutidos.has(perfil.nome)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return [...PERFIS_EMBUTIDOS, ...proprios];
}

export type ResolucaoThrottling = { ok: true; perfil: PerfilThrottling } | { ok: false; mensagem: string };

/**
 * Resolve o `throttling` declarado: ausente vale "nenhum"; texto é o nome de um
 * perfil embutido ou salvo; objeto são valores personalizados. Perfil que não
 * existe é erro, com a lista dos disponíveis.
 */
export function resolverThrottling(throttling: Throttling | null | undefined, salvos: readonly PerfilThrottling[]): ResolucaoThrottling {
  if (throttling === undefined || throttling === null) return { ok: true, perfil: PERFIL_NENHUM };
  if (typeof throttling === 'string') {
    const disponiveis = perfisDisponiveis(salvos);
    const perfil = disponiveis.find((p) => p.nome === throttling);
    if (perfil) return { ok: true, perfil };
    const nomes = disponiveis.map((p) => `"${p.nome}"`).join(', ');
    return { ok: false, mensagem: `O perfil de throttling "${throttling}" não existe. Perfis disponíveis: ${nomes}.` };
  }
  const rede = throttling.rede;
  // Taxa ausente ou zero: sem limite naquela direção.
  const taxa = (valor: number | undefined): number | null => (valor !== undefined && valor > 0 ? valor : null);
  return {
    ok: true,
    perfil: {
      nome: PERFIL_PERSONALIZADO,
      cpu: throttling.cpu ?? 1,
      rede: rede ? { latenciaMs: rede.latencia_ms ?? 0, downloadKbps: taxa(rede.download_kbps), uploadKbps: taxa(rede.upload_kbps) } : null,
    },
  };
}

/** `true` se o perfil não muda nada na aba. */
export function semLimitacao(perfil: Pick<PerfilThrottling, 'cpu' | 'rede'>): boolean {
  return perfil.cpu === 1 && perfil.rede === null;
}

/** Sessão manual sem escolha de throttling: nada é alterado nem limpo. */
export const SEM_CONDICOES: CondicoesDeTeste = {
  perfil: PERFIL_NENHUM.nome,
  cpu: 1,
  rede: null,
  cacheDesligado: false,
  cacheLimpo: false,
  storageLimpo: [],
};

export function condicoesDe(
  perfil: PerfilThrottling,
  cache: { desligado: boolean; limpo: boolean; storageLimpo?: readonly TipoStorage[] },
): CondicoesDeTeste {
  return {
    perfil: perfil.nome,
    cpu: perfil.cpu,
    rede: perfil.rede ? { ...perfil.rede } : null,
    cacheDesligado: cache.desligado,
    cacheLimpo: cache.limpo,
    storageLimpo: [...(cache.storageLimpo ?? [])],
  };
}

/**
 * Texto que identifica condições iguais, para comparar só execuções feitas do mesmo
 * jeito. Usa os números, não o nome: um perfil editado deixa de ser comparável.
 */
export function chaveDasCondicoes(condicoes: CondicoesDeTeste): string {
  const rede = condicoes.rede ? `${condicoes.rede.latenciaMs}/${condicoes.rede.downloadKbps ?? '-'}/${condicoes.rede.uploadKbps ?? '-'}` : '-';
  const storage = [...condicoes.storageLimpo].sort().join('+') || '-';
  return `cpu=${condicoes.cpu};rede=${rede};cache=${condicoes.cacheDesligado ? 'desligado' : 'ligado'};limpo=${condicoes.cacheLimpo ? 's' : 'n'};storage=${storage}`;
}

/** Texto curto das condições, para a confirmação, o resultado e o histórico. */
export function descreverCondicoes(condicoes: Pick<CondicoesDeTeste, 'cpu' | 'rede'>): string {
  const partes: string[] = [];
  if (condicoes.cpu !== 1) partes.push(`CPU ${condicoes.cpu}× mais lenta`);
  if (condicoes.rede) {
    const taxa = (kbps: number | null): string => (kbps === null ? 'sem limite' : `${kbps} kbps`);
    partes.push(
      `rede com ${condicoes.rede.latenciaMs} ms de latência, download de ${taxa(condicoes.rede.downloadKbps)} e upload de ${taxa(condicoes.rede.uploadKbps)}`,
    );
  }
  return partes.length ? partes.join('; ') : 'sem limitação';
}

/** Confere um perfil informado pelo usuário. Devolve a mensagem do erro, ou `null`. */
export function erroDoPerfil(perfil: PerfilThrottling): string | null {
  const nome = perfil.nome.trim();
  if (!nome) return 'Dê um nome ao perfil.';
  if (PERFIS_EMBUTIDOS.some((p) => p.nome === nome) || nome === PERFIL_PERSONALIZADO) return `O nome "${nome}" é reservado.`;
  if (!Number.isFinite(perfil.cpu) || perfil.cpu < 1) return 'O fator de CPU deve ser um número maior ou igual a 1.';
  if (perfil.rede) {
    const { latenciaMs, downloadKbps, uploadKbps } = perfil.rede;
    if (!Number.isFinite(latenciaMs) || latenciaMs < 0) return 'A latência deve ser um número maior ou igual a zero.';
    for (const taxa of [downloadKbps, uploadKbps]) {
      if (taxa !== null && (!Number.isFinite(taxa) || taxa <= 0)) return 'As taxas de download e upload devem ser maiores que zero (ou vazias, para não limitar).';
    }
  }
  return null;
}

/**
 * `true` se a URL é a de login declarada em `sessao.url_login`. Sem `*`, o padrão é
 * um prefixo; com `*`, cada asterisco vale qualquer trecho e o padrão cobre a URL
 * inteira. Um padrão que começa com `/` é comparado com o caminho (sem a origem).
 */
export function casaUrlLogin(url: string, padrao: string): boolean {
  let alvo = url;
  if (padrao.startsWith('/')) {
    try {
      const partes = new URL(url);
      alvo = partes.pathname + partes.search + partes.hash;
    } catch {
      return false;
    }
  }
  if (!padrao.includes('*')) return alvo.startsWith(padrao);
  const expressao = padrao
    .split('*')
    .map((trecho) => trecho.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${expressao}$`).test(alvo);
}
