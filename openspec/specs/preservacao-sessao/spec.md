# preservacao-sessao Specification

## Purpose

Garante que analisar uma aplicação autenticada não desloga o usuário: os dados de sessão nunca são apagados sem declaração e confirmação, e a perda de sessão é tratada como falha de sessão, não de performance.

## Requirements

### Requirement: Dados de sessão preservados por padrão
A extensão MUST NOT apagar cookies, `localStorage`, `sessionStorage` nem IndexedDB da aplicação analisada, salvo quando o cenário declarar `limpar_storage` e o usuário confirmar.

#### Scenario: Usuário continua logado
- **WHEN** uma execução completa termina em uma aplicação autenticada
- **THEN** o usuário continua logado na aplicação

#### Scenario: Limpeza de cache não afeta a sessão
- **WHEN** a limpeza de cache antes da execução é feita
- **THEN** os cookies e o `localStorage` da origem permanecem inalterados

### Requirement: Limpeza de storage somente explícita
A limpeza de storage MUST ocorrer apenas para os tipos listados em `limpar_storage` no cenário. Antes de qualquer limpeza, a interface MUST mostrar quais tipos de dados serão removidos e exigir confirmação específica.

#### Scenario: Aviso e confirmação
- **WHEN** o usuário inicia um cenário com `limpar_storage: ["local_storage"]`
- **THEN** a confirmação avisa que o `localStorage` da origem será apagado e exige confirmação específica

#### Scenario: Somente os tipos confirmados
- **WHEN** o usuário confirma a limpeza de `local_storage`
- **THEN** apenas o `localStorage` da origem é apagado, e os cookies permanecem

#### Scenario: Usuário recusa a limpeza
- **WHEN** o usuário não confirma a limpeza
- **THEN** a execução não começa e nada é apagado

### Requirement: Detecção de sessão expirada
Quando o cenário declara a URL de login, a extensão MUST detectar o redirecionamento para ela durante a execução, marcar o passo como falha de sessão e parar a execução com mensagem clara. A falha de sessão MUST NOT ser contada como resultado de performance.

#### Scenario: Redirecionamento para o login
- **WHEN** a aplicação redireciona para a URL de login na iteração 6
- **THEN** a execução para, o resultado indica falha de sessão na iteração 6 e nenhuma estatística de performance é apresentada como válida

### Requirement: Login scriptado somente quando declarado
O login por passos do cenário MUST ser executado apenas se o cenário o declarar. A extensão MUST NOT armazenar credenciais.

#### Scenario: Cenário sem login declarado
- **WHEN** a sessão expira em um cenário sem passos de login
- **THEN** a execução para com falha de sessão e a extensão não tenta autenticar

#### Scenario: Credenciais não persistidas
- **WHEN** um cenário com passos de login é executado e salvo no histórico
- **THEN** o resultado armazenado não contém os valores digitados nos passos de login

### Requirement: Dados da extensão sem conteúdo de autenticação
As preferências e os resultados salvos pela extensão MUST NOT conter cookies, tokens ou conteúdo de storage da aplicação analisada.

#### Scenario: Inspeção do armazenamento da extensão
- **WHEN** o armazenamento da extensão é inspecionado depois de uma execução em aplicação autenticada
- **THEN** não há cookies, tokens nem valores de storage da aplicação
