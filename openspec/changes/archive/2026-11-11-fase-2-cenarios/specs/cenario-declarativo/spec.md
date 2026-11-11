# Spec Delta

## Purpose

Define o cenário declarativo: um arquivo JSON versionável e editável à mão que descreve os passos de ação e de medição de uma análise repetível, e as regras que o tornam válido.

## ADDED Requirements

### Requirement: Estrutura do cenário
Um cenário MUST ser um documento JSON com `versao_esquema`, `nome`, `url_inicial` e `passos`, e MAY conter `descricao`, `execucao` (iterações e throttling), `aquecimento`, `sessao` (URL de login) e `limpar_storage`.

#### Scenario: Cenário mínimo válido
- **WHEN** o usuário carrega um cenário com `versao_esquema`, `nome`, `url_inicial` e ao menos um passo
- **THEN** o cenário é aceito

#### Scenario: Versão de esquema desconhecida
- **WHEN** o cenário declara uma `versao_esquema` que a extensão não conhece
- **THEN** o cenário é rejeitado com mensagem indicando as versões suportadas

### Requirement: Tipos de passo
O cenário MUST aceitar os passos de ação `navegar`, `clicar`, `digitar`, `esperar` (por tempo ou por seletor), `rolar` e `aguardar_inatividade`, o passo de agrupamento `repetir` e os passos de medição `medir`, `snapshot` e `forcar_gc`.

#### Scenario: Tipo de passo desconhecido
- **WHEN** um passo tem `tipo` fora da lista aceita
- **THEN** o cenário é rejeitado com mensagem que aponta o passo

### Requirement: Validação antes da execução
A extensão MUST validar o cenário antes de permitir a execução e MUST rejeitar um cenário inválido sem executar nenhum passo. Cada erro MUST indicar o campo e a posição no documento.

#### Scenario: Seletor ausente
- **WHEN** um passo `clicar` ou `digitar` não tem `seletor`
- **THEN** a validação falha indicando o caminho do passo (por exemplo, `/passos/3/passos/0/seletor`)

#### Scenario: Repetição inválida
- **WHEN** um passo `repetir` tem `vezes` igual a zero, negativo ou não numérico diferente de `"iteracoes"`
- **THEN** a validação falha indicando o campo `vezes` daquele passo

#### Scenario: Rótulo de snapshot repetido
- **WHEN** dois passos `snapshot` têm o mesmo `rotulo`
- **THEN** a validação falha indicando os dois passos

#### Scenario: Política de erro inválida
- **WHEN** um passo declara `em_erro` diferente de `interromper`, `pular` ou `repetir`
- **THEN** a validação falha indicando o campo `em_erro` daquele passo

### Requirement: Iterações padrão e sobrescrita
O número de iterações MUST vir, nesta ordem, do valor informado na execução, do campo `execucao.iteracoes` do cenário ou do padrão de 5. A referência `"iteracoes"` em `repetir.vezes` MUST resolver para esse valor.

#### Scenario: Cenário sem iterações declaradas
- **WHEN** o cenário não declara `execucao.iteracoes` e o usuário não informa valor
- **THEN** a execução usa 5 iterações

#### Scenario: Sobrescrita na execução
- **WHEN** o cenário declara 20 iterações e o usuário informa 10 na confirmação
- **THEN** a execução usa 10 iterações e registra esse valor no resultado

### Requirement: Gerenciamento de cenários
O usuário MUST poder carregar um cenário a partir de um arquivo JSON ou de texto colado, salvá-lo na extensão, selecioná-lo para execução e removê-lo.

#### Scenario: Carregar e selecionar
- **WHEN** o usuário carrega um arquivo de cenário válido
- **THEN** o cenário aparece na lista do side panel e pode ser escolhido para "Analisar"

#### Scenario: Arquivo que não é JSON
- **WHEN** o usuário carrega um arquivo com JSON malformado
- **THEN** a extensão rejeita o arquivo com mensagem que indica a linha e a coluna do erro
