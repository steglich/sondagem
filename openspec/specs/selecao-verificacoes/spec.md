# selecao-verificacoes Specification

## Purpose

Permite ao usuário escolher quais verificações rodam em cada análise, para que cada execução colete apenas o que interessa, e lembra a última escolha.

## Requirements

### Requirement: Escolha das verificações na confirmação
A tela de confirmação MUST listar as verificações disponíveis e permitir marcar ou desmarcar cada uma antes de iniciar.

#### Scenario: Lista de verificações
- **WHEN** a tela de confirmação é exibida
- **THEN** as verificações disponíveis aparecem com o estado marcado ou desmarcado, editável pelo usuário

### Requirement: Somente as verificações escolhidas são executadas
Uma análise MUST coletar dados apenas das verificações marcadas. Verificações desmarcadas MUST NOT instalar observadores nem produzir resultados.

#### Scenario: Apenas Carregamento ativo
- **WHEN** a análise roda só com "Carregamento" marcado
- **THEN** o resultado contém as métricas de carregamento e não contém long tasks nem interações

### Requirement: Ao menos uma verificação
A interface MUST impedir o início de uma análise sem nenhuma verificação marcada.

#### Scenario: Nenhuma verificação marcada
- **WHEN** o usuário desmarca todas as verificações
- **THEN** a confirmação fica desabilitada e uma mensagem explica o motivo

### Requirement: Verificações de Processamento e Carregamento
A extensão MUST oferecer a verificação "Processamento" (long tasks e interações lentas) e a verificação "Carregamento" (LCP, CLS, FCP e TTFB).

#### Scenario: Verificações oferecidas
- **WHEN** a tela de confirmação é exibida
- **THEN** "Processamento" e "Carregamento" estão entre as verificações disponíveis

### Requirement: Memória da última seleção
A extensão MUST salvar a última seleção de verificações por cenário (e uma para a sessão manual) e restaurá-la na próxima confirmação do mesmo contexto. Os dados salvos MUST conter apenas a seleção, sem dados da página ou de autenticação.

#### Scenario: Seleção restaurada
- **WHEN** o usuário conclui uma análise só com "Carregamento" e depois clica em "Analisar" de novo no mesmo contexto
- **THEN** a tela de confirmação abre com apenas "Carregamento" marcado
