# Spec Delta

## Purpose

Apresenta os resultados de uma execução de forma legível e permite compará-los com outra execução ou com uma linha de base do mesmo cenário, para avaliar diferenças entre versões do build.

## ADDED Requirements

### Requirement: Relatório de uma execução
A página de relatório MUST apresentar, para uma execução escolhida no histórico: os metadados e as condições de teste, o estado final, as estatísticas (mediana, p75, p95) e uma seção para cada verificação que produziu dados.

#### Scenario: Abrir relatório pelo histórico
- **WHEN** o usuário abre uma execução do histórico
- **THEN** a página de relatório mostra os metadados, o estado e as seções das verificações que rodaram

#### Scenario: Verificação que não rodou
- **WHEN** a execução não teve a verificação "CPU"
- **THEN** o relatório não mostra a seção de CPU

### Requirement: Gráficos por iteração
O relatório MUST exibir gráficos por iteração da memória (heap usado, nós DOM, listeners) e do processamento (tempo de long tasks e duração das interações), quando esses dados existirem.

#### Scenario: Tendência de memória
- **WHEN** o relatório de uma execução com medições de memória é aberto
- **THEN** um gráfico mostra o heap usado em cada iteração

### Requirement: Candidatos a vazamento
Para execuções com snapshots, o relatório MUST listar os construtores que mais cresceram, com a variação de contagem e de tamanho, junto com a classificação de vazamento.

#### Scenario: Lista de candidatos
- **WHEN** o relatório de uma execução classificada como "vazamento provável" é aberto
- **THEN** a lista dos construtores que mais cresceram aparece ordenada pelo crescimento

### Requirement: Relatório responsivo com dados grandes
O relatório MUST permanecer responsivo com listas de milhares de itens. Listas longas MUST ser exibidas de forma paginada ou virtualizada, e os gráficos MUST ser carregados apenas quando a seção é aberta.

#### Scenario: Resultado grande
- **WHEN** o relatório de uma execução com milhares de long tasks e um resumo de snapshot no tamanho máximo é aberto
- **THEN** a página responde à rolagem e aos cliques sem travar

### Requirement: Resultado parcial identificado
O relatório de uma execução interrompida, cancelada ou com erro MUST exibir o estado em destaque e o ponto em que a execução parou.

#### Scenario: Execução interrompida
- **WHEN** o relatório de uma execução interrompida na iteração 8 é aberto
- **THEN** a página destaca "interrompida" e informa a iteração 8

### Requirement: Comparação entre duas execuções
O usuário MUST poder comparar duas execuções completas do mesmo cenário. A comparação MUST mostrar, por métrica, os valores de cada execução, a diferença absoluta e a percentual, e MUST destacar diferenças nas condições de teste ou no ambiente.

#### Scenario: Duas versões do build
- **WHEN** o usuário compara as execuções das versões 1.4.0 e 1.5.0 do mesmo cenário
- **THEN** a página mostra, para cada métrica, os dois valores e a diferença

#### Scenario: Condições diferentes
- **WHEN** as duas execuções usaram perfis de throttling diferentes
- **THEN** a comparação exibe um aviso de que as condições diferem

#### Scenario: Cenários diferentes
- **WHEN** o usuário tenta comparar execuções de cenários diferentes
- **THEN** a comparação é recusada com mensagem explicando o motivo

### Requirement: Linha de base por cenário
O usuário MUST poder marcar uma execução completa como linha de base do cenário e definir um limite de regressão por métrica. Novas execuções do cenário MUST ser comparadas com a linha de base, e as métricas que passarem do limite MUST ser sinalizadas como regressão.

#### Scenario: Regressão sinalizada
- **WHEN** a linha de base tem INP mediano de 120 ms, o limite é 20% e a nova execução tem 180 ms
- **THEN** o relatório sinaliza regressão de INP

#### Scenario: Dentro do limite
- **WHEN** a nova execução fica dentro do limite em todas as métricas
- **THEN** o relatório indica que não houve regressão em relação à linha de base

### Requirement: Sessões manuais e resultados parciais fora da linha de base
Resultados de sessão manual e execuções interrompidas, canceladas ou com erro MUST NOT poder ser marcados como linha de base nem usados em comparação entre builds.

#### Scenario: Sessão manual
- **WHEN** o usuário abre o relatório de uma sessão manual
- **THEN** as opções de linha de base e de comparação não estão disponíveis
