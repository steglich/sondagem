# Proposal

## Why

Detectar vazamentos de memória de forma comprovada é o núcleo do produto (plano, seções 1 e 5). Com o runner e o debugger prontos (fase 2), esta fase faz os passos `medir`, `forcar_gc` e `snapshot` funcionarem e transforma os dados em uma resposta: a memória cresce de forma consistente? Quais objetos cresceram?

## What Changes

- Nova verificação "Memória": medição leve por iteração (heap usado, nós DOM, listeners) e censos de objetos no início e no fim, com coleta de lixo forçada.
- Nova verificação "DOM e listeners": nós desanexados e listeners acumulados.
- Censo de objetos vivos por construtor (contagem) a cada passo `snapshot`, sem guardar nada bruto do heap.
- Comparação entre o censo inicial e o final: construtores que mais cresceram em número de objetos.
- Tendência de memória por iteração e classificação "vazamento provável".
- Aviso na confirmação quando a verificação de memória é desmarcada.
- Na sessão manual, snapshots sob demanda por botão.

## Capabilities

### New Capabilities
- `deteccao-vazamento`: medição de memória por iteração, snapshots resumidos, comparação e classificação de vazamento provável.

### Modified Capabilities

Nenhuma.

## Impact

- Código: novo módulo de memória em `extensao/background/`, análise e tipos em `shared/`, telas de resultado de memória no side panel.
- Manifesto: sem permissões novas.
- Uso de CDP: `Runtime` (`queryObjects`, `callFunctionOn`), `Performance` e `DOM`. Os domínios `HeapProfiler` e `Memory` não são oferecidos a extensões pelo `chrome.debugger`, por isso não há heap snapshot nem tamanho por objeto.
- Critério de aceitação: os casos `/vazamento-listener` e `/vazamento-dom` da página de teste são detectados, e `/limpa` não é.
- Depende de `fase-2-cenarios` aplicada.
