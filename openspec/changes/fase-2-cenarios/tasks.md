# Tasks

## 1. Verificação do comportamento do debugger

- [ ] 1.1 Com um protótipo mínimo, chamar `chrome.debugger.attach` em uma aba com o DevTools aberto e em uma aba com outro depurador de extensão; registrar em `design.md` (Open Questions) o erro retornado em cada caso e a versão do Chrome. Se a anexação tiver sucesso com o DevTools aberto, parar e levar a questão ao autor antes de seguir com o grupo 3

## 2. Formato e validação do cenário

- [ ] 2.1 Escrever `extensao/shared/cenario.schema.json` (versão 1) com todos os campos e tipos de passo do plano, e os tipos TypeScript correspondentes; verificar que o exemplo da seção 4.1 do plano valida
- [ ] 2.2 Gerar o validador com Ajv standalone no build e adicionar a checagem complementar (rótulos únicos, `vezes`); verificar que o bundle do service worker não contém `new Function` nem `eval`
- [ ] 2.3 Converter erros em caminho JSON Pointer mais mensagem em português, e erros de sintaxe em linha e coluna; verificar com testes unitários os casos: seletor ausente, `vezes` zero, rótulo repetido, `em_erro` inválido, tipo desconhecido, versão desconhecida, JSON malformado
- [ ] 2.4 Implementar a resolução de iterações (execução → cenário → padrão 5) e da referência `"iteracoes"`; verificar com testes unitários
- [ ] 2.5 Documentar o formato em `docs/cenario.md` com o exemplo do plano; verificar que o exemplo do documento passa no validador por um teste

## 3. Conexão com o debugger

- [ ] 3.1 Adicionar a permissão `debugger` e implementar `background/cdp.ts` sobre a interface `TransporteCdp`, com `desanexar` idempotente; verificar com testes unitários usando o transporte falso
- [ ] 3.2 Classificar as falhas de anexação (outro depurador, alvo não depurável, desconhecido) conforme o resultado da tarefa 1.1; verificar com testes unitários de cada categoria
- [ ] 3.3 Tratar `onDetach` como conexão perdida com motivo, encerrando a análise como interrompida com dados parciais; verificar com teste unitário e com teste de integração que cancela a barra de depuração
- [ ] 3.4 Marcar no registro de verificações quais exigem debugger e incluir essa lista na mensagem de falha; verificar com teste de componente da mensagem

## 4. Runner

- [ ] 4.1 Implementar `shared/stats.ts` (mediana, p75, p95); verificar com testes unitários, incluindo lista vazia e de um elemento
- [ ] 4.2 Implementar a máquina de estados do runner com tabela de transições e gravação em `chrome.storage.session`; verificar com testes unitários de transições válidas e inválidas
- [ ] 4.3 Implementar os passos `navegar`, `clicar`, `digitar` e `rolar` pelo domínio `Input`; verificar com testes de integração na página de teste limpa
- [ ] 4.4 Implementar `esperar` (tempo e seletor) e `aguardar_inatividade`; verificar com testes unitários usando relógio simulado e transporte falso
- [ ] 4.5 Implementar `repetir`, o aquecimento e a marcação de início e fim de iteração enviada ao agregador; verificar com teste unitário que registros do aquecimento são descartados e os demais recebem o número da iteração
- [ ] 4.6 Implementar tempo limite por passo e as políticas `interromper`, `pular` e `repetir`, com iteração incompleta excluída das estatísticas; verificar com testes unitários de cada política
- [ ] 4.7 Implementar o cancelamento por `AbortSignal` com limpeza em `finally`; verificar com teste unitário que nenhum passo roda após o cancelamento e que `desanexar` é chamado
- [ ] 4.8 Filtrar os passos de medição sem verificação ativa; verificar com teste unitário que `medir`, `snapshot` e `forcar_gc` não geram comandos de CDP nesta fase
- [ ] 4.9 Registrar no resultado a configuração efetiva e o ambiente (versão do navegador, user agent, janela, DPR); verificar com teste de integração

## 5. Erros da página

- [ ] 5.1 Registrar a verificação "Erros da página" e coletar `Runtime.exceptionThrown` com iteração associada; verificar com teste unitário usando eventos simulados
- [ ] 5.2 Adicionar à página de teste um botão que lança exceção e outro que rejeita uma promise; verificar com teste de integração que ambos aparecem no resultado e que a execução conclui

## 6. Side panel

- [ ] 6.1 Implementar a tela de cenários: carregar arquivo, colar texto, listar, selecionar e remover, com erros de validação exibidos por campo; verificar com testes de componente
- [ ] 6.2 Estender a confirmação com o seletor de modo (cenário ou sessão manual) e o resumo do cenário, com campo de iterações e campo opcional de versão do build; verificar com testes de componente
- [ ] 6.3 Exibir estado e progresso ("iteração N de M") e, ao final, o resumo com mediana, p75, p95, iterações incompletas e erros da página; verificar com teste de componente a partir de um resultado fixo
- [ ] 6.4 Exibir as mensagens de falha de anexação e de conexão perdida; verificar com teste de componente de cada categoria

## 7. Verificação de integração

- [ ] 7.1 Criar o cenário `abrir-fechar` para a página de teste limpa em `pagina-teste/cenarios/` e executá-lo 3 vezes por teste de integração; verificar que as 3 execuções têm o mesmo número de iterações completas e de passos executados
- [ ] 7.2 Teste de integração: cancelar durante a execução desanexa o debugger e remove os observadores
- [ ] 7.3 Atualizar `CLAUDE.md` com o runner, o wrapper de CDP e como rodar um cenário de teste; verificar que os comandos citados funcionam
