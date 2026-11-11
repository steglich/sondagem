# Design

## Context

Depende da fase 0 (estrutura, build e página de teste). Ainda não há debugger nem cenários; esta fase usa só `chrome.scripting` e APIs de performance da própria página. O modo disponível é a sessão manual, que é o caminho mais curto para "resultados aparecem no side panel" e já exercita as regras de acionamento e limpeza.

## Goals / Non-Goals

**Goals:**
- Fluxo completo Analisar → confirmar → observar → Parar → resultado.
- Protocolo de mensagens entre página, service worker e interface, reutilizado pelas fases seguintes.
- Limpeza comprovável de tudo o que a sessão instalou.

**Non-Goals:**
- Debugger, cenários, memória, CPU.
- Histórico: o resultado fica apenas em `chrome.storage.session` até a fase 5.
- Gráficos: o resultado é mostrado em listas e números simples até a fase 6.

## Decisions

### Injeção por content script registrado dinamicamente
No início da sessão, o service worker chama `chrome.scripting.registerContentScripts` (para a origem da aba alvo, `runAt: document_start`) e `chrome.scripting.executeScript` na aba já aberta. No fim, `unregisterContentScripts`. Assim os observadores sobrevivem a recargas e navegações durante a sessão e capturam o carregamento desde o início, e fora de uma sessão nada é injetado. Alternativa descartada: content script estático no manifesto, que injetaria em toda página o tempo todo.

### Mundo isolado
O script roda no mundo isolado (`ISOLATED`). `PerformanceObserver` enxerga a mesma timeline da página, e o isolamento garante que nada é adicionado ao objeto global da página.

### `web-vitals` para LCP, CLS, FCP, TTFB e INP
A biblioteca é pequena, não usa `eval` e cobre os casos de borda de cada métrica (abas em segundo plano, bfcache). Long tasks usam `PerformanceObserver` direto (`longtask`), e as interações usam `event` com `durationThreshold` de 40 ms. Alternativa descartada: implementar as métricas à mão.

### Comunicação por porta, em lotes
O script injetado abre uma porta (`chrome.runtime.connect`) com o service worker e envia um lote por segundo com os registros acumulados. O service worker agrega e publica para o side panel um status resumido, também no máximo uma vez por segundo. Os registros detalhados só vão para a interface ao término.

### Estado da sessão em `chrome.storage.session`
O service worker grava ali o estado (ociosa, ativa, parando), a aba alvo, a seleção, os IDs de scripts registrados e os dados já agregados. Ao acordar, ele lê esse estado: se houver sessão ativa cuja aba não existe mais ou cuja porta se perdeu, executa a limpeza e marca a sessão como interrompida. `chrome.tabs.onRemoved` cobre o fechamento da aba com o service worker vivo.

### Registro de limpeza
Cada recurso instalado (script registrado, observador, listener, porta, temporizador) entra em uma lista da sessão. A limpeza percorre a lista, e o resultado dela é a "lista do que foi removido" mostrada na interface. O script injetado responde a uma mensagem de encerramento com a contagem de observadores e listeners desconectados.

### Seleção de verificações
Um registro central de verificações (`id`, nome, o que exige: página ou debugger). Fases seguintes acrescentam entradas a esse registro. A seleção é salva em `chrome.storage.local` com a chave do contexto (`manual` ou o nome do cenário).

### Permissão de host `<all_urls>`
O clique em "Analisar" acontece no side panel, e isso não concede `activeTab`. Como o uso é interno, a extensão declara `<all_urls>`. Alternativa descartada: `optional_host_permissions` pedidas por origem, que acrescentam um prompt a cada aplicação nova sem benefício no uso interno.

## Risks / Trade-offs

- [Páginas `chrome://` e a Web Store não aceitam injeção] → A confirmação detecta a URL não suportada e bloqueia o início com mensagem.
- [Service worker suspenso com a sessão ativa] → A porta aberta e os lotes periódicos mantêm o worker ativo; se ainda assim for suspenso, o estado em `storage.session` permite retomar ou encerrar como interrompida.
- [O observador da própria extensão adiciona custo à página] → Acúmulo em array e um envio por segundo; o impacto é medido na fase 5.
- [Métricas de carregamento em sessão iniciada com a página já aberta] → Os observadores usam `buffered: true`; o que o navegador não reteve aparece como indisponível.
