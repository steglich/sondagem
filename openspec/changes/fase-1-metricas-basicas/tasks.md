# Tasks

## 1. Modelos e protocolo

- [ ] 1.1 Definir em `extensao/shared/types.ts` os tipos de sessão, verificação, long task, interação, métricas de carregamento e as mensagens página ↔ service worker ↔ interface; verificar que o projeto compila
- [ ] 1.2 Criar o registro de verificações com "Processamento" e "Carregamento" e a função que filtra o que coletar a partir da seleção; verificar com testes unitários (seleção vazia, parcial e completa)
- [ ] 1.3 Adicionar ao manifesto `scripting`, `tabs` e `host_permissions: <all_urls>`; verificar que a extensão recarrega sem erros

## 2. Observadores na página

- [ ] 2.1 Implementar em `injected/observers.ts` a coleta de long tasks e de interações (`event`), com acúmulo em memória; verificar com testes unitários usando `PerformanceObserver` simulado
- [ ] 2.2 Integrar `web-vitals` para LCP, CLS, FCP, TTFB e INP, com métrica ausente reportada como indisponível; verificar com teste unitário do mapeamento
- [ ] 2.3 Implementar o envio em lotes (um por segundo) por porta e a resposta à mensagem de encerramento com a contagem do que foi desconectado; verificar com teste unitário que 50 eventos em um segundo geram um único lote
- [ ] 2.4 Respeitar a seleção: instalar apenas os observadores das verificações marcadas; verificar com teste unitário que, só com "Carregamento", nenhum observador de long task é criado

## 3. Orquestração da sessão no service worker

- [ ] 3.1 Implementar início da sessão: validar a URL da aba, registrar o content script dinâmico, injetar na aba aberta e gravar o estado em `chrome.storage.session`; verificar com teste de integração que o script está presente só depois do início
- [ ] 3.2 Implementar a agregação dos lotes e a publicação de status para a interface no máximo uma vez por segundo; verificar com teste unitário do limitador
- [ ] 3.3 Implementar a parada: mensagem de encerramento, `unregisterContentScripts`, fechamento de portas, cancelamento de temporizadores e montagem da lista do que foi removido; verificar com teste de integração que, após "Parar", uma recarga da página não recebe o script
- [ ] 3.4 Implementar a recuperação: `tabs.onRemoved` e checagem do estado ao acordar o service worker, marcando a sessão como interrompida e preservando os dados; verificar com teste de integração que fechar a aba durante a sessão produz resultado "interrompida" com os dados recebidos
- [ ] 3.5 Recusar novo início com sessão ativa; verificar com teste unitário da máquina de estados da sessão

## 4. Side panel

- [ ] 4.1 Implementar o botão "Analisar" e a tela de confirmação com URL da aba, modo e lista de verificações, com confirmar desabilitado sem verificação marcada; verificar com testes de componente
- [ ] 4.2 Salvar e restaurar a última seleção por contexto em `chrome.storage.local`; verificar com teste que a seleção volta na próxima confirmação
- [ ] 4.3 Implementar a tela de sessão ativa (status resumido, botões "Parar" e "Cancelar") com componentes `OnPush` e signals; verificar com teste de componente que o status não é atualizado mais de uma vez por segundo
- [ ] 4.4 Implementar a tela de resultado: métricas de carregamento, INP, lista de long tasks e de interações, tipo "sessão manual" e a confirmação de limpeza com os itens removidos; verificar com teste de componente a partir de um resultado fixo
- [ ] 4.5 Bloquear o início em URLs não suportadas com mensagem clara; verificar com teste de componente

## 5. Verificação de integração

- [ ] 5.1 Teste de integração na página de teste `/cpu-pesada`: iniciar sessão, clicar na ação pesada, parar e verificar long task acima de 200 ms e a interação correspondente no resultado
- [ ] 5.2 Teste de integração dos casos do plano: recarregar a página ou reabrir o painel não inicia sessão; sessão manual não dispara cliques nem navegação; após "Parar", nenhum observador ou porta permanece
- [ ] 5.3 Atualizar `CLAUDE.md` com o fluxo de mensagens página → service worker → interface e o registro de verificações; verificar que os caminhos citados existem
