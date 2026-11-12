# Proposal

## Why

As long tasks da fase 1 dizem quando a página travou, mas não qual função consumiu o tempo. Esta fase responde isso com um perfil de CPU resumido por função, mais legível do que o painel Performance do DevTools (plano, seções 1, 3.3 e 7).

## What Changes

- Nova verificação "CPU": perfil de CPU coletado durante as iterações do cenário (ou durante a sessão manual).
- Resumo por função: tempo próprio, tempo total, percentual e origem (arquivo e linha), ordenado por tempo próprio.
- Separação entre código da página e categorias do motor (ocioso, coleta de lixo, programa).
- O perfil bruto não é armazenado; só o resumo.

## Capabilities

### New Capabilities
- `perfil-cpu`: coleta do perfil de CPU durante a análise e resumo do consumo por função.

### Modified Capabilities

Nenhuma.

## Impact

- Código: módulo de perfil em `extensao/background/`, agregação em `shared/`, seção de CPU no resultado do side panel.
- Uso de CDP: `Tracing` (o `chrome.debugger` não expõe `Profiler` a extensões) e `Performance.getMetrics`.
- Sem novas permissões.
- Critério de aceitação: no caso `/cpu-pesada` da página de teste, `calculoPesado` aparece no topo do resumo.
- Depende de `fase-2-cenarios` aplicada. Independe da fase 3.
