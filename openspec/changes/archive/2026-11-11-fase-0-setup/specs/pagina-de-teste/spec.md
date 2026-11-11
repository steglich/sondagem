# Spec Delta

## Purpose

Fornece uma página local com problemas de performance conhecidos e determinísticos, mais uma página de controle sem problemas, para servir de critério de aceitação das detecções da extensão.

## ADDED Requirements

### Requirement: Página servida localmente
A página de teste MUST ser servida localmente por um único comando, em endereço e porta fixos, sem depender de serviços externos.

#### Scenario: Subir a página de teste
- **WHEN** o desenvolvedor executa o comando da página de teste
- **THEN** os casos de teste ficam acessíveis em `http://localhost:4300`

### Requirement: Caso de listener não removido
A página MUST oferecer um caso em que abrir e fechar um componente registra um listener global que nunca é removido, acumulando um listener a cada ciclo.

#### Scenario: Ciclos de abrir e fechar
- **WHEN** o componente é aberto e fechado 10 vezes
- **THEN** existem 10 listeners a mais do que antes dos ciclos

### Requirement: Caso de nós DOM retidos
A página MUST oferecer um caso em que os nós removidos do documento permanecem referenciados por uma estrutura global, ficando desanexados e retidos.

#### Scenario: Ciclos de criar e remover
- **WHEN** o componente é criado e removido 10 vezes
- **THEN** os nós dos 10 ciclos continuam em memória, desanexados do documento

### Requirement: Caso de função pesada
A página MUST oferecer um caso em que um clique dispara uma função nomeada que bloqueia a thread principal por um tempo fixo e conhecido, acima de 200 ms.

#### Scenario: Clique na ação pesada
- **WHEN** o botão da ação pesada é clicado
- **THEN** a thread principal fica bloqueada por mais de 200 ms dentro da função nomeada

### Requirement: Página de controle limpa
A página MUST oferecer um caso de controle com as mesmas interações de abrir e fechar, sem reter listeners, nós ou memória entre os ciclos.

#### Scenario: Ciclos na página limpa
- **WHEN** o componente da página limpa é aberto e fechado 10 vezes e uma coleta de lixo é forçada
- **THEN** a contagem de listeners e de nós DOM volta ao valor anterior aos ciclos

### Requirement: Seletores estáveis
Todos os elementos interativos dos casos de teste MUST expor um atributo `data-testid` estável.

#### Scenario: Elementos acionáveis por seletor
- **WHEN** um cenário referencia os elementos interativos por `data-testid`
- **THEN** cada seletor encontra exatamente um elemento
