# Proposal

## Why

Até aqui as medições funcionam, mas não são controladas nem duráveis: sem throttling fixo e cache limpo, duas execuções não são comparáveis; sem persistência, o resultado se perde ao fechar o navegador; e uma limpeza descuidada desloga o usuário e invalida o teste (plano, seções 3, 3.2, 3.5 e 9).

## What Changes

- Condições de teste: perfis de throttling de CPU e rede, cache desligado durante a execução e limpeza de cache HTTP e Cache Storage antes de cada execução.
- Preservação da sessão: cookies e storage nunca são apagados por padrão; `limpar_storage` só com declaração no cenário e confirmação; detecção de redirecionamento para o login; login scriptado só quando declarado.
- Persistência: resultados resumidos em IndexedDB com metadados completos, limites de tamanho com aviso e política de retenção definida pelo usuário.
- Recuperação: execução interrompida por suspensão do service worker é limpa e registrada sem perder os dados já coletados.
- Alerta sobre outras extensões ativas, com recomendação de perfil limpo.
- Medição do impacto da própria extensão sobre a página testada.

## Capabilities

### New Capabilities
- `condicoes-de-teste`: throttling, controle de cache e registro das condições aplicadas em cada execução.
- `preservacao-sessao`: garantia de que a análise não desloga o usuário, limpeza de storage só explícita e tratamento de sessão expirada.
- `persistencia-resultados`: armazenamento durável dos resultados, limites, retenção e recuperação de execuções interrompidas.
- `interferencia-extensoes`: alerta sobre extensões que podem interferir na medição.

### Modified Capabilities

Nenhuma.

## Impact

- Código: `extensao/storage/repository.ts`, módulos de condições e de sessão em `extensao/background/`, telas de configuração e avisos no side panel.
- Manifesto: nova permissão `management`.
- Uso de CDP: `Emulation`, `Network`, `Storage`.
- Dependência nova: `idb`.
- Resultados guardados em `chrome.storage.session` nas fases anteriores não são migrados.
- Depende de `fase-2-cenarios`; cobre também os dados das fases 3 e 4 quando aplicadas.
