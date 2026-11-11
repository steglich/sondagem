# Spec Delta

## Purpose

Define o comportamento mínimo da extensão Sondagem como extensão do Chrome: carregar sem erros, abrir o side panel e manter o código de medição separado do código de interface.

## ADDED Requirements

### Requirement: Extensão carrega sem erros
A extensão MUST carregar como extensão descompactada do Chrome (Manifest V3) a partir da pasta gerada pelo build, sem erros no manifesto, no service worker ou nas páginas da interface.

#### Scenario: Carregamento da pasta de build
- **WHEN** o usuário carrega a pasta de build em `chrome://extensions` com o modo de desenvolvedor ativo
- **THEN** a extensão aparece como ativa, sem erros listados e com o service worker registrado

### Requirement: Side panel abre pelo ícone da extensão
A extensão MUST abrir o side panel quando o usuário clica no ícone da extensão na barra do Chrome.

#### Scenario: Clique no ícone
- **WHEN** o usuário clica no ícone da extensão em uma aba qualquer
- **THEN** o side panel abre e exibe a tela de controle, sem erros no console do painel

### Requirement: Página de relatório separada
A extensão MUST oferecer uma página de relatório separada do side panel, aberta em uma aba própria.

#### Scenario: Abertura do relatório
- **WHEN** o usuário aciona a abertura do relatório a partir do side panel
- **THEN** uma nova aba abre com a página de relatório da extensão, sem erros no console

### Requirement: Nenhuma atividade sem comando do usuário
A extensão MUST NOT anexar o debugger, injetar código em páginas nem iniciar medições ao ser instalada, ao iniciar o navegador ou ao carregar uma página.

#### Scenario: Navegador reiniciado
- **WHEN** o navegador é reiniciado com a extensão instalada e o usuário navega por páginas sem interagir com a extensão
- **THEN** nenhuma página recebe código da extensão e nenhuma sessão de debugger é aberta

### Requirement: Interface sem execução dinâmica de código
As páginas da extensão MUST funcionar sob uma política de segurança de conteúdo que proíbe `eval` e scripts remotos.

#### Scenario: Interface sob CSP estrita
- **WHEN** o side panel e o relatório são abertos
- **THEN** nenhuma violação de CSP é registrada no console

### Requirement: Código de medição isolado da interface
O código do service worker e o código injetado na página MUST NOT incluir o framework de interface nem depender dele.

#### Scenario: Verificação dos artefatos de build
- **WHEN** o build é concluído
- **THEN** os arquivos do service worker e do código injetado não contêm código do framework de interface, e a verificação automática falha se contiverem
