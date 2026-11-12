# Tasks

## 1. Condições de teste

- [x] 1.1 Implementar a pilha de efeitos reversíveis (aplicar e desfazer) usada pela preparação e pela restauração do runner; verificar com testes unitários que os "desfazer" rodam em ordem inversa também em erro e cancelamento
- [x] 1.2 Implementar os perfis `nenhum` e `padrao` e a resolução de perfis personalizados (salvos ou inline), com erro para perfil inexistente; verificar com testes unitários
- [x] 1.3 Aplicar throttling de CPU e rede e o cache desligado antes do aquecimento; verificar com teste unitário no transporte falso e com teste de integração que mede um carregamento mais lento com `padrao`
- [x] 1.4 Implementar a limpeza de cache HTTP e de Cache Storage antes da execução, seguida de recarga; verificar com teste unitário que os parâmetros enviados não incluem cookies nem outros tipos de storage
- [x] 1.5 Registrar no resultado os valores numéricos efetivos de throttling e o estado do cache; verificar com teste unitário
- [x] 1.6 Na sessão manual, não aplicar condições por padrão e oferecer a escolha de throttling na confirmação; verificar com teste de componente e unitário
- [x] 1.7 Implementar a tela de perfis de throttling personalizados no side panel; verificar com teste de componente

## 2. Preservação da sessão

- [x] 2.1 Implementar a limpeza de storage que só aceita a lista de tipos confirmada e a confirmação específica na interface listando os tipos; verificar com teste de componente e com teste unitário que tipos não confirmados não são enviados
- [x] 2.2 Implementar a detecção de sessão expirada por `sessao.url_login` em `Page.frameNavigated`, com estado de erro "falha de sessão" e aviso na confirmação quando o campo estiver ausente; verificar com testes unitários (URL casa, não casa, padrão com `*`)
- [x] 2.3 Implementar `sessao.passos_login` executado só quando declarado, com mascaramento dos valores digitados em resultados e logs; verificar com teste unitário que o resultado salvo não contém os valores
- [x] 2.4 Adicionar à página de teste um fluxo de login simulado (cookie de sessão, página protegida, redirecionamento); verificar com teste de integração que, após uma execução completa, o cookie e o `localStorage` permanecem
- [x] 2.5 Teste de integração: cenário com `limpar_storage` exibe o aviso e apaga só os tipos confirmados; sessão expirada no meio da execução para com falha de sessão

## 3. Persistência

- [x] 3.1 Implementar `storage/repository.ts` sobre IndexedDB (`idb`) com os stores `execucoes` e `detalhes` e índices por cenário e data; verificar com testes unitários usando `fake-indexeddb`
- [x] 3.2 Gravar a execução ao iniciar (em andamento), ao fim de cada iteração e ao terminar, com todos os metadados; verificar com teste unitário da sequência de gravações
- [x] 3.3 Substituir o armazenamento provisório em `chrome.storage.session` pelo repositório em todas as leituras de resultado; verificar que os testes de integração das fases anteriores continuam passando
- [x] 3.4 Implementar a recuperação ao acordar o service worker: limpar, marcar como interrompida, manter os dados; verificar com teste de integração que encerra o service worker durante a execução
- [x] 3.5 Implementar os limites por execução e por histórico, o truncamento que preserva as estatísticas e o aviso em 80%; verificar com testes unitários
- [x] 3.6 Implementar a política de retenção e a remoção individual, com a tela de configuração e a lista de histórico no side panel; verificar com testes unitários e de componente
- [x] 3.7 Teste unitário que percorre um resultado salvo e confirma a ausência de snapshots brutos, perfis brutos e dados de autenticação

## 4. Interferência e estabilidade

- [x] 4.1 Adicionar a permissão `management`, listar outras extensões ativas na confirmação com a recomendação de perfil limpo e registrá-las no resultado; verificar com teste de componente e unitário
- [x] 4.2 Implementar o coeficiente de variação por métrica entre execuções do mesmo cenário e condições, com sinalização de métrica instável; verificar com testes unitários
- [x] 4.3 Teste de integração de impacto: mesmo cenário com o side panel aberto e fechado, diferença de long tasks por iteração dentro do limite; registrar o valor medido em `design.md`

## 5. Verificação de integração

- [x] 5.1 Executar 3 vezes o cenário `abrir-fechar` com o perfil `padrao` e verificar que a variação das métricas fica dentro do limite configurado
- [x] 5.2 Verificar que, após execução concluída, cancelada e com erro, a aba fica sem throttling e sem debugger anexado
- [x] 5.3 Atualizar `CLAUDE.md` e `docs/cenario.md` com throttling, `sessao`, `limpar_storage` e o repositório de resultados; verificar que os exemplos documentados passam na validação
