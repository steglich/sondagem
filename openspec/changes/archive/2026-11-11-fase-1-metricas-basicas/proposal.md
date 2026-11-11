# Proposal

## Why

Com a extensão carregando (fase 0), o primeiro valor entregue é ver long tasks e Web Vitals de uma página no side panel. Esta fase também fixa as regras de acionamento que valem para todo o produto: nada roda sem clique em "Analisar", e tudo o que foi instalado na página é removido ao final (plano, seções 3.1, 3.3, 3.4 e 3.5).

## What Changes

- Botão "Analisar" no side panel com tela de confirmação (aba alvo, modo e verificações escolhidas).
- Seleção de verificações, com a última escolha lembrada. Nesta fase existem duas: **Processamento** (long tasks e INP) e **Carregamento** (LCP, CLS, FCP, TTFB).
- Observadores injetados na página somente durante a análise, enviando dados agregados em lotes.
- Sessão manual: a extensão observa enquanto o usuário navega, até o clique em "Parar", e mostra a confirmação da limpeza.
- Tratamento de aba fechada ou service worker suspenso durante a sessão.
- Exibição dos resultados no side panel ao final.

Fora desta fase: cenários declarativos e uso do debugger (fase 2), memória (fase 3), CPU (fase 4), persistência em histórico (fase 5).

## Capabilities

### New Capabilities
- `acionamento-analise`: regras de início, confirmação e cancelamento de qualquer análise.
- `selecao-verificacoes`: escolha das verificações que rodam em cada análise e memória dessa escolha.
- `observadores-pagina`: coleta de long tasks, interações lentas e métricas de carregamento dentro da página testada.
- `sessao-manual`: modo de diagnóstico em que a extensão apenas observa a navegação do usuário.

### Modified Capabilities

Nenhuma.

## Impact

- Código: `extensao/injected/observers.ts`, `extensao/background/` (orquestração da sessão), `extensao/shared/types.ts`, componentes do side panel.
- Manifesto: novas permissões `scripting`, `tabs` e permissão de host `<all_urls>`.
- Dependência nova: `web-vitals` (apenas no código injetado).
- Depende de `fase-0-setup` aplicada.
