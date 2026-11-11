# Sondagem

Extensão do Chrome para testar a performance de páginas web em desenvolvimento, com foco em vazamentos de memória e problemas de processamento.

> **Estado:** em planejamento. Ainda não há código; as fases de desenvolvimento estão especificadas em `openspec/changes/`.

## Objetivo

- Detectar **vazamentos de memória** com evidência: tendência por iteração e lista dos objetos que mais cresceram.
- Identificar **problemas de processamento**: long tasks, interações lentas e funções que consomem CPU.
- Apresentar os resultados de forma **mais legível** do que os painéis do DevTools.
- Gerar medições **repetíveis e comparáveis** entre execuções e entre versões do build.

A Sondagem é uma extensão comum (side panel), não uma extensão de DevTools. Ela só atua quando o usuário clica em "Analisar" e remove tudo o que instalou ao terminar.

## Como funciona

Há dois modos de análise:

- **Cenário declarativo:** um arquivo JSON descreve os passos (clicar, digitar, esperar, medir), e a extensão os repete N vezes em condições fixas. É o modo usado para confirmar vazamentos e comparar builds.
- **Sessão manual:** a extensão apenas observa enquanto você navega. Serve para investigar um problema na hora; os resultados não são comparáveis.

O plano completo está em [PLANO-extensao-performance.md](openspec/PLANO-extensao-performance.md).

## Fases de desenvolvimento

O projeto usa [OpenSpec](https://github.com/Fission-AI/OpenSpec). Cada fase é uma change em `openspec/changes/`, com proposta, especificações, design e tarefas.

| Fase | Change | Entrega |
|---|---|---|
| 0 | `fase-0-setup` | Extensão carregável, build e página de teste |
| 1 | `fase-1-metricas-basicas` | Long tasks, Web Vitals e sessão manual |
| 2 | `fase-2-cenarios` | Cenários JSON executados pelo debugger |
| 3 | `fase-3-memoria` | Snapshots, tendência e detecção de vazamento |
| 4 | `fase-4-cpu` | Perfil de CPU resumido por função |
| 5 | `fase-5-robustez` | Throttling, preservação de sessão e histórico |
| 6 | `fase-6-relatorios` | Relatórios, comparação e exportação |

Para acompanhar o andamento:

```bash
openspec list
```

```bash
openspec show fase-0-setup
```

## Licença

Sondagem é software livre, distribuído sob a [GNU Affero General Public License, versão 3](LICENSE) (AGPL-3.0).
