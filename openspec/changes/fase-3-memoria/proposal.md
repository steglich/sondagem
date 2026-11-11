# Proposal

## Why

Detectar vazamentos de memória de forma comprovada é o núcleo do produto (plano, seções 1 e 5). Com o runner e o debugger prontos (fase 2), esta fase faz os passos `medir`, `forcar_gc` e `snapshot` funcionarem e transforma os dados em uma resposta: a memória cresce de forma consistente? Quais objetos cresceram?

## What Changes

- Nova verificação "Memória": medição leve por iteração (heap usado, nós DOM, listeners) e snapshots de início e fim com coleta de lixo forçada.
- Nova verificação "DOM e listeners": nós desanexados e listeners acumulados.
- Resumo de heap snapshot por construtor (contagem, tamanho próprio e tamanho retido), sem guardar o snapshot bruto.
- Comparação entre snapshot inicial e final: construtores que mais cresceram.
- Tendência de memória por iteração e classificação "vazamento provável".
- Aviso na confirmação quando a verificação de memória é desmarcada.
- Na sessão manual, snapshots sob demanda por botão.

## Capabilities

### New Capabilities
- `deteccao-vazamento`: medição de memória por iteração, snapshots resumidos, comparação e classificação de vazamento provável.

### Modified Capabilities

Nenhuma.

## Impact

- Código: novos módulos de memória em `extensao/background/`, processamento de snapshot em documento offscreen com worker, tipos em `shared/`, telas de resultado de memória no side panel.
- Manifesto: nova permissão `offscreen`.
- Uso de CDP: `HeapProfiler`, `Runtime`, `Memory`.
- Critério de aceitação: os casos `/vazamento-listener` e `/vazamento-dom` da página de teste são detectados, e `/limpa` não é.
- Depende de `fase-2-cenarios` aplicada.
