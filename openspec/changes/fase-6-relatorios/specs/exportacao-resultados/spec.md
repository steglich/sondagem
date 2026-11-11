# Spec Delta

## Purpose

Permite levar os resultados para fora da extensão em formatos abertos, para arquivamento, análise em outras ferramentas e compartilhamento com a equipe.

## ADDED Requirements

### Requirement: Exportação em JSON
O usuário MUST poder exportar uma execução em um arquivo JSON com todos os dados armazenados dela, incluindo metadados, condições, estatísticas e detalhes, e com a versão do formato de exportação.

#### Scenario: Exportar execução
- **WHEN** o usuário aciona "Exportar JSON" no relatório
- **THEN** um arquivo JSON é baixado com os dados completos da execução e a versão do formato

### Requirement: Exportação em CSV
O usuário MUST poder exportar em CSV as medições por iteração de uma execução, com uma linha por iteração e uma coluna por métrica, e cabeçalho com os nomes das métricas e suas unidades.

#### Scenario: Exportar medições por iteração
- **WHEN** o usuário aciona "Exportar CSV" em uma execução de 20 iterações
- **THEN** um arquivo CSV é baixado com o cabeçalho e 20 linhas

#### Scenario: Valores com separador
- **WHEN** um valor textual contém vírgula, aspas ou quebra de linha
- **THEN** o valor é escapado de modo que o arquivo abra corretamente em planilhas

### Requirement: Exportação da comparação
O usuário MUST poder exportar em CSV a comparação entre duas execuções, com uma linha por métrica e os valores, a diferença absoluta e a percentual.

#### Scenario: Exportar comparação
- **WHEN** o usuário aciona a exportação na tela de comparação
- **THEN** um arquivo CSV é baixado com uma linha por métrica comparada

### Requirement: Nome de arquivo identificável
Os arquivos exportados MUST ter nome com o cenário, a versão do build (quando houver) e a data da execução.

#### Scenario: Nome do arquivo
- **WHEN** a execução do cenário "abrir-fechar-modal", build 1.5.0, é exportada
- **THEN** o nome do arquivo contém o cenário, o build e a data

### Requirement: Exportação sem dados sensíveis
Os arquivos exportados MUST NOT conter valores digitados em passos de login nem dados de autenticação da aplicação analisada.

#### Scenario: Cenário com login
- **WHEN** uma execução de cenário com passos de login é exportada
- **THEN** os valores digitados no login não aparecem no arquivo
