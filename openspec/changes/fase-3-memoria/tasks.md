# Tasks

## 1. Verificações e medição leve

- [ ] 1.1 Registrar as verificações "Memória" e "DOM e listeners" (ambas exigem debugger) e ligar os passos `medir`, `snapshot` e `forcar_gc` à verificação "Memória" na filtragem do runner; verificar com teste unitário que, sem "Memória", nenhum comando `HeapProfiler` é enviado
- [ ] 1.2 Implementar `forcar_gc` com `HeapProfiler.collectGarbage`, aguardando o retorno; verificar com teste unitário no transporte falso a ordem dos comandos
- [ ] 1.3 Implementar `medir` com `Runtime.getHeapUsage` e `Memory.getDOMCounters`, respeitando o campo `metricas` e carimbando a iteração; verificar com teste unitário e com teste de integração que 10 iterações geram 10 medições
- [ ] 1.4 Definir em `shared/types.ts` os tipos de medição, resumo de snapshot, comparação e classificação; verificar que o projeto compila

## 2. Snapshot resumido

- [ ] 2.1 Adicionar a permissão `offscreen` e criar o documento offscreen com o worker de processamento e o canal de pedaços a partir do service worker; verificar com teste de integração que os pedaços chegam ao worker e o documento é fechado ao final
- [ ] 2.2 Implementar no worker a leitura incremental do snapshot para arrays tipados de nós e arestas; verificar com teste unitário usando um snapshot pequeno gravado em `extensao/background/__fixtures__/`
- [ ] 2.3 Implementar a agregação por construtor (contagem e tamanho próprio) e a contagem de nós desanexados; verificar com teste unitário contra valores conhecidos do snapshot de teste
- [ ] 2.4 Implementar a árvore de dominadores e o tamanho retido por construtor, com limite de tempo e degradação para tamanho próprio; verificar com teste unitário em um grafo pequeno de resultado conhecido e com teste do caminho degradado
- [ ] 2.5 Limitar o resumo a 500 construtores mais "outros" e aplicar o limite de 1 GB com falha clara do passo; verificar com testes unitários de ambos os limites
- [ ] 2.6 Implementar o passo `snapshot` no runner (rótulo, política `em_erro`, marcação das long tasks causadas pela medição); verificar com teste de integração que nenhum dado bruto permanece em armazenamento após a execução

## 3. Análise

- [ ] 3.1 Implementar a comparação entre o primeiro e o último resumo, ordenada pela variação de tamanho retido; verificar com testes unitários (construtor novo, removido, sem tamanho retido)
- [ ] 3.2 Implementar a série por iteração e o crescimento médio por iteração; verificar com testes unitários
- [ ] 3.3 Implementar a classificação (vazamento provável, sem indício, dados insuficientes) com limites configuráveis; verificar com testes unitários: série crescente, série estável com ruído, degrau único, menos de 5 iterações
- [ ] 3.4 Reportar a variação de nós desanexados e de listeners com "DOM e listeners" ativa; verificar com teste unitário

## 4. Interface

- [ ] 4.1 Exibir o aviso de vazamento não confirmado ao desmarcar "Memória" em cenário com passos de memória, sem bloquear; verificar com teste de componente
- [ ] 4.2 Exibir no resultado a classificação com o texto de indício, a série por iteração em tabela, a variação de nós e listeners e os 20 construtores que mais cresceram; verificar com teste de componente a partir de um resultado fixo
- [ ] 4.3 Na sessão manual, registrar medição leve a cada 5 segundos e adicionar o botão "Tirar snapshot", sem classificação; verificar com teste de integração

## 5. Critério de aceitação da fase

- [ ] 5.1 Criar os cenários `vazamento-listener`, `vazamento-dom` e `limpa-memoria` em `pagina-teste/cenarios/`; verificar que os três passam na validação
- [ ] 5.2 Teste de integração: `vazamento-listener` e `vazamento-dom` com 10 iterações resultam em "vazamento provável", com listeners e elementos retidos entre os que mais cresceram
- [ ] 5.3 Teste de integração: `limpa-memoria` com 10 iterações resulta em "sem indício de vazamento"; ajustar os limites da classificação se necessário e registrar os valores finais em `design.md`
- [ ] 5.4 Atualizar `CLAUDE.md` com o fluxo do snapshot (service worker → offscreen → worker) e `docs/cenario.md` com os passos de memória; verificar que os caminhos citados existem
