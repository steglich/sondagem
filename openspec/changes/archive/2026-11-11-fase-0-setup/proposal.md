# Proposal

## Why

O repositório ainda não tem código. Antes de qualquer medição, é preciso ter a extensão carregando no Chrome, o pipeline de build que separa medição (TypeScript puro) de interface (Angular) e a página de teste com problemas controlados, que serve de critério de aceitação das fases seguintes (PLANO-extensao-performance.md, seções 4, 7 e 8).

## What Changes

- Criar a estrutura do projeto: manifesto MV3, service worker vazio, código injetado vazio, aplicação Angular com as rotas de side panel e de relatório vazias.
- Criar o build que gera uma pasta única carregável em `chrome://extensions`, com modo `--watch`.
- Garantir, por verificação automática, que o código de medição não importa Angular.
- Configurar a infraestrutura de testes (unitários e de integração com a extensão carregada).
- Criar a página de teste com os quatro casos controlados: listener não removido, nós DOM retidos, função pesada e página limpa.
- Atualizar o `CLAUDE.md` com os comandos reais de build e teste.

## Capabilities

### New Capabilities
- `extensao-base`: a extensão carrega no Chrome sem erros, abre o side panel e mantém o código de medição isolado do código de interface.
- `pagina-de-teste`: página local com problemas de performance conhecidos e uma página de controle, usada para validar as detecções.

### Modified Capabilities

Nenhuma.

## Impact

- Código novo: `extensao/` (manifesto, `background/`, `injected/`, `shared/`, `storage/`, `ui/`), `pagina-teste/`, scripts de build na raiz.
- Dependências novas: Angular, esbuild, Vitest, Playwright, ESLint.
- Permissões do manifesto nesta fase: apenas `sidePanel` e `storage`. As demais entram na fase que as usa.
- Fases seguintes dependem desta: `fase-1-metricas-basicas` em diante.
