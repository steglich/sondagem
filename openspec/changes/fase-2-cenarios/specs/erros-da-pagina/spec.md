# Spec Delta

## Purpose

Registra as exceções JavaScript e as promises rejeitadas da página durante a análise, para que um resultado de performance não seja lido sem saber que a página falhou.

## ADDED Requirements

### Requirement: Verificação "Erros da página"
A extensão MUST oferecer a verificação "Erros da página", que registra exceções JavaScript não tratadas e promises rejeitadas sem tratamento, com mensagem, origem (arquivo e linha) e instante.

#### Scenario: Exceção durante a execução
- **WHEN** a página lança uma exceção não tratada com a verificação ativa
- **THEN** o resultado lista a exceção com mensagem, arquivo, linha e instante

#### Scenario: Promise rejeitada
- **WHEN** uma promise é rejeitada sem tratamento com a verificação ativa
- **THEN** o resultado lista a rejeição com o motivo

### Requirement: Erros associados à iteração
Em execuções de cenário, cada erro MUST ficar associado à iteração em que ocorreu.

#### Scenario: Erro na iteração 5
- **WHEN** uma exceção ocorre durante a iteração 5
- **THEN** o resultado a registra na iteração 5

### Requirement: Erros não interrompem a execução
Um erro da página MUST NOT interromper a execução por si só. O resultado MUST destacar que houve erros da página.

#### Scenario: Execução com erros da página
- **WHEN** a página lança exceções, mas todos os passos do cenário concluem
- **THEN** a execução termina como concluída e o resultado destaca a quantidade de erros da página

### Requirement: Verificação desmarcada não coleta
Com "Erros da página" desmarcada, a extensão MUST NOT registrar erros da página.

#### Scenario: Verificação desmarcada
- **WHEN** a análise roda sem "Erros da página"
- **THEN** o resultado não contém a seção de erros da página
