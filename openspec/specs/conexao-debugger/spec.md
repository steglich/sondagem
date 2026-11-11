# conexao-debugger Specification

## Purpose

Controla a conexão da extensão com o debugger do Chrome na aba analisada: quando anexar, como reagir a falhas e a garantia de que a conexão é sempre desfeita.

## Requirements

### Requirement: Debugger anexado apenas durante a análise
A extensão MUST anexar o debugger somente depois da confirmação de uma análise que exige isso e MUST desanexá-lo ao término, inclusive em caso de erro ou cancelamento. Sem análise ativa, a extensão MUST NOT manter o debugger anexado.

#### Scenario: Término normal
- **WHEN** a análise termina
- **THEN** o debugger é desanexado e a barra de depuração do Chrome desaparece

#### Scenario: Erro durante a análise
- **WHEN** um passo falha e interrompe a execução
- **THEN** o debugger é desanexado antes de a interface mostrar o erro

### Requirement: Falha ao anexar interrompe a análise
Se o debugger não puder ser anexado, a extensão MUST NOT prosseguir, MUST exibir mensagem clara no side panel e MUST indicar quais verificações escolhidas dependem do debugger.

#### Scenario: Outro depurador já anexado à aba
- **WHEN** o usuário confirma a análise e a aba já tem outro depurador anexado (como o DevTools), detectado antes de anexar ou pela falha da anexação
- **THEN** nenhuma execução começa e o side panel informa que há um depurador aberto na aba, orientando a fechá-lo ou a usar uma janela de teste dedicada

#### Scenario: Aba que não aceita depuração
- **WHEN** a aba alvo é uma página interna do navegador
- **THEN** nenhuma execução começa e a mensagem informa que a página não pode ser analisada

### Requirement: Sem contorno do conflito
A extensão MUST NOT tentar fechar, reabrir ou substituir outro depurador anexado à aba.

#### Scenario: Conflito detectado
- **WHEN** a extensão detecta outro depurador anexado à aba
- **THEN** a extensão apenas informa o usuário e não age sobre o outro depurador

### Requirement: Perda de conexão tratada
Se o debugger for desanexado durante a análise por ação externa (usuário cancela a barra de depuração, aba fechada, outro depurador assume), a extensão MUST encerrar a análise como interrompida, executar a limpeza e preservar os dados já coletados, marcados como parciais.

#### Scenario: Usuário cancela a barra de depuração
- **WHEN** o usuário clica em "Cancelar" na barra de depuração do Chrome durante a execução
- **THEN** a execução para, o resultado fica marcado como interrompido com os dados parciais e a interface explica o motivo

### Requirement: Estado de emulação desfeito
Ao desanexar, a extensão MUST desfazer toda alteração feita por ela no estado da aba por meio do debugger.

#### Scenario: Aba restaurada
- **WHEN** a análise termina e o debugger é desanexado
- **THEN** a aba se comporta como antes da análise, sem configurações residuais
