# Spec Delta

## Purpose

Avisa o usuário quando outras extensões ativas podem distorcer a medição e registra essa condição no resultado.

## ADDED Requirements

### Requirement: Alerta sobre outras extensões ativas
Na confirmação de uma análise, a extensão MUST verificar se há outras extensões ativas no perfil e, havendo, MUST alertar o usuário, listar os nomes e recomendar o uso de um perfil limpo. O alerta MUST NOT bloquear a execução.

#### Scenario: Outras extensões ativas
- **WHEN** o usuário clica em "Analisar" com outras extensões ativas no perfil
- **THEN** a confirmação mostra o alerta com os nomes e a recomendação de perfil limpo, e permite prosseguir

#### Scenario: Perfil limpo
- **WHEN** não há outras extensões ativas
- **THEN** nenhum alerta é exibido

### Requirement: Interferência registrada no resultado
O resultado MUST registrar a quantidade e os nomes das outras extensões ativas no momento da execução.

#### Scenario: Registro no resultado
- **WHEN** uma execução acontece com duas outras extensões ativas
- **THEN** o resultado lista essas duas extensões

### Requirement: Impacto limitado da própria extensão
Com o side panel aberto e atualizando, a variação das long tasks da página testada em relação à execução com o side panel fechado MUST ficar dentro do limite definido para o projeto.

#### Scenario: Painel aberto e fechado
- **WHEN** o mesmo cenário é executado com o side panel aberto e com ele fechado
- **THEN** a diferença no tempo total de long tasks por iteração fica dentro do limite definido
