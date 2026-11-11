# Tasks

O design foi refeito durante a implementação: o `chrome.debugger` não oferece `HeapProfiler`, `Memory` nem `Runtime.getHeapUsage` a extensões. O heap snapshot deu lugar a um censo por construtor (ver `design.md`). As tasks abaixo já seguem o design novo.

## 1. Verificações e medição leve

- [x] 1.1 Registrar as verificações "Memória" e "DOM e listeners" (ambas exigem debugger) e ligar os passos `medir`, `snapshot` e `forcar_gc` à verificação "Memória" na filtragem do runner; verificar com teste unitário que, sem "Memória" nem "DOM e listeners", nenhum comando de memória (`Runtime.queryObjects`, `Performance.*`, `DOM.*`) é enviado
- [x] 1.2 Implementar `forcar_gc` com `Runtime.queryObjects`, aguardando o retorno e liberando o grupo de objetos; verificar com teste unitário no transporte falso a ordem dos comandos
- [x] 1.3 Implementar `medir` com `Performance.getMetrics`, respeitando o campo `metricas` e carimbando a iteração; verificar com teste unitário e com teste de integração que 10 iterações geram 10 medições
- [x] 1.4 Definir em `shared/types.ts` os tipos de medição, resumo por construtor, comparação e classificação; verificar que o projeto compila
- [x] 1.5 Teste de integração que envia pelo `chrome.debugger` real cada comando de CDP usado pela fase e falha se algum for recusado

## 2. Censo por construtor

- [x] 2.1 Implementar o censo (`Runtime.queryObjects` + `Runtime.callFunctionOn`) com contagem por construtor e liberação do grupo de objetos inclusive em erro; verificar com teste unitário no transporte falso e com teste da função de contagem sobre objetos reais
- [x] 2.2 Limitar o resumo a 500 construtores mais "outros"; verificar com teste unitário
- [x] 2.3 Implementar o passo `snapshot` no runner (rótulo, política `em_erro`, tempo limite, marcação das long tasks causadas pela medição); verificar com testes unitários e com teste de integração que só o resumo fica armazenado
- [x] 2.4 Remover o que a primeira versão do design criou e não é mais usado (documento offscreen, worker, leitor de snapshot, dominadores, permissão `offscreen`); verificar que o build e o isolamento passam

## 3. Análise

- [x] 3.1 Implementar a comparação entre o primeiro e o último censo, ordenada pela variação de contagem; verificar com testes unitários (construtor novo, removido, sem variação)
- [x] 3.2 Implementar a série por iteração e o crescimento médio por iteração; verificar com testes unitários
- [x] 3.3 Implementar a classificação (vazamento provável, sem indício, dados insuficientes) com limites configuráveis; verificar com testes unitários: série crescente, série estável com ruído, degrau único, menos de 5 iterações
- [x] 3.4 Reportar a variação de nós desanexados (`DOM.getDetachedDomNodes`) e de listeners com "DOM e listeners" ativa, depois de coleta de lixo e sem depender de "Memória"; verificar com teste unitário

## 4. Interface

- [x] 4.1 Exibir o aviso de vazamento não confirmado ao desmarcar "Memória" em cenário com passos de memória, sem bloquear; verificar com teste de componente
- [x] 4.2 Exibir no resultado a classificação com o texto de indício, a série por iteração em tabela, a variação de nós e listeners e os 20 construtores que mais cresceram; verificar com teste de componente a partir de um resultado fixo
- [x] 4.3 Na sessão manual, registrar medição leve a cada 5 segundos e adicionar o botão "Tirar snapshot", sem classificação; verificar com teste de integração

## 5. Critério de aceitação da fase

- [x] 5.1 Criar os cenários `vazamento-listener`, `vazamento-dom` e `limpa-memoria` em `pagina-teste/cenarios/`; verificar que os três passam na validação
- [x] 5.2 Teste de integração: `vazamento-listener` e `vazamento-dom` com 10 iterações resultam em "vazamento provável", com listeners e elementos retidos entre os que mais cresceram
- [x] 5.3 Teste de integração: `limpa-memoria` com 10 iterações resulta em "sem indício de vazamento"; ajustar os limites da classificação se necessário e registrar os valores finais em `design.md`
- [x] 5.4 Atualizar `CLAUDE.md` com o fluxo de memória (comandos de CDP e censo) e `docs/cenario.md` com os passos de memória; verificar que os caminhos citados existem
