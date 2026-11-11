# Spec Delta

## Purpose

Coleta, de dentro da página testada, as long tasks, as interações lentas e as métricas de carregamento, com o menor impacto possível sobre a própria página.

## ADDED Requirements

### Requirement: Observadores presentes apenas durante a análise
Os observadores MUST ser instalados no início da análise e removidos no fim, inclusive quando a análise termina por erro ou cancelamento. Fora de uma análise, a página MUST NOT conter código da extensão.

#### Scenario: Remoção ao término
- **WHEN** a análise termina normalmente, por erro ou por cancelamento
- **THEN** todos os observadores e listeners instalados pela extensão são desconectados e a página não recebe mais código da extensão em recargas seguintes

### Requirement: Registro de long tasks
Com "Processamento" ativo, a extensão MUST registrar cada long task da página com o instante de início e a duração.

#### Scenario: Função pesada na página de teste
- **WHEN** o usuário clica na ação pesada da página de teste durante a análise
- **THEN** o resultado contém uma long task com duração acima de 200 ms no instante do clique

### Requirement: Registro de interações lentas
Com "Processamento" ativo, a extensão MUST registrar a duração das interações do usuário, o tipo de evento e o elemento alvo, e MUST reportar o INP da análise.

#### Scenario: Interação lenta identificada
- **WHEN** um clique leva mais de 200 ms até a próxima pintura
- **THEN** o resultado lista essa interação com a duração e o elemento alvo, e o INP reflete esse valor

### Requirement: Métricas de carregamento
Com "Carregamento" ativo, a extensão MUST reportar LCP, CLS, FCP e TTFB da página analisada. Uma métrica que o navegador não produziu MUST aparecer como indisponível, e não como zero.

#### Scenario: Página carregada durante a análise
- **WHEN** a página é carregada com a análise ativa
- **THEN** o resultado contém LCP, CLS, FCP e TTFB daquele carregamento

#### Scenario: Métrica não produzida
- **WHEN** o navegador não emite LCP para a página
- **THEN** o LCP aparece como indisponível no resultado

### Requirement: Envio agregado em lotes
Os eventos coletados MUST ser agregados na página e enviados em lotes, no máximo um lote por segundo, e nunca um evento por mensagem.

#### Scenario: Muitas long tasks em sequência
- **WHEN** a página produz 50 long tasks em um segundo
- **THEN** a extensão recebe esses registros em um único lote

### Requirement: Código injetado mínimo
O código injetado na página MUST NOT incluir o framework de interface e MUST NOT alterar o DOM, os estilos ou as variáveis globais da página testada.

#### Scenario: Página inalterada
- **WHEN** a análise está ativa em uma página
- **THEN** o DOM e o objeto global da página não ganham elementos nem propriedades criados pela extensão
