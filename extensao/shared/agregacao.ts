import type {
  DadosColetados,
  Lote,
  MetricasCarregamento,
  MetricasParciais,
  StatusResumido,
} from './types.ts';

export function dadosVazios(): DadosColetados {
  return { longTasks: [], interacoes: [], documentos: [] };
}

/** Junta um lote vindo da página aos dados da sessão. Altera e devolve `dados`. */
export function aplicarLote(dados: DadosColetados, lote: Lote): DadosColetados {
  dados.longTasks.push(...lote.longTasks);

  // A mesma interação pode chegar em dois lotes (pointerdown em um, click no seguinte):
  // fica o registro mais demorado.
  for (const interacao of lote.interacoes) {
    const existente = dados.interacoes.find((i) => i.id === interacao.id && i.documento === interacao.documento);
    if (!existente) dados.interacoes.push(interacao);
    else if (interacao.duracao > existente.duracao) Object.assign(existente, interacao);
  }

  let documento = dados.documentos.find((d) => d.id === lote.documento.id);
  if (!documento) {
    documento = { ...lote.documento, metricas: {} };
    dados.documentos.push(documento);
  }
  documento.url = lote.documento.url;
  Object.assign(documento.metricas, lote.metricas);
  return dados;
}

export function resumir(dados: DadosColetados): StatusResumido {
  return {
    longTasks: dados.longTasks.length,
    interacoes: dados.interacoes.length,
    piorLongTask: dados.longTasks.length ? Math.max(...dados.longTasks.map((t) => t.duracao)) : null,
    carregamentos: dados.documentos.length,
  };
}

/** Métrica que o navegador não produziu vira `null` (indisponível), nunca zero. */
export function metricasDeCarregamento(metricas: MetricasParciais): MetricasCarregamento {
  return {
    lcp: metricas.LCP ?? null,
    cls: metricas.CLS ?? null,
    fcp: metricas.FCP ?? null,
    ttfb: metricas.TTFB ?? null,
  };
}

/** INP da análise: o pior INP entre os documentos observados, ou `null` se nenhum produziu. */
export function inpDaAnalise(dados: DadosColetados): number | null {
  const valores = dados.documentos.map((d) => d.metricas.INP).filter((v) => v !== undefined);
  return valores.length ? Math.max(...valores) : null;
}
