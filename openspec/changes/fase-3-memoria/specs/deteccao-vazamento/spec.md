# Spec Delta

## Purpose

Mede a memória da página ao longo das iterações de um cenário, compara o estado inicial com o final e indica se há vazamento provável e quais objetos mais cresceram.

## ADDED Requirements

### Requirement: Verificações de Memória e de DOM e listeners
A extensão MUST oferecer as verificações "Memória" (medição por iteração e snapshots) e "DOM e listeners" (nós desanexados e listeners acumulados). Ambas MUST exigir o debugger anexado.

#### Scenario: Verificações oferecidas
- **WHEN** a tela de confirmação é exibida
- **THEN** "Memória" e "DOM e listeners" aparecem entre as verificações disponíveis

### Requirement: Passos de memória condicionados à seleção
Os passos `medir`, `snapshot` e `forcar_gc` MUST ser executados somente com a verificação "Memória" ativa. Com ela desmarcada, esses passos MUST ser ignorados e os passos de ação MUST continuar sendo executados.

#### Scenario: Apenas Carregamento ativo
- **WHEN** um cenário com `snapshot` e `forcar_gc` roda só com "Carregamento" marcado
- **THEN** nenhum snapshot é criado, nenhuma coleta é forçada e os passos de ação são executados

### Requirement: Aviso ao desmarcar Memória
Ao desmarcar "Memória" em um cenário que contém passos de memória, a interface MUST avisar que o vazamento não será confirmado, sem bloquear a execução.

#### Scenario: Memória desmarcada
- **WHEN** o usuário desmarca "Memória" na confirmação
- **THEN** a interface mostra o aviso e mantém o botão de confirmar habilitado

### Requirement: Coleta de lixo forçada
O passo `forcar_gc` MUST forçar uma coleta de lixo completa na página e aguardar sua conclusão antes do passo seguinte.

#### Scenario: Coleta antes da medição
- **WHEN** um `forcar_gc` precede um `medir`
- **THEN** a medição acontece depois da conclusão da coleta

### Requirement: Medição leve por iteração
O passo `medir` MUST registrar, na iteração corrente, as métricas pedidas entre heap usado (bytes), número de nós DOM e número de listeners, sem criar snapshot.

#### Scenario: Medição em cada iteração
- **WHEN** um cenário de 20 iterações tem um `medir` por iteração
- **THEN** o resultado contém 20 medições, cada uma com o número da iteração

### Requirement: Snapshot resumido
O passo `snapshot` MUST produzir um resumo identificado pelo `rotulo`, com contagem de objetos, tamanho próprio e tamanho retido por construtor, e a contagem de nós DOM desanexados. O snapshot bruto MUST NOT ser armazenado nem mantido em memória depois do resumo.

#### Scenario: Resumo gerado
- **WHEN** o passo `snapshot` com rótulo "inicio" é executado
- **THEN** o resultado contém o resumo "inicio" por construtor e nenhum arquivo de snapshot bruto fica armazenado

#### Scenario: Falha ao gerar snapshot
- **WHEN** o snapshot não pode ser concluído (por exemplo, excede o limite de tamanho)
- **THEN** o passo é marcado com erro, segue a política `em_erro` e a mensagem informa o motivo

### Requirement: Comparação entre snapshots
Com dois snapshots na execução, o resultado MUST listar os construtores ordenados pelo crescimento de tamanho retido entre o primeiro e o último, com a variação de contagem e de tamanho de cada um.

#### Scenario: Nós retidos na página de teste
- **WHEN** o cenário do caso de nós DOM retidos roda 10 iterações com snapshots de início e fim
- **THEN** os elementos retidos aparecem entre os construtores que mais cresceram, com aumento de contagem proporcional às iterações

### Requirement: Nós desanexados e listeners acumulados
Com "DOM e listeners" ativa, o resultado MUST reportar a variação de nós DOM desanexados e de listeners entre o início e o fim da execução.

#### Scenario: Listeners acumulados na página de teste
- **WHEN** o cenário do caso de listener não removido roda 10 iterações
- **THEN** o resultado reporta aumento de pelo menos 10 listeners

### Requirement: Tendência por iteração
O resultado MUST apresentar a série de heap usado, nós DOM e listeners por iteração e o crescimento médio por iteração de cada série.

#### Scenario: Série disponível
- **WHEN** uma execução com `medir` em cada iteração termina
- **THEN** o resultado traz os valores por iteração e o crescimento médio por iteração

### Requirement: Classificação de vazamento provável
O resultado MUST classificar a execução como "vazamento provável" quando a memória retida cresce de forma consistente ao longo das iterações, e como "sem indício de vazamento" caso contrário. Com menos de 5 iterações completas, a classificação MUST ser "dados insuficientes".

#### Scenario: Vazamento intencional detectado
- **WHEN** o cenário de um caso de vazamento da página de teste roda com 10 iterações
- **THEN** o resultado é classificado como "vazamento provável"

#### Scenario: Página limpa sem falso positivo
- **WHEN** o cenário da página de teste limpa roda com 10 iterações
- **THEN** o resultado é classificado como "sem indício de vazamento"

#### Scenario: Poucas iterações
- **WHEN** a execução tem 3 iterações completas
- **THEN** a classificação é "dados insuficientes"

### Requirement: Classificação apresentada como indício
A interface MUST apresentar "vazamento provável" como indício que depende de análise humana dos objetos listados, e MUST NOT apresentá-lo como confirmação.

#### Scenario: Texto do resultado
- **WHEN** o resultado é "vazamento provável"
- **THEN** a interface exibe os principais candidatos e informa que a confirmação depende de análise dos objetos

### Requirement: Memória na sessão manual
Na sessão manual com "Memória" ativa, a extensão MUST registrar medições leves periódicas e MUST gerar snapshot somente a pedido do usuário. Os resultados MUST NOT receber classificação de vazamento.

#### Scenario: Snapshot a pedido
- **WHEN** o usuário aciona "Tirar snapshot" durante a sessão manual
- **THEN** um resumo de snapshot é adicionado ao resultado, sem classificação de vazamento
