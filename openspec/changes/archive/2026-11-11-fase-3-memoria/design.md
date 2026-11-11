# Design

## Context

Depende da fase 2: runner, wrapper de CDP, filtragem de passos de medição e marcação de iteração.

A primeira versão deste design usava `HeapProfiler.collectGarbage`, `HeapProfiler.takeHeapSnapshot`, `Memory.getDOMCounters` e `Runtime.getHeapUsage`. Na implementação, os testes de integração mostraram que o `chrome.debugger` trata a extensão como cliente não confiável e não oferece nenhum deles: `HeapProfiler.*` e `Memory.*` respondem `wasn't found`, e `Runtime.getHeapUsage` responde `not allowed for untrusted clients` (medido no Chromium 158). Sem heap snapshot não há tamanho próprio nem tamanho retido por objeto. O design foi refeito sobre o que o `chrome.debugger` aceita, e o resumo por construtor passou a ser um censo: quantos objetos vivos de cada construtor.

## Goals / Non-Goals

**Goals:**
- `medir` barato o bastante para rodar em toda iteração.
- Censo por construtor sem guardar nada bruto do heap e sem deixar objetos da página presos.
- Classificação com zero falso positivo na página limpa e detecção dos dois vazamentos da página de teste.
- Só comandos de CDP que o `chrome.debugger` aceita, conferidos por um teste de integração.

**Non-Goals:**
- Tamanho próprio e tamanho retido por construtor: exigem heap snapshot, que a extensão não consegue tirar. Ficam para análise humana no DevTools.
- Caminho de retenção (retainers) de objetos individuais: idem.
- Conexão por porta de depuração remota (`--remote-debugging-port`), que daria acesso ao `HeapProfiler` mas exige abrir o navegador com flags.
- Comparação entre execuções diferentes (fase 6).
- Persistência em IndexedDB (fase 5): os resumos seguem o armazenamento provisório.

## Decisions

### `medir` por `Performance.getMetrics`
Heap usado é `JSHeapUsedSize`; nós DOM é `Nodes`; listeners é `JSEventListeners`. Uma chamada, sem percorrer o heap. O domínio `Performance` é habilitado antes da leitura. Alternativas descartadas: `Runtime.getHeapUsage` e `Memory.getDOMCounters` (recusados a extensões) e `performance.memory` na página (impreciso e dependente de flags).

### `forcar_gc` por `Runtime.queryObjects`
Para devolver só objetos vivos, `Runtime.queryObjects` faz uma coleta de lixo completa antes de consultar. O passo pede os objetos de `Object.prototype` em um grupo próprio, descarta a resposta e libera o grupo (`Runtime.releaseObjectGroup`). Medido na página de teste, a série de heap fica igual à obtida com `HeapProfiler.collectGarbage` em uma sessão confiável. Cada passo `forcar_gc` faz uma coleta e aguarda o retorno. O cenário declara dois passos em sequência, como no plano; o runner não duplica por conta própria.

### Passo `snapshot` como censo por construtor
O passo continua se chamando `snapshot` (o esquema do cenário não muda). Ele faz:
1. `Runtime.queryObjects` de `Object.prototype`, que coleta o lixo e devolve uma lista com todos os objetos vivos do mundo principal da página;
2. `Runtime.callFunctionOn` sobre essa lista, com uma função que conta os objetos pelo nome do construtor e devolve só a tabela de contagens;
3. `Runtime.releaseObjectGroup`, sempre, inclusive em erro, para que a lista não segure os objetos.

O resultado é o resumo identificado pelo `rotulo`: total de objetos e contagem por construtor. Nada do heap sai da página além dessa tabela. Objetos sem `Object.prototype` na cadeia (`Object.create(null)`) e os do mundo isolado da extensão ficam de fora. Um nó DOM só é contado se tiver objeto JavaScript correspondente, o que vale para todo nó que a página criou ou tocou por script.

A função de contagem roda na página e lê `constructor.name` de cada protótipo, o que pode acionar getters da aplicação. Cada leitura é protegida por `try/catch`, e o que falhar entra no grupo "(inacessível)".

### Limite do resumo
O resumo guarda os 500 construtores de maior contagem e soma o resto em "outros". O limite é configurável.

### Tempo limite do passo `snapshot`
Sem `tempo_limite_ms`, o passo espera até 120 segundos (um heap grande leva bem mais do que os outros passos). Estourado o prazo, ou se a página recusar a contagem, o passo falha com mensagem clara e segue a política `em_erro`.

