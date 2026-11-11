# Design

## Context

Repositório vazio. Ver proposal.md para a motivação. Restrições que moldam o setup: Manifest V3 (service worker suspenso quando ocioso, CSP sem `eval`), uso interno sem Chrome Web Store, e a regra de que o código injetado na página testada nunca carrega Angular (plano, seção 3.5).

## Goals / Non-Goals

**Goals:**
- Uma pasta `dist/extensao/` carregável em `chrome://extensions`.
- Dois pipelines de build independentes: medição (esbuild) e interface (Angular).
- Testes unitários e de integração executáveis localmente por um comando cada.
- Página de teste pronta para ser o critério de aceitação das fases 1, 3 e 4.

**Non-Goals:**
- Qualquer medição, injeção ou uso de CDP.
- Execução em CI ou headless agendada.
- Empacotamento `.crx` ou publicação.

## Decisions

### Estrutura de pastas
```
extensao/
  manifest.json
  background/      # service worker (TS puro)
  injected/        # código que roda na página testada (TS puro)
  shared/          # tipos e funções puras, usados por todos
  storage/         # persistência
  ui/              # workspace Angular
pagina-teste/      # casos controlados (HTML + TS sem framework)
scripts/           # build e verificações
dist/extensao/     # saída carregável
```
Segue a seção 4 do plano. `shared/` não pode importar de `ui/`, `background/` nem `injected/`.

### esbuild para a medição, Angular CLI para a interface
O service worker é empacotado como módulo ES (`"type": "module"` no manifesto) e o código injetado como IIFE, cada um em um arquivo. O Angular gera build de produção com `--base-href ./`, e um script copia tudo para `dist/extensao/`. Alternativa descartada: um builder único do Angular para tudo, que dificultaria garantir que o Angular não entra no código injetado.

### Uma aplicação Angular, duas rotas
Side panel e relatório são rotas da mesma aplicação (`index.html#/painel` e `index.html#/relatorio`), com roteamento por hash, porque páginas de extensão não têm servidor para reescrever URLs. O relatório é carregado sob demanda (lazy). Alternativa descartada: duas aplicações, que duplicariam configuração sem ganho nesta escala.

### Sem dev server
Desenvolvimento com `npm run watch` (esbuild e `ng build --watch` em paralelo) e recarga manual da extensão. O dev server do Angular não funciona em páginas `chrome-extension://`.

### Isolamento verificado de duas formas
1. Regra de ESLint (`no-restricted-imports`) que proíbe `@angular/*` e `extensao/ui/**` em `background/`, `injected/` e `shared/`.
2. Script pós-build que procura marcas do Angular nos bundles do service worker e do código injetado e falha se encontrar.

### Testes
- **Vitest** para unidades em `shared/`, `background/` e `injected/`.
- **Playwright** com Chromium em contexto persistente e `--load-extension`, para verificar que a extensão carrega, que o service worker registra e que o side panel renderiza. Roda só localmente.
- Os testes do Angular usam o runner padrão do workspace.

### Permissões mínimas por fase
Nesta fase: `sidePanel` e `storage`. `scripting` e permissão de host entram na fase 1; `debugger` na fase 2. O side panel abre pelo ícone via `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.

### Página de teste sem framework
HTML e TypeScript simples, servidos por um servidor estático local na porta 4300, com uma rota por caso: `/limpa`, `/vazamento-listener`, `/vazamento-dom`, `/cpu-pesada`. Sem framework para que os vazamentos sejam exatamente os escritos, sem ruído de biblioteca. A função pesada tem nome próprio (`calculoPesado`) e não é minificada, para ser reconhecida no perfil de CPU da fase 4.

## Risks / Trade-offs

- [Playwright não abre o side panel pelo ícone da extensão] → O teste abre a URL do painel diretamente (`chrome-extension://<id>/index.html#/painel`); a abertura pelo ícone é verificada manualmente.
- [Dois pipelines de build podem divergir em configuração de TypeScript] → Um `tsconfig.base.json` na raiz, estendido pelos dois.
- [A verificação por marcas do Angular no bundle pode dar falso negativo] → A regra de ESLint é a barreira principal; o script é a segunda checagem.
