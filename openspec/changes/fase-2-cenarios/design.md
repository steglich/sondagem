# Design

## Context

Depende da fase 1: fluxo de "Analisar", registro de verificações, observadores e protocolo de lotes. Esta fase introduz o `chrome.debugger` e o runner. Restrições: CSP da extensão proíbe `eval` (afeta bibliotecas de validação), só um cliente de depuração por aba em alguns casos (ver Open Questions), e a barra de aviso do Chrome é aceita.

## Goals / Non-Goals

**Goals:**
- Wrapper de CDP pequeno, com desanexação garantida, reutilizado pelas fases 3, 4 e 5.
- Runner determinístico, testável sem navegador (transporte de CDP substituível por um falso).
- Esquema versão 1 já completo, para não mudar o formato nas fases seguintes.

**Non-Goals:**
- Executar `medir`, `snapshot` e `forcar_gc` (fase 3) e aplicar throttling ou limpeza de cache (fase 5).
- Gravação de cenários, múltiplas abas, mock de rede, importação/exportação em lote.
- Login scriptado automático ao expirar a sessão (fase 5).

## Decisions

### Wrapper de CDP com interface de transporte
`cdp.ts` expõe `anexar(tabId)`, `enviar(metodo, params)`, `aoEvento(metodo, fn)` e `desanexar()`, sobre uma interface `TransporteCdp`. A implementação real usa `chrome.debugger` (protocolo 1.3); os testes usam um transporte falso. `desanexar` é idempotente e chamado em `finally` pelo runner. `chrome.debugger.onDetach` vira um evento de "conexão perdida" com o motivo (`canceled_by_user`, `target_closed`, `replaced_with_devtools`).

### Classificação das falhas de anexação
O erro de `chrome.debugger.attach` é mapeado para três categorias: outro depurador anexado, alvo não depurável e erro desconhecido (mensagem original preservada). A interface traduz cada categoria em orientação.

### Ações pelo domínio `Input` do CDP
`clicar` resolve o seletor com `Runtime.evaluate`, rola o elemento para a área visível, calcula o centro e dispara `Input.dispatchMouseEvent` (pressionar e soltar). `digitar` foca o elemento e usa `Input.insertText`. `rolar` usa `Input.dispatchMouseEvent` do tipo `mouseWheel`. `navegar` usa `Page.navigate` e aguarda `Page.loadEventFired`. Eventos gerados assim são confiáveis (`isTrusted`) e entram na medição de INP, o que não acontece com `element.click()`. Alternativa descartada: executar as ações pelo script injetado.

### `esperar` e `aguardar_inatividade`
`esperar` por seletor faz sondagem a cada 50 ms via `Runtime.evaluate` até o tempo limite. `aguardar_inatividade` conclui quando passam `ms` milissegundos sem requisições de rede em andamento (eventos `Network.*`) e sem long tasks reportadas pelo observador.

### Runner como máquina de estados explícita
Estados: ociosa → preparando → aquecendo → executando ⇄ coletando → concluída | erro | cancelada. As transições ficam em uma tabela testável. O cancelamento usa um `AbortSignal` verificado entre passos e dentro das esperas. O estado e o progresso são gravados em `chrome.storage.session` a cada transição.

### Marcação de iteração
O runner envia ao script injetado, pela porta, uma mensagem "início da iteração N" e "fim da iteração N". O agregador do service worker carimba cada registro pelo intervalo de tempo. Durante o aquecimento, o agregador descarta os registros.

### Validação com Ajv em tempo de build
O JSON Schema fica em `extensao/shared/cenario.schema.json`. O validador é gerado no build com o modo standalone do Ajv, porque o Ajv em tempo de execução usa `new Function`, proibido pela CSP. As regras que o schema não expressa bem (rótulos únicos, `vezes` válido) ficam em uma função complementar. Os erros são convertidos em caminho JSON Pointer mais mensagem em português. Erros de sintaxe do JSON informam linha e coluna.

### Filtragem de passos de medição
Antes de executar, o runner remove os passos de medição cuja verificação não está ativa ou ainda não existe. Nesta fase isso remove sempre `medir`, `snapshot` e `forcar_gc`; a fase 3 registra a verificação de memória e eles passam a rodar.

### Erros da página por `Runtime`
`Runtime.enable` e os eventos `Runtime.exceptionThrown` cobrem exceções e rejeições não tratadas. Não exige código na página.

### Estatísticas em `shared/stats.ts`
Mediana, p75 e p95 por interpolação linear, funções puras com testes. Iterações incompletas são excluídas antes do cálculo.

### Armazenamento de cenários e resultados
Cenários em `chrome.storage.local`, indexados pelo nome. Resultados continuam em `chrome.storage.session` até a fase 5.

### Suposições registradas
- Iterações padrão: 5 (o plano pede "pelo menos 5").
- Tempo limite padrão por passo: 10 s.
- `em_erro: "repetir"`: até 2 novas tentativas.
- A execução usa a aba ativa no momento do clique em "Analisar"; a janela dedicada é recomendação, não imposição.

## Risks / Trade-offs

- [Service worker suspenso no meio da execução] → Uma sessão de `chrome.debugger` ativa mantém o worker vivo nas versões atuais do Chrome; o estado em `storage.session` cobre o caso contrário, encerrando a execução como interrompida.
- [Cliques por coordenada falham com elementos cobertos ou animados] → Rolar para a área visível, aguardar duas leituras de posição estáveis e reportar erro claro se outro elemento estiver por cima.
- [Sondagem por `Runtime.evaluate` adiciona carga à página] → Intervalo de 50 ms e expressão mínima; o custo é medido na fase 5.
- [Esquema muda nas próximas fases] → Todos os campos previstos no plano já fazem parte da versão 1.

## Open Questions

- O plano assume que anexar o debugger falha quando o DevTools está aberto na aba. Versões recentes do Chrome aceitam mais de um cliente de depuração, então a anexação pode ter sucesso mesmo com o DevTools aberto. A primeira tarefa desta fase verifica o comportamento na versão em uso. O requisito está escrito de forma que vale nos dois casos (falha ao anexar → parar com mensagem). Se a anexação não falhar com o DevTools aberto, a detecção desse caso específico fica sem meio técnico e deve ser rediscutida com o autor.