### Comparação
Junção dos dois resumos por nome de construtor, com a variação de contagem, ordenada do que mais cresceu para o que mais diminuiu. Usa o primeiro e o último censo da execução. Um construtor que só aparece em um dos lados conta como zero no outro.

### Nós desanexados e listeners
Com "DOM e listeners" marcada, a extensão lê no início (depois do aquecimento) e no fim da execução: listeners por `Performance.getMetrics` e nós desanexados por `DOM.getDetachedDomNodes`, contando os nós de cada árvore devolvida. Antes de cada leitura é feita uma coleta de lixo, porque sem ela um nó já solto e ainda não coletado contaria como desanexado. O domínio `DOM` é habilitado só durante a leitura. A verificação não depende de "Memória" nem dos passos de memória do cenário.

### Regra de "vazamento provável"
Cada série por iteração (heap usado, nós DOM, listeners), medida depois da coleta, é classificada por três condições:
1. pelo menos 5 iterações completas;
2. crescimento em pelo menos 80% das transições entre iterações consecutivas;
3. crescimento total acima de um limite mínimo, para ignorar flutuação: 100 KB de heap, 3 nós DOM, 3 listeners.

As três juntas tornam a série "vazamento provável". A execução é "vazamento provável" se **alguma** das três séries for. Não basta olhar o heap: `JSHeapUsedSize` só cobre o heap de JavaScript, e um nó DOM retido ocupa quase nada dele (no caso de DOM da página de teste, cerca de 4 KB por iteração, contra 404 nós). Com menos de 5 iterações completas medidas, "dados insuficientes". Os limites são constantes configuráveis (`LIMITES_PADRAO`).

Valores finais, calibrados contra a página de teste com 10 iterações (três rodadas dos testes de integração, todas com o mesmo veredito):

| Cenário | Heap: transições crescentes e total | Nós DOM | Listeners | Veredito |
|---|---|---|---|---|
| `limpa-memoria` | 3 a 6 de 9; +47 a +61 KB (aquecimento do JIT nas primeiras iterações) | 0 de 9 | 0 de 9 | sem indício |
| `vazamento-dom` | 9 de 9; +83 KB | 9 de 9; +3636 | 0 de 9 | vazamento provável (nós DOM) |
| `vazamento-listener` | 9 de 9; +408 KB | 0 de 9 | 9 de 9; +9 | vazamento provável (heap e listeners) |

O mínimo de heap subiu de 50 KB para 100 KB porque a página limpa chega a +61 KB só com o aquecimento; com 50 KB ela dependeria apenas da condição 2. Alternativa descartada: regressão linear com R², mais sensível a um degrau único causado por cache legítimo.

### Sessão manual
Medição leve a cada 5 segundos enquanto a sessão está ativa, e botão "Tirar snapshot", que faz um censo. Sem classificação, porque não há iterações comparáveis.

### Conferência dos comandos de CDP
Um teste de integração envia pelo `chrome.debugger` real cada comando de CDP que a fase usa e falha se algum for recusado. Os testes unitários usam um transporte falso, que aceita qualquer comando, e por isso não detectam esse tipo de erro.

### Suposições registradas
- Limite mínimo de crescimento: 100 KB de heap, 3 nós DOM, 3 listeners; proporção de transições crescentes: 80%.
- Resumo limitado a 500 construtores.
- Tempo limite padrão do passo `snapshot`: 120 s.

## Risks / Trade-offs

- [Sem tamanho por objeto, um vazamento de poucos objetos grandes não se destaca na lista de construtores] → A série de heap usado continua acusando o crescimento; a interface apresenta o resultado como indício e remete ao DevTools.
- [Um vazamento só de JavaScript abaixo de 100 KB em toda a execução não é classificado] → Mais iterações acumulam mais; a série e a lista de construtores continuam visíveis no resultado.
- [`Runtime.queryObjects` coletar lixo é efeito colateral, não contrato] → O teste de integração da página de teste falha se o comportamento mudar (a série da página limpa deixaria de estabilizar).
- [Coleta forçada não é determinística] → Dois `forcar_gc` no cenário e regra baseada em tendência, não em uma única diferença.
- [Caches legítimos da aplicação parecem vazamento] → Aquecimento antes do censo inicial; a interface apresenta o resultado como indício.
- [O censo roda código na página e pode acionar getters] → Leituras protegidas, e nada é escrito na página.
- [O censo pausa a página enquanto conta] → Só no início e no fim; long tasks nesse intervalo são marcadas como causadas pela medição e excluídas das estatísticas.
- [Classes com o mesmo nome em módulos diferentes são somadas] → Aceito; o nome é o que o usuário reconhece.
