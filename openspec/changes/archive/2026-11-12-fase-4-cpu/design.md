# Design

## Context

Depende da fase 2 (runner, CDP, registro de verificações). O `chrome.debugger` recusa todo o domínio `Profiler` a extensões (`wasn't found`), então a coleta usa `Tracing` com a categoria `disabled-by-default-v8.cpu_profiler`. O perfil só chega depois de `Tracing.end`, em eventos `Tracing.dataCollected`: um evento `Profile` (com `startTime`) e vários `ProfileChunk`, cada um com nós (`id`, `parent`, `callFrame`), amostras e deltas de tempo em µs. `Tracing.tracingComplete` fecha a entrega e informa `dataLossOccurred`. Tudo isso foi medido pelo `chrome.debugger` real, em Linux.

## Goals / Non-Goals

**Goals:**
- Agregação pura e testável: perfil bruto → resumo por função.
- Resumo pequeno e estável, pronto para ser comparado na fase 6.

**Non-Goals:**
- Flame chart ou linha do tempo de chamadas.
- Aplicação de source maps: os nomes são os do código servido.
- Associar funções a long tasks específicas.

## Decisions

### Um perfil por execução, pausado fora das iterações
`Tracing.start` (`traceConfig.includedCategories: ['disabled-by-default-v8.cpu_profiler']`, `transferMode: 'ReportEvents'`) depois do aquecimento; `Tracing.end` ao final dos passos principais. Para excluir snapshots e coletas forçadas, o runner registra esses intervalos, e a agregação descarta as amostras que caem neles. Os limites de cada intervalo são lidos com `Performance.getMetrics` (`Timestamp`), que usa o mesmo relógio monotônico do trace; o relógio do service worker não serve para isso. Desanexar o debugger sem `Tracing.end` também encerra o trace, mas a limpeza envia `Tracing.end` sempre que o trace foi iniciado. Alternativa descartada: parar e reiniciar o perfil a cada iteração, que multiplica o custo e fragmenta os dados.

### Agregação por chave de função
A agregação é incremental: consome os eventos na ordem em que chegam, mantém a tabela de nós de cada perfil (agrupados pelo `id` do evento) e acumula os tempos por amostra, sem guardar os pedaços. O instante de cada amostra é o `startTime` do `Profile` mais a soma dos deltas até ela. Chave: `nome da função + URL + linha + coluna`. Linha e coluna vêm em base 0 e são convertidas para base 1. Funções sem URL (código avaliado, funções nativas) ficam na lista, sem origem. Tempo próprio é a soma dos deltas das amostras cujo nó folha é a função. Tempo total é a soma dos deltas das amostras em que a função aparece em qualquer ponto da pilha, contada uma vez por amostra para não inflar recursão. O percentual é sobre o tempo amostrado, sem o ocioso.

### Categorias do motor
Os nós `(idle)`, `(program)`, `(garbage collector)` e `(root)` são somados em categorias próprias e ficam fora da lista. Funções de extensões (`chrome-extension://`) são agrupadas em "extensões", para deixar visível a interferência.

### Limite do resumo
200 funções por tempo próprio, mais a linha "outras". Como a agregação é incremental, o perfil bruto nunca fica inteiro no service worker: cada pedaço é descartado depois de somado.

### Falhas da coleta
`Tracing.start` falha se já houver um trace em andamento no navegador ("Tracing has already been started"). Nesse caso, e em qualquer outra falha ao iniciar, a análise continua sem a seção de CPU e o resultado traz um aviso. Se `Tracing.tracingComplete` vier com `dataLossOccurred`, o resumo é mantido e o resultado avisa que o perfil está incompleto.

### Sessão manual
Limite de 5 minutos de perfil, configurável. Ao atingir, `Tracing.end`, agregação e aviso.

### Suposições registradas
- Intervalo de amostragem: definido pelo navegador (cerca de 160 µs na medição); o `Tracing` não permite configurá-lo.
- Limite do resumo: 200 funções.
- Limite do perfil em sessão manual: 5 minutos.

## Risks / Trade-offs

- [O perfil de CPU altera os tempos medidos] → O resultado registra que o perfil estava ativo; para medições de tempo limpas, o usuário roda sem "CPU".
- [Código minificado produz nomes ilegíveis] → A origem (arquivo, linha, coluna) é sempre exibida; source maps ficam para depois.
- [A amostragem a cada 160 µs, mais fina que a planejada, aumenta o custo da medição e o volume do trace (cerca de 70 KB por segundo de página ocupada)] → Aceito; o aviso de perfil ativo cobre o custo, e `dataLossOccurred` cobre o estouro do buffer.
- [A equivalência entre o relógio do trace e o `Timestamp` de `Performance.getMetrics` só foi conferida em Linux] → O teste de integração confere que os intervalos lidos caem dentro do período do perfil.
- [Amostragem perde funções muito curtas] → Limitação aceita e documentada; o objetivo é achar o que mais consome.
