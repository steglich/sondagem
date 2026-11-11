# execucao-cenarios Specification

## Purpose

Executa um cenário declarativo de forma repetível: aquecimento, iterações idênticas, tratamento de erro por passo e estatísticas por iteração, para que execuções diferentes possam ser comparadas.

## Requirements

### Requirement: Confirmação com resumo do cenário
Antes de executar um cenário, a tela de confirmação MUST mostrar o nome do cenário, a URL inicial, o número de iterações e o throttling, além das verificações escolhidas.

#### Scenario: Resumo do cenário
- **WHEN** o usuário clica em "Analisar" com um cenário selecionado
- **THEN** a confirmação exibe nome, URL inicial, iterações e throttling, e permite alterar as iterações

### Requirement: Preparação da execução
A execução MUST começar abrindo a URL inicial do cenário em carga nova da página, na aba alvo, antes do aquecimento.

#### Scenario: Início da execução
- **WHEN** o usuário confirma a execução
- **THEN** a aba alvo carrega a `url_inicial` e os passos só começam depois do carregamento

### Requirement: Aquecimento excluído dos resultados
Os passos de `aquecimento` MUST ser executados uma vez antes dos passos principais, sem medições, e MUST NOT entrar nos resultados nem nas estatísticas.

#### Scenario: Long task no aquecimento
- **WHEN** uma long task ocorre durante o aquecimento
- **THEN** ela não aparece no resultado nem nas estatísticas

### Requirement: Execução dos passos de ação
Os passos de ação MUST ser executados na ordem declarada, como interações reais do usuário na página, e MUST ser executados independentemente da seleção de verificações.

#### Scenario: Clique por seletor
- **WHEN** um passo `clicar` referencia um seletor que encontra um elemento visível
- **THEN** o elemento recebe um clique equivalente ao de um usuário e a execução segue para o próximo passo

#### Scenario: Espera por seletor
- **WHEN** um passo `esperar` declara um seletor
- **THEN** a execução só avança quando o elemento existir na página ou quando o tempo limite expirar

### Requirement: Iterações idênticas e identificadas
O passo `repetir` MUST executar seus passos o número de vezes declarado, e cada medição ou evento coletado MUST ficar associado ao número da iteração em que ocorreu.

#### Scenario: Long task associada à iteração
- **WHEN** uma long task ocorre durante a iteração 7
- **THEN** o resultado a registra na iteração 7

### Requirement: Tempo limite por passo
Cada passo MUST ter um tempo limite, vindo de `tempo_limite_ms` ou de um padrão de 10 segundos, e MUST ser considerado com erro ao excedê-lo.

#### Scenario: Elemento que nunca aparece
- **WHEN** um passo `clicar` não encontra o elemento dentro do tempo limite
- **THEN** o passo é marcado com erro de tempo limite, indicando o seletor

### Requirement: Política de erro por passo
Um passo com erro MUST seguir o valor de `em_erro`: `interromper` (padrão) encerra a execução; `pular` segue para o próximo passo; `repetir` tenta de novo até 2 vezes e, persistindo o erro, interrompe. Uma iteração com passo pulado MUST ser marcada como incompleta e excluída das estatísticas.

#### Scenario: Interromper por padrão
- **WHEN** um passo sem `em_erro` falha
- **THEN** a execução para, o resultado é marcado como erro e informa o passo, a iteração e o motivo

#### Scenario: Passo pulado
- **WHEN** um passo com `em_erro: "pular"` falha na iteração 4
- **THEN** a execução continua, a iteração 4 fica marcada como incompleta e não entra nas estatísticas

### Requirement: Estados da execução visíveis
A execução MUST estar sempre em um dos estados: ociosa, preparando, aquecendo, executando, coletando, concluída, erro ou cancelada. A interface MUST mostrar o estado atual e, durante as iterações, o progresso ("iteração 7 de 20").

#### Scenario: Progresso exibido
- **WHEN** a execução está na sétima de 20 iterações
- **THEN** o side panel mostra "iteração 7 de 20"

### Requirement: Cancelamento da execução
O cancelamento MUST interromper a execução no passo atual, desanexar o debugger, remover os observadores e marcar o resultado como cancelado.

#### Scenario: Cancelar no meio de uma iteração
- **WHEN** o usuário cancela durante a iteração 3
- **THEN** nenhum passo seguinte é executado, a limpeza é feita e o resultado fica marcado como cancelado

### Requirement: Estatísticas por iteração
Ao concluir, a execução MUST reportar, para cada métrica coletada por iteração, a mediana, o p75 e o p95 entre as iterações completas.

#### Scenario: Resumo estatístico
- **WHEN** uma execução de 20 iterações termina com a verificação de Processamento ativa
- **THEN** o resultado traz mediana, p75 e p95 do tempo de long tasks por iteração e da duração das interações

### Requirement: Contexto registrado no resultado
Cada resultado MUST registrar o cenário e sua configuração efetiva (iterações, throttling, verificações), a URL, a data, a versão do build informada pelo usuário (quando houver) e o ambiente: versão do navegador, user agent, tamanho da janela e DPR.

#### Scenario: Resultado com contexto
- **WHEN** uma execução termina
- **THEN** o resultado contém a configuração efetiva e os dados do ambiente

### Requirement: Resultados consistentes entre execuções
O mesmo cenário, executado repetidas vezes na mesma página e nas mesmas condições, MUST produzir o mesmo número de iterações completas e a mesma sequência de passos executados.

#### Scenario: Três execuções do mesmo cenário
- **WHEN** o mesmo cenário é executado 3 vezes na página de teste limpa
- **THEN** as 3 execuções concluem com o mesmo número de iterações completas e de passos executados
