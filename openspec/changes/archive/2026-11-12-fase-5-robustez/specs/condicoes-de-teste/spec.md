# Spec Delta

## Purpose

Fixa e registra as condições em que cada execução acontece (CPU, rede e cache), para que os resultados sejam repetíveis e comparáveis.

## ADDED Requirements

### Requirement: Perfis de throttling
A extensão MUST oferecer os perfis de throttling "nenhum" e "padrao" (CPU 4 vezes mais lenta e rede equivalente a 4G lenta) e MUST permitir perfis personalizados com fator de CPU, latência e taxas de download e upload.

#### Scenario: Perfil padrão aplicado
- **WHEN** um cenário com `throttling: "padrao"` é executado
- **THEN** a página roda com CPU 4 vezes mais lenta e com a rede limitada durante toda a execução

#### Scenario: Perfil personalizado
- **WHEN** o usuário informa um perfil com fator de CPU 6 e latência de 300 ms
- **THEN** a execução aplica esses valores

#### Scenario: Perfil inexistente
- **WHEN** o cenário referencia um perfil que não existe
- **THEN** a execução não começa e a mensagem lista os perfis disponíveis

### Requirement: Throttling fixo durante a execução
As condições de throttling MUST ser aplicadas antes do aquecimento, mantidas sem alteração até o fim e desfeitas ao término, inclusive em erro ou cancelamento.

#### Scenario: Condições desfeitas
- **WHEN** a execução termina ou é cancelada
- **THEN** a aba volta a rodar sem limitação de CPU ou rede

### Requirement: Cache desligado durante a execução
Durante a execução de um cenário, o cache HTTP do navegador MUST estar desligado para a aba analisada, salvo se o cenário declarar o contrário.

#### Scenario: Recursos buscados de novo
- **WHEN** a página é recarregada durante a execução
- **THEN** os recursos são buscados na rede, e não do cache

### Requirement: Limpeza de cache antes da execução
Antes de cada execução de cenário, a extensão MUST limpar o cache HTTP e o Cache Storage da origem analisada e recarregar a página.

#### Scenario: Execução parte de cache limpo
- **WHEN** uma execução começa
- **THEN** o cache HTTP e o Cache Storage da origem estão vazios antes do aquecimento

### Requirement: Condições registradas no resultado
Cada resultado MUST registrar os valores efetivos de throttling (fator de CPU, latência, taxas) e o estado do cache usados na execução.

#### Scenario: Valores no resultado
- **WHEN** uma execução com perfil "padrao" termina
- **THEN** o resultado contém os valores numéricos aplicados, e não só o nome do perfil

### Requirement: Sessão manual sem alteração de condições por padrão
Na sessão manual, a extensão MUST NOT aplicar throttling nem limpar cache, salvo escolha explícita do usuário na confirmação.

#### Scenario: Sessão manual padrão
- **WHEN** uma sessão manual é iniciada sem escolha de throttling
- **THEN** a página roda nas condições normais do navegador

### Requirement: Variação entre execuções reportada
Ao comparar execuções repetidas do mesmo cenário nas mesmas condições, a extensão MUST reportar a variação de cada métrica entre elas e MUST sinalizar quando a variação passar do limite configurado.

#### Scenario: Variação acima do limite
- **WHEN** três execuções do mesmo cenário têm variação de uma métrica acima do limite configurado
- **THEN** a interface sinaliza a métrica como instável
