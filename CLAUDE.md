# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estado do repositório

O projeto ainda não tem código de aplicação, stack definida, nem comandos de build/lint/teste. Hoje existe apenas a estrutura do OpenSpec (`openspec/`) e os comandos/skills correspondentes em `.claude/`. Não há commits.

Quando a stack for escolhida, atualize este arquivo com os comandos reais (build, lint, testes, como rodar um único teste) e a arquitetura.

## Fluxo de trabalho: OpenSpec (spec-driven)

Mudanças são planejadas como *changes* do OpenSpec antes de serem implementadas (`openspec/config.yaml` usa o schema `spec-driven`).

- `openspec/specs/` — specs principais, a fonte da verdade do comportamento atual (vazio por enquanto).
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
