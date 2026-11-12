/** Apoio de teste: registros do histórico montados à mão, só com o que os testes olham. */
import { dadosVazios } from './agregacao.ts';
import type { ExecucaoGuardada, RegistroExecucao } from './historico.ts';
import type { DadosColetados, IdMetricaIteracao, RegistroIteracao, ResultadoCenario } from './types.ts';

export type Medianas = Partial<Record<IdMetricaIteracao, number | null>>;

export const CONDICOES_PADRAO: RegistroExecucao['condicoes'] = {
  perfil: 'padrao',
  cpu: 4,
  rede: { latenciaMs: 150, downloadKbps: 1600, uploadKbps: 750 },
  cacheDesligado: true,
  cacheLimpo: true,
  storageLimpo: [],
};

/** Iterações de 1 segundo, coladas, a partir de `inicio`. */
export function iteracoes(quantidade: number, inicio = 1000): RegistroIteracao[] {
  return Array.from({ length: quantidade }, (_, i) => ({
    numero: i + 1,
    inicio: inicio + i * 1000,
    fim: inicio + (i + 1) * 1000,
    completa: true,
    passosExecutados: 3,
  }));
}

/** Execução de cenário concluída, com as medianas dadas e o que o teste quiser trocar. */
export function execucaoDeTeste(
  id: string,
  medianas: Medianas = {},
  parcial: Partial<RegistroExecucao> = {},
  cenario: Partial<ResultadoCenario> = {},
): RegistroExecucao {
  const nome = parcial.nomeCenario === undefined ? 'abrir-fechar' : parcial.nomeCenario;
  const configuracao = { nome: nome ?? '', urlInicial: 'http://localhost:4300/limpa', iteracoes: 5, throttling: 'padrao' as const, versaoBuild: parcial.versaoBuild ?? null };
  const ambiente = { versaoNavegador: '158.0.8127.18', userAgent: 'Mozilla/5.0 Chrome/158.0.0.0', janela: { largura: 1280, altura: 720 }, dpr: 1 };
  const registro: RegistroExecucao = {
    id,
    versaoFormato: 1,
    tipo: 'cenario',
    estado: 'concluida',
    grupo: `cenario:${nome}`,
    nomeCenario: nome,
    url: configuracao.urlInicial,
    inicio: 1000,
    fim: 6000,
    selecao: ['processamento'],
    versaoBuild: null,
    navegador: { versao: ambiente.versaoNavegador, userAgent: ambiente.userAgent },
    ambiente,
    condicoes: CONDICOES_PADRAO,
    chaveCondicoes: 'cpu=4',
    extensoes: [],
    definicao: null,
    configuracao,
    andamento: null,
    resumo: null,
    tamanho: 100,
    truncado: [],
    ...parcial,
  };
  if (parcial.resumo !== undefined) return registro;
  registro.resumo = {
    id,
    tipo: registro.tipo,
    desfecho: registro.estado === 'em-andamento' ? 'interrompida' : registro.estado,
    url: registro.url,
    selecao: registro.selecao,
    inicio: registro.inicio,
    fim: registro.fim ?? registro.inicio,
    limpeza: [],
    paginaRespondeu: true,
    conexaoPerdida: null,
    cenario:
      registro.tipo === 'cenario'
        ? {
            configuracao: registro.configuracao ?? configuracao,
            estadoFinal: 'concluida',
            ambiente: registro.ambiente,
            iteracoes: iteracoes(5),
            iteracoesCompletas: 5,
            iteracoesIncompletas: 0,
            passosExecutados: 15,
            falhas: [],
            falhaDeSessao: null,
            estatisticas: Object.entries(medianas).map(([metrica, mediana]) => ({
              id: metrica as IdMetricaIteracao,
              amostras: mediana === null ? 0 : 5,
              mediana,
              p75: mediana,
              p95: mediana,
            })),
            ...cenario,
          }
        : null,
    memoria: null,
    condicoes: registro.condicoes,
    extensoes: registro.extensoes,
    navegador: registro.navegador,
    truncado: registro.truncado,
  };
  return registro;
}

export function guardadaDeTeste(registro: RegistroExecucao, dados: Partial<DadosColetados> = {}): ExecucaoGuardada {
  return { registro, dados: { ...dadosVazios(), ...dados } };
}
