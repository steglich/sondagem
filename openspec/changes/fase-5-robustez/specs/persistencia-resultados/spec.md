# Spec Delta

## Purpose

Guarda os resultados das análises de forma durável e limitada, com o contexto necessário para compará-los depois, e garante que execuções interrompidas não corrompam nem percam dados.

## ADDED Requirements

### Requirement: Resultados persistidos
Cada análise concluída, interrompida, cancelada ou com erro MUST ser salva de forma durável e MUST continuar disponível depois de reiniciar o navegador.

#### Scenario: Resultado após reinício
- **WHEN** o navegador é reiniciado depois de uma execução concluída
- **THEN** o resultado continua listado no histórico

### Requirement: Metadados de cada resultado
Cada resultado salvo MUST conter: tipo (cenário ou sessão manual), estado final, cenário e configuração efetiva, URL, data, versão do build, versão do navegador, ambiente e condições de teste.

#### Scenario: Resultado completo
- **WHEN** um resultado é aberto no histórico
- **THEN** todos os metadados da execução estão presentes

### Requirement: Somente resumos armazenados
A extensão MUST armazenar resumos (medições por iteração, resumos de snapshot, resumo de CPU, listas de eventos) e MUST NOT armazenar heap snapshots ou perfis de CPU brutos.

#### Scenario: Execução com snapshots
- **WHEN** uma execução com snapshots é salva
- **THEN** o registro contém os resumos por construtor e nenhum snapshot bruto

### Requirement: Limites de tamanho com aviso
A extensão MUST aplicar um limite de tamanho por execução e um limite para o histórico total, MUST avisar o usuário antes de o limite ser atingido e MUST NOT descartar dados sem avisar.

#### Scenario: Histórico próximo do limite
- **WHEN** o histórico atinge 80% do limite configurado
- **THEN** a interface avisa e oferece a remoção de execuções antigas

#### Scenario: Execução excede o limite
- **WHEN** os dados de uma execução passam do limite por execução
- **THEN** as listas detalhadas são truncadas, as estatísticas são mantidas e o resultado indica o truncamento

### Requirement: Retenção definida pelo usuário
O usuário MUST poder definir a política de retenção (quantidade máxima de execuções por cenário ou idade máxima) e MUST poder remover execuções individualmente.

#### Scenario: Retenção por quantidade
- **WHEN** a política é manter 50 execuções por cenário e a 51ª é salva
- **THEN** a execução mais antiga daquele cenário é removida

### Requirement: Execução interrompida recuperada
Se a extensão for suspensa ou a conexão com o debugger se perder durante uma análise, a extensão MUST executar a limpeza na próxima oportunidade, salvar os dados já coletados e registrar o resultado como interrompido.

#### Scenario: Suspensão no meio da execução
- **WHEN** o service worker é encerrado durante a iteração 8 e volta a rodar
- **THEN** a limpeza é executada e o histórico tem um resultado interrompido com os dados das iterações anteriores

### Requirement: Resultado parcial nunca apresentado como completo
Um resultado interrompido, cancelado ou com erro MUST ser identificado como tal em toda a interface e MUST NOT ser usado como referência de comparação.

#### Scenario: Resultado interrompido no histórico
- **WHEN** o histórico lista um resultado interrompido
- **THEN** ele aparece marcado como interrompido e não pode ser escolhido como referência
