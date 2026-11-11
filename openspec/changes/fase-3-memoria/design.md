# Design

## Context

Depende da fase 2: runner, wrapper de CDP, filtragem de passos de medição e marcação de iteração. O ponto difícil é o heap snapshot: pode ter centenas de megabytes, chega em pedaços por evento de CDP e o service worker não é lugar para processá-lo (memória limitada, sem `Worker` dedicado garantido, risco de suspensão). O plano exige guardar só o resumo (seção 3.5).

## Goals / Non-Goals

**Goals:**
- `medir` barato o bastante para rodar em toda iteração.
- Snapshot processado em fluxo, fora do service worker, com descarte do bruto.
- Classificação com zero falso positivo na página limpa e detecção dos dois vazamentos da página de teste.

**Non-Goals:**
- Caminho de retenção (retainers) de objetos individuais: fica para análise humana no DevTools.
- Comparação entre execuções diferentes (fase 6).
- Persistência em IndexedDB (fase 5): os resumos seguem o armazenamento provisório.

## Decisions

### `medir` por contadores do CDP
Heap usado por `Runtime.getHeapUsage`; nós DOM e listeners por `Memory.getDOMCounters`. São chamadas rápidas, sem percorrer o heap. Alternativa descartada: `performance.memory` na página, impreciso e dependente de flags.

### `forcar_gc` por `HeapProfiler.collectGarbage`
Cada passo `forcar_gc` faz uma coleta e aguarda o retorno. O cenário declara dois passos em sequência, como no plano; o runner não duplica por conta própria.

### Processamento do snapshot em documento offscreen com worker
`HeapProfiler.takeHeapSnapshot` emite `addHeapSnapshotChunk`. O service worker repassa cada pedaço, por porta, a um documento offscreen (`chrome.offscreen`), que os entrega a um Web Worker. O worker faz a análise incremental do JSON e monta as estruturas compactas (arrays tipados de nós e arestas). Ao final, calcula o resumo, devolve só o resumo e descarta tudo. Alternativa descartada: processar no service worker, que travaria o runner e arriscaria estouro de memória.

### Resumo por construtor
Para cada construtor: contagem, soma de tamanho próprio e soma de tamanho retido. O tamanho retido vem da árvore de dominadores calculada no worker. Nós desanexados vêm do campo `detachedness` do snapshot. O resumo guarda os 500 construtores de maior tamanho retido e agrega o resto em "outros". Se o cálculo de dominadores exceder o limite de tempo ou memória, o resumo sai só com tamanho próprio e marca o tamanho retido como indisponível.

### Limite de tamanho do snapshot
Acima de 1 GB de dados recebidos, o processamento é abortado e o passo falha com mensagem clara. O limite é configurável.

### Comparação
Junção dos dois resumos por nome de construtor, com variação de contagem, de tamanho próprio e de tamanho retido, ordenada pela variação de tamanho retido (ou próprio, quando o retido não existir). Usa o primeiro e o último snapshot da execução.

### Regra de "vazamento provável"
Sobre a série de heap usado pós-coleta por iteração:
1. pelo menos 5 iterações completas;
2. crescimento em pelo menos 80% das transições entre iterações consecutivas;
3. crescimento total acima de um limite mínimo (padrão 50 KB), para ignorar flutuação.

As três condições juntas resultam em "vazamento provável". As séries de nós DOM e listeners são classificadas pela mesma regra e exibidas como evidência adicional. Os limites são constantes configuráveis e são calibrados contra a página de teste. Alternativa descartada: regressão linear com R², mais sensível a um degrau único causado por cache legítimo.

### Sessão manual
Medição leve a cada 5 segundos enquanto a sessão está ativa, e botão "Tirar snapshot". Sem classificação, porque não há iterações comparáveis.

### Suposições registradas
- Limite mínimo de crescimento: 50 KB; proporção de transições crescentes: 80%.
- Resumo limitado a 500 construtores.
- Limite de snapshot: 1 GB.

## Risks / Trade-offs

- [Coleta forçada não é determinística] → Dois `forcar_gc` no cenário e regra baseada em tendência, não em uma única diferença.
- [Caches legítimos da aplicação parecem vazamento] → Aquecimento antes do snapshot inicial; a interface apresenta o resultado como indício.
- [Cálculo de dominadores caro em heaps grandes] → Worker dedicado, limite de tempo e degradação para tamanho próprio.
- [O snapshot pausa a página por segundos] → Só no início e no fim; long tasks nesse intervalo são marcadas como causadas pela medição e excluídas das estatísticas.
- [A própria extensão retém memória durante o processamento] → O documento offscreen é fechado depois de cada snapshot.
