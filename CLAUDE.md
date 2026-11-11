# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projeto

Sondagem: extensão do Chrome (Manifest V3, side panel) para testar a performance de páginas web em desenvolvimento. O plano completo está em `openspec/PLANO-extensao-performance.md`; cada fase é uma change em `openspec/changes/`.

Stack: TypeScript, Angular (só a interface), esbuild (código de medição), Vitest, Playwright, ESLint. Node ≥ 22.12.

## Comandos

```bash
npm install                    # dependências
npx playwright install --no-shell chromium   # navegador dos testes de integração (uma vez)
npm run build                  # gera dist/extensao/ e verifica o isolamento do Angular
npm run watch                  # rebuild contínuo (esbuild + ng build --watch); recarregue a extensão à mão
npm run lint                   # ESLint
npm run typecheck              # tsc do código fora da interface
npm test                       # Vitest (unitários)
npm run test:integracao        # Playwright; rode `npm run build` antes
npm run pagina-teste           # página de teste em http://localhost:4300
```

Teste único:

```bash
npx vitest run extensao/shared/texto.test.ts
npx playwright test testes/pagina-teste/casos.spec.ts -g "cpu-pesada"
npx playwright test --project extensao
```

Para carregar a extensão: `chrome://extensions` → modo de desenvolvedor → "Carregar sem compactação" → `dist/extensao/`. O ícone abre o side panel.

## Estrutura

```
extensao/
  manifest.json      # MV3; permissões só as da fase atual (hoje: sidePanel, storage)
  background/        # service worker (TS puro, bundle ESM via esbuild)
  injected/          # código que roda na página testada (TS puro, bundle IIFE via esbuild)
  shared/            # tipos e funções puras; testes Vitest ao lado (*.test.ts)
  storage/           # persistência
  ui/                # workspace Angular: side panel (#/painel) e relatório (#/relatorio, lazy)
pagina-teste/        # casos controlados (HTML + TS sem framework), servidos na porta 4300
scripts/             # build.mjs, verificar-isolamento.mjs, servidor-pagina-teste.mjs
testes/              # Playwright: extensao/ (extensão carregada) e pagina-teste/
dist/extensao/       # saída carregável (gerada)
```

## Regras de arquitetura

- **Medição nunca importa Angular.** `background/`, `injected/` e `shared/` não podem importar `@angular/*` nem `extensao/ui/`. Isso é barrado pelo ESLint (`no-restricted-imports`) e conferido depois do build por `scripts/verificar-isolamento.mjs`.
- **Interface sob CSP estrita** (`script-src 'self'`): nada de `eval`, scripts inline ou remotos. Por isso `inlineCritical` está desligado no `angular.json`.
- O Angular escreve direto em `dist/extensao/` (`deleteOutputPath: false`); `scripts/build.mjs` limpa a pasta, copia o manifesto e gera os bundles de medição. Roteamento por hash, porque páginas de extensão não têm servidor. Não há dev server.
- A extensão não faz nada sem comando do usuário: sem content scripts declarados, sem injeção nem debugger ao instalar ou navegar.
- O código de medição e a página de teste não são minificados, para que nomes de função (ex.: `calculoPesado`) apareçam nos perfis de CPU.
- Página de teste: cada caso expõe `window.estadoTeste` para os testes, e todo elemento interativo tem `data-testid` único.

## Fluxo de trabalho: OpenSpec (spec-driven)

Mudanças são planejadas como *changes* do OpenSpec antes de serem implementadas (`openspec/config.yaml` usa o schema `spec-driven`).

- `openspec/specs/` — specs principais, a fonte da verdade do comportamento atual.
- `openspec/changes/<nome>/` — mudanças em andamento (proposal, design, delta specs, tasks).
- `openspec/changes/archive/` — mudanças concluídas.

Ciclo usual, via slash commands:

1. `/opsx:explore` — explorar a ideia/requisitos antes de propor (opcional).
2. `/opsx:propose` — criar a change com todos os artefatos.
3. `/opsx:update` — revisar os artefatos de planejamento (não edita código).
4. `/opsx:apply` — implementar as tasks da change.
5. `/opsx:sync` — levar os delta specs para as specs principais sem arquivar.
6. `/opsx:archive` — arquivar a change concluída.

CLI útil para inspeção:

```bash
openspec list            # changes ativas (--specs para listar specs)
openspec show <nome>     # exibir uma change ou spec
openspec validate <nome> # validar uma change ou spec
```

Restrições de projeto que devam orientar os artefatos (idioma, plataformas, regras por artefato) vão em `openspec/config.yaml`, nas chaves `context`, `rules` e `operations` — hoje estão todas vazias.
