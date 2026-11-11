# Spec Delta

## Purpose

Garante que toda análise começa apenas por comando explícito do usuário, com confirmação do que será feito, e que pode ser cancelada a qualquer momento sem deixar resíduos.

## ADDED Requirements

### Requirement: Início somente por clique em "Analisar"
Uma análise MUST começar apenas depois que o usuário clica em "Analisar" no side panel e confirma a execução. Nenhuma análise MUST começar ao carregar uma página, ao abrir o navegador, ao reabrir o side panel ou por agendamento.

#### Scenario: Recarregar a página não inicia análise
- **WHEN** o usuário recarrega a página ou reabre o side panel sem clicar em "Analisar"
- **THEN** nenhuma análise começa e nenhum código é injetado na página

#### Scenario: Reiniciar o navegador não inicia análise
- **WHEN** o navegador é reiniciado depois de uma análise concluída
- **THEN** nenhuma análise começa até um novo clique em "Analisar"

### Requirement: Confirmação antes da execução
Antes de iniciar, a interface MUST mostrar um resumo com a aba alvo (URL), o modo de análise e as verificações escolhidas, e MUST exigir confirmação.

#### Scenario: Resumo exibido
- **WHEN** o usuário clica em "Analisar"
- **THEN** a interface exibe a URL da aba alvo, o modo e as verificações, com as opções de confirmar e cancelar

#### Scenario: Usuário desiste na confirmação
- **WHEN** o usuário cancela na tela de confirmação
- **THEN** nenhuma análise começa e nada é injetado na página

### Requirement: Cancelamento a qualquer momento
O usuário MUST poder cancelar uma análise em andamento a qualquer momento, e o cancelamento MUST remover tudo o que a análise instalou na página e no navegador.

#### Scenario: Cancelamento durante a análise
- **WHEN** o usuário cancela uma análise em andamento
- **THEN** a análise para, os observadores são removidos da página e a interface indica que a análise foi cancelada

### Requirement: Uma análise por vez
A extensão MUST permitir no máximo uma análise ativa por vez e MUST recusar um novo início enquanto outra estiver em andamento.

#### Scenario: Tentativa de segunda análise
- **WHEN** existe uma análise ativa e o usuário tenta iniciar outra
- **THEN** a interface informa que já há uma análise em andamento e não inicia a segunda

### Requirement: Status resumido durante a execução
Durante a análise, a interface MUST exibir apenas um status resumido, atualizado no máximo uma vez por segundo. Resultados detalhados MUST ser exibidos somente depois do término.

#### Scenario: Atualização limitada
- **WHEN** a análise está em andamento e a página gera dezenas de eventos por segundo
- **THEN** o side panel atualiza o status no máximo uma vez por segundo
