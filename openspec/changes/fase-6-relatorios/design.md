# Design

## Context

Depende da fase 5: repositório em IndexedDB com `execucoes` (leve) e `detalhes` (pesado). A rota `relatorio` existe vazia desde a fase 0. O relatório roda em aba própria, separado do side panel, então seu custo não afeta a medição. A restrição que resta é a do plano (seção 3.5): não travar com dados grandes.

## Goals / Non-Goals

**Goals:**
- Relatório lido direto do repositório, sem passar pelo service worker.
- Comparação e exportação como funções puras em `shared/`, testáveis sem interface.

**Non-Goals:**
- Importar resultados exportados.
- Comparar mais de duas execuções ou cenários diferentes.
- Relatório em PDF ou HTML autônomo.
- Timeline ao vivo (fase 7 do plano).

## Decisions

### Endereçamento por rota
`#/relatorio/:id` para uma execução e `#/relatorio/comparar/:idA/:idB` para a comparação. O histórico do side panel abre essas URLs em nova aba. A página lê o IndexedDB da extensão diretamente (mesma origem).

### Carregamento em duas etapas
A abertura lê só o registro de `execucoes` (metadados e estatísticas) e desenha o resumo. Cada seção (memória, processamento, CPU, erros) é um bloco `@defer` que busca sua parte em `detalhes` ao ser aberta ou ao entrar na área visível.

### uPlot para gráficos
Pequeno, rápido em canvas, sem `eval` e sem dependências. Um componente Angular fino o encapsula e recebe as séries por signal. Alternativa descartada: Chart.js, maior e mais lento com muitas séries; SVG feito à mão, mais trabalho para eixos e interação.

### Rolagem virtual com Angular CDK
`cdk-virtual-scroll-viewport` nas listas de construtores, long tasks, interações, funções e erros. Componentes `OnPush` com signals.

### Comparação como função pura
`compararExecucoes(a, b)` devolve, por métrica, valores, diferença absoluta e percentual, e a lista de diferenças de condições e de ambiente. Recusa cenários diferentes e resultados não completos. A direção de "melhor" é definida por métrica (menor é melhor para todas as atuais).

### Linha de base em `chrome.storage.local`
Por cenário: id da execução de referência e limites por métrica (padrão de 10% para todas). Guardada fora do IndexedDB porque é preferência, não resultado. Se a execução de referência for removida pela retenção, a linha de base é desfeita e o usuário é avisado; a política de retenção nunca remove a execução marcada como referência.

### Exportação por Blob
JSON: registro completo mais `versao_exportacao: 1`. CSV: gerado por função pura com escape conforme RFC 4180, separador vírgula e BOM UTF-8 para abrir em planilhas. O download usa um link com `download` na própria página, sem a permissão `downloads`. Os valores mascarados na fase 5 já chegam mascarados.

### Suposições registradas
- Limite de regressão padrão: 10% por métrica.
- CSV com vírgula como separador e ponto como separador decimal.

## Risks / Trade-offs

- [Vírgula como separador abre errado em planilhas com localidade pt-BR] → Opção de separador ponto e vírgula na exportação.
- [Comparação entre execuções com verificações diferentes] → Só as métricas presentes nas duas são comparadas; as demais aparecem como "sem dado".
- [Mudança de formato dos resultados em fases futuras] → O registro carrega a versão do formato, e o relatório informa quando encontra uma versão que não conhece.
