# perfil-cpu Specification

## Purpose

Coleta o perfil de CPU da página durante a análise e o resume por função, para mostrar onde o tempo de processamento foi gasto.

## Requirements

### Requirement: Verificação "CPU"
A extensão MUST oferecer a verificação "CPU", que exige o debugger anexado e coleta o perfil de CPU da página durante a análise.

#### Scenario: Verificação oferecida
- **WHEN** a tela de confirmação é exibida
- **THEN** "CPU" aparece entre as verificações disponíveis

#### Scenario: Verificação desmarcada
- **WHEN** a análise roda sem "CPU"
- **THEN** nenhum perfil é coletado e o resultado não contém a seção de CPU

### Requirement: Perfil restrito às iterações
Em execuções de cenário, o perfil MUST cobrir apenas os passos principais. O aquecimento e os intervalos de snapshot e de coleta de lixo forçada MUST NOT entrar no resumo.

#### Scenario: Função executada só no aquecimento
- **WHEN** uma função roda apenas durante o aquecimento
- **THEN** ela não aparece no resumo de CPU

### Requirement: Resumo por função
O resultado MUST listar as funções ordenadas por tempo próprio, cada uma com nome, arquivo e linha de origem, tempo próprio, tempo total e percentual do tempo amostrado. Funções sem nome MUST ser identificadas como anônimas, com a origem.

#### Scenario: Função pesada no topo
- **WHEN** o cenário do caso de função pesada da página de teste é executado com "CPU" ativa
- **THEN** a função pesada da página aparece em primeiro lugar entre as funções da página, com o arquivo e a linha de origem

### Requirement: Categorias do motor separadas
O tempo ocioso, o tempo de coleta de lixo e o tempo interno do motor MUST ser apresentados separados das funções da página e MUST NOT ocupar posições na lista de funções.

#### Scenario: Página majoritariamente ociosa
- **WHEN** a página passa a maior parte da análise ociosa
- **THEN** o tempo ocioso aparece como categoria à parte e a lista de funções contém só código executado

### Requirement: Somente o resumo é mantido
O perfil bruto MUST NOT ser armazenado. O resumo MUST ser limitado a um número máximo de funções, com o restante agregado em uma linha "outras".

#### Scenario: Perfil com milhares de funções
- **WHEN** o perfil contém mais funções do que o limite do resumo
- **THEN** o resultado lista as funções até o limite e uma linha "outras" com a soma do restante

### Requirement: Perfil na sessão manual com limite de duração
Na sessão manual com "CPU" ativa, o perfil MUST cobrir a sessão até um limite máximo de duração. Ao atingir o limite, a coleta de CPU MUST parar, a interface MUST avisar o usuário e as demais verificações MUST continuar.

#### Scenario: Limite atingido
- **WHEN** a sessão manual ultrapassa o limite de duração do perfil
- **THEN** a coleta de CPU para, o side panel avisa, e a sessão continua com as outras verificações

### Requirement: Falha da coleta de CPU informada
Se o perfil de CPU não puder ser iniciado ou vier incompleto, o resultado MUST avisar o usuário, e as demais verificações MUST continuar.

#### Scenario: Outro trace em andamento
- **WHEN** a análise começa com "CPU" ativa e o navegador já tem um trace em andamento
- **THEN** a análise roda sem a seção de CPU e o resultado traz o aviso de que o perfil não pôde ser coletado

#### Scenario: Perfil incompleto
- **WHEN** o navegador informa que parte dos dados do perfil foi perdida
- **THEN** o resultado mostra o resumo e avisa que o perfil está incompleto

### Requirement: Custo da medição informado
O resultado MUST informar que o perfil de CPU estava ativo, para que as demais métricas daquela execução sejam lidas com esse custo em mente.

#### Scenario: Execução com CPU ativa
- **WHEN** uma execução roda com "CPU" e "Processamento" ativas
- **THEN** o resultado indica que as métricas foram coletadas com o perfil de CPU ligado
