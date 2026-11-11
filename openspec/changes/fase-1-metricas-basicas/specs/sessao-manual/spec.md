# Spec Delta

## Purpose

Oferece um modo de diagnóstico em que a extensão apenas observa e registra as medições enquanto o usuário navega livremente, para investigar um problema percebido na hora.

## ADDED Requirements

### Requirement: Observação sem ações automáticas
Na sessão manual, a extensão MUST apenas observar. Ela MUST NOT executar cliques, digitação, navegação, recargas nem iterações.

#### Scenario: Sessão manual em andamento
- **WHEN** uma sessão manual está ativa
- **THEN** nenhuma ação é disparada na página pela extensão

### Requirement: Parada somente por comando
A sessão manual MUST terminar apenas pelo botão "Parar" ou pelo fechamento explícito da sessão. Ela MUST NOT parar por inatividade, salvo se o usuário configurar um limite de inatividade.

#### Scenario: Sessão ociosa
- **WHEN** a sessão fica 30 minutos sem interação do usuário e sem limite de inatividade configurado
- **THEN** a sessão continua ativa

### Requirement: Limpeza completa ao parar
Ao parar, a extensão MUST desconectar todos os observadores, remover listeners e hooks da página, encerrar as conexões entre página e extensão, cancelar temporizadores pendentes e deixar a aba sem resíduos da análise.

#### Scenario: Nada permanece ativo
- **WHEN** o usuário clica em "Parar"
- **THEN** nenhuma conexão, listener ou observador da sessão permanece ativo

### Requirement: Confirmação de limpeza
Depois de parar, a interface MUST informar que a desconexão foi concluída e listar o que foi removido.

#### Scenario: Lista do que foi removido
- **WHEN** a limpeza termina
- **THEN** o side panel exibe a confirmação com os itens removidos

### Requirement: Sessão interrompida
Se a aba for fechada ou a extensão for suspensa durante a sessão, a extensão MUST executar a limpeza na próxima oportunidade, registrar a sessão como interrompida e manter os dados já coletados.

#### Scenario: Aba fechada durante a sessão
- **WHEN** o usuário fecha a aba analisada com a sessão ativa
- **THEN** a limpeza é executada, a sessão fica registrada como interrompida e os dados recebidos até então continuam disponíveis

### Requirement: Resultado identificado como sessão manual
O resultado de uma sessão manual MUST ser marcado com o tipo "sessão manual" e MUST NOT ser tratado como comparável a execuções de cenário.

#### Scenario: Tipo registrado
- **WHEN** uma sessão manual termina
- **THEN** o resultado exibido e armazenado indica o tipo "sessão manual"
