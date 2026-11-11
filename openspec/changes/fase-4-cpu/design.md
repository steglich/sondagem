# Design

## Context

Depende da fase 2 (runner, CDP, registro de verificações). O domínio `Profiler` do CDP só devolve o perfil inteiro em `Profiler.stop`, como árvore de nós com amostras e deltas de tempo. Não há entrega incremental.

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
`Profiler.enable`, `Profiler.setSamplingInterval` (1000 µs) e `Profiler.start` depois do aquecimento; `Profiler.stop` ao final dos passos principais. Para excluir snapshots e coletas forçadas, o runner registra esses intervalos de tempo, e a agregação descarta as amostras que caem neles. Alternativa descartada: parar e reiniciar o perfil a cada iteração, que multiplica o custo e fragmenta os dados.

### Agregação por chave de função
Chave: `nome da função + URL + linha + coluna`. Tempo próprio é a soma dos deltas das amostras cujo nó folha é a função. Tempo total é a soma dos deltas das amostras em que a função aparece em qualquer ponto da pilha, contada uma vez por amostra para não inflar recursão. O percentual é sobre o tempo amostrado, sem o ocioso.

### Categorias do motor
Os nós `(idle)`, `(program)`, `(garbage collector)` e `(root)` são somados em categorias próprias e ficam fora da lista. Funções de extensões (`chrome-extension://`) são agrupadas em "extensões", para deixar visível a interferência.

### Limite do resumo
200 funções por tempo próprio, mais a linha "outras". O perfil bruto é descartado logo depois da agregação, no service worker. Perfis de execuções longas cabem em memória; se o perfil passar de 200 MB, a agregação é feita no worker offscreen da fase 3, quando disponível, ou a coleta falha com mensagem clara.

### Sessão manual
Limite de 5 minutos de perfil, configurável. Ao atingir, `Profiler.stop`, agregação e aviso.

### Suposições registradas
- Intervalo de amostragem: 1000 µs.
- Limite do resumo: 200 funções.
- Limite do perfil em sessão manual: 5 minutos.

## Risks / Trade-offs

- [O perfil de CPU altera os tempos medidos] → O resultado registra que o perfil estava ativo; para medições de tempo limpas, o usuário roda sem "CPU".
- [Código minificado produz nomes ilegíveis] → A origem (arquivo, linha, coluna) é sempre exibida; source maps ficam para depois.
- [Amostragem perde funções muito curtas] → Limitação aceita e documentada; o objetivo é achar o que mais consome.
