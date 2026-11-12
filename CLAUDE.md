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
npm test                       # unitários (Vitest) + testes de componente da interface
npm run test:ui                # só os testes de componente (ng test, Vitest + jsdom)
npm run test:integracao        # Playwright; rode `npm run build` antes
npm run pagina-teste           # página de teste em http://localhost:4300
```

Teste único:

```bash
npx vitest run extensao/shared/texto.test.ts
(cd extensao/ui && npx ng test --no-watch --include src/app/painel/painel.spec.ts)
npx playwright test testes/pagina-teste/casos.spec.ts -g "cpu-pesada"
npx playwright test --project extensao
npx playwright test testes/extensao/cenario.spec.ts --project extensao -g "abrir-fechar"   # executa um cenário de ponta a ponta
npx playwright test testes/extensao/memoria.spec.ts --project extensao -g "chrome.debugger"   # confere os comandos de CDP no navegador
npx playwright test testes/extensao/cpu.spec.ts --project extensao -g "chrome.debugger"   # confere os comandos de CDP do perfil de CPU
node scripts/gerar-validador.mjs   # regenera o validador depois de mudar cenario.schema.json
```

Para carregar a extensão: `chrome://extensions` → modo de desenvolvedor → "Carregar sem compactação" → `dist/extensao/`. O ícone abre o side panel.

## Estrutura

```
extensao/
  manifest.json      # MV3; permissões só as da fase atual (hoje: sidePanel, storage, scripting, tabs, debugger, <all_urls>)
  background/        # service worker (TS puro, bundle ESM via esbuild); sessao.ts orquestra a sessão,
                     # cdp.ts é o wrapper do debugger, scenarios.ts é o runner de cenários
                     # memoria.ts faz as medições de memória pelo CDP
                     # e cpu.ts coleta o perfil de CPU pelo Tracing
  injected/          # código que roda na página testada (TS puro, bundle IIFE via esbuild; entrada: entrada.ts)
  shared/            # tipos e funções puras; testes Vitest ao lado (*.test.ts)
    cenario.schema.json   # JSON Schema do cenário (versão 1); gerado/ guarda o validador compilado
  storage/           # persistência: última seleção de verificações e cenários salvos
  ui/                # workspace Angular: side panel (#/painel) e relatório (#/relatorio, lazy); testes *.spec.ts
pagina-teste/        # casos controlados (HTML + TS sem framework), servidos na porta 4300; cenarios/ tem cenários de teste
docs/cenario.md      # formato do cenário, com exemplo (um teste valida o exemplo)
scripts/             # build.mjs, gerar-validador.mjs, verificar-isolamento.mjs, servidor-pagina-teste.mjs
testes/              # Playwright: extensao/ (extensão carregada) e pagina-teste/
dist/extensao/       # saída carregável (gerada)
```

## Regras de arquitetura

- **Medição nunca importa Angular.** `background/`, `injected/` e `shared/` não podem importar `@angular/*` nem `extensao/ui/`. Isso é barrado pelo ESLint (`no-restricted-imports`) e conferido depois do build por `scripts/verificar-isolamento.mjs`.
- **Interface sob CSP estrita** (`script-src 'self'`): nada de `eval`, scripts inline ou remotos. Por isso `inlineCritical` está desligado no `angular.json`, e o validador do cenário é gerado em tempo de build (o Ajv em tempo de execução usa `new Function`). `verificar-isolamento.mjs` também falha se os bundles de medição tiverem `eval` ou `new Function`.
- O Angular escreve direto em `dist/extensao/` (`deleteOutputPath: false`); `scripts/build.mjs` limpa a pasta, copia o manifesto e gera os bundles de medição. Roteamento por hash, porque páginas de extensão não têm servidor. Não há dev server.
- A extensão não faz nada sem comando do usuário: sem content scripts declarados, sem injeção nem debugger ao instalar ou navegar. O código de medição só entra na página entre o comando `iniciar` e o fim da sessão (content script registrado dinamicamente, removido na parada).
- Tudo o que uma sessão instala tem de sair na limpeza e aparecer na lista do que foi removido. Na página, `extensao/injected/rastreador.ts` intercepta `PerformanceObserver` e `addEventListener` do mundo isolado para conseguir desligar também o que a `web-vitals` cria.
- `chrome.*` fica nas bordas: `extensao/background/service-worker.ts`, `extensao/injected/entrada.ts` e `extensao/ui/src/app/sessao/ponte.ts`. O resto recebe essas dependências por parâmetro e é testado sem navegador. `chrome.debugger` só aparece no `transporteCdp` de `service-worker.ts`.
- **Debugger só durante a análise.** Ele é anexado depois da confirmação, e só se a análise exigir (execução de cenário ou verificação com `exige: 'debugger'`), e sai sempre no fim, inclusive em erro, cancelamento e conexão perdida. A extensão nunca disputa a aba: se já houver outro depurador (DevTools, outra extensão), a análise não começa.
- O código de medição e a página de teste não são minificados, para que nomes de função (ex.: `calculoPesado`) apareçam nos perfis de CPU.
- Página de teste: cada caso expõe `window.estadoTeste` para os testes, e todo elemento interativo tem `data-testid` único.

## Sessão: fluxo de mensagens

Os tipos de todas as mensagens estão em `extensao/shared/types.ts`.

```
página (injected.js, mundo isolado)        service worker                       interface (side panel)
        │── porta "sondagem-pagina" ──────────▶│                                        │
        │◀── configurar {selecao} ─────────────│◀── iniciar {idAba, selecao} ───────────│  runtime.sendMessage
        │── lote (1 por segundo) ─────────────▶│── visao (status, ≤ 1 por segundo) ────▶│  runtime.sendMessage
        │◀── encerrar ─────────────────────────│◀── parar | cancelar ───────────────────│
        │── encerrado {lote, desconectados} ──▶│── visao (resultado + limpeza) ────────▶│
```

- **Página → service worker**: `extensao/injected/sessao-pagina.ts` abre a porta e só instala os observadores depois de receber `configurar`; sem essa mensagem (não há sessão para a aba) o script termina sem instalar nada. `extensao/injected/observers.ts` coleta long tasks e interações, `extensao/injected/vitals.ts` liga a `web-vitals`, e `extensao/injected/lotes.ts` envia um lote por segundo, nunca um evento por mensagem.
- **Service worker**: `extensao/background/sessao.ts` valida a aba, registra o content script, agrega os lotes (`extensao/shared/agregacao.ts`) e grava o estado em `chrome.storage.session` (chave `sondagem:sessao`). As transições estão em `extensao/shared/sessao-estado.ts` (ociosa → ativa → parando → ociosa); só existe uma sessão por vez. Ao acordar e em `tabs.onRemoved`, uma sessão cuja aba sumiu é encerrada como interrompida, com os dados já recebidos.
- **Service worker → interface**: durante a análise vai só o status resumido, limitado a uma publicação por segundo por `extensao/shared/limitador.ts`; os registros detalhados vão apenas no resultado. A interface aplica o mesmo limite em `extensao/ui/src/app/sessao/servico-sessao.ts`.
- **Interface**: `extensao/ui/src/app/painel/painel.ts` alterna entre confirmação, sessão ativa e resultado (componentes em `extensao/ui/src/app/sessao/`); ocioso, mostra também a tela de cenários (`extensao/ui/src/app/cenarios/`). Com um cenário escolhido, a confirmação oferece os modos "Cenário" e "Sessão manual". O painel aberto em aba própria aceita `index.html?aba=<id>#/painel` para indicar a aba alvo; os testes de integração usam esse caminho, porque o Playwright não abre o side panel.

## Cenários, debugger e runner

O formato do cenário está em `docs/cenario.md`. O fluxo de uma execução:

1. **Validação** (`extensao/shared/cenario.ts`): o validador gerado confere a estrutura contra `cenario.schema.json`, e `checagemComplementar` cobre o que o schema não expressa (`vezes`, rótulos de snapshot únicos). Os erros saem como caminho JSON Pointer mais mensagem em português; JSON malformado sai com linha e coluna. A interface valida ao salvar e o service worker valida de novo antes de executar. Depois de mudar o schema, rode `node scripts/gerar-validador.mjs` (o arquivo gerado é versionado, e um teste falha se estiver desatualizado).
2. **Conexão** (`extensao/background/cdp.ts`): `criarConexaoCdp(transporte)` expõe `anexar`, `enviar`, `aoEvento`, `aoPerder` e `desanexar` (idempotente). Antes de anexar, consulta `chrome.debugger.getTargets()`: no Chrome atual a anexação não falha com o DevTools aberto, então é o campo `attached` que revela outro depurador. As falhas viram `FalhaAnexacao` com categoria `outro-depurador`, `alvo-nao-depuravel` ou `desconhecido`; os textos estão em `extensao/shared/mensagens-debugger.ts`. `chrome.debugger.onDetach` vira `aoPerder(motivo)`.
3. **Runner** (`extensao/background/scenarios.ts`): `executarCenario` abre a `url_inicial`, roda o aquecimento e os passos, e altera o `AndamentoExecucao` da sessão a cada transição. Os estados e a tabela de transições estão em `extensao/shared/execucao-estado.ts` (ociosa → preparando → aquecendo → executando ⇄ coletando → concluída | erro | cancelada). As ações usam o domínio `Input` do CDP, para que os eventos sejam confiáveis e contem para o INP. Toda espera é uma sondagem de 50 ms com prazo, e o cancelamento é um `AbortSignal`. Passos de medição (`medir`, `snapshot`, `forcar_gc`) só rodam se a verificação de `VERIFICACAO_DO_PASSO` ("Memória") estiver marcada; quem os executa é `extensao/background/memoria.ts`. Com "CPU" marcada, o runner liga o perfil depois do aquecimento e o para ao final dos passos principais (ver "CPU").
4. **Orquestração** (`extensao/background/sessao.ts`): o runner roda fora da fila de operações e nunca espera por ela. A cada início e fim de iteração ele avisa; o orquestrador repassa a marca à página (mensagem `marcar`, que faz a página enviar o lote na hora) e usa os intervalos para carimbar cada long task, interação e erro com a iteração (`extensao/shared/agregacao.ts`). O que acontece no aquecimento é descartado. No fim, `sessao-estado.ts` monta o `ResultadoCenario` com mediana, p75 e p95 (`extensao/shared/stats.ts`) entre as iterações completas.

Os testes unitários do runner e do orquestrador usam o transporte falso, a página simulada e o relógio simulado de `extensao/background/apoio-teste.ts`.

Para rodar um cenário à mão: `npm run build`, `npm run pagina-teste`, carregue a extensão, abra `http://localhost:4300/` em uma janela sem DevTools, abra o side panel, cole o conteúdo de `pagina-teste/cenarios/abrir-fechar.json` em "Cenários", salve e clique em "Analisar".

Nos testes de integração o Playwright é ele mesmo um cliente de depuração de cada página, o que acionaria o bloqueio por "outro depurador". Por isso `testes/extensao/fixtures.ts` grava `sondagem:teste:ignorar-depurador-anexado` em `chrome.storage.local`, chave lida só em `service-worker.ts` e sem interface. O teste do bloqueio remove a chave.

## Memória

O `chrome.debugger` trata a extensão como cliente não confiável: `HeapProfiler.*`, `Memory.*`, `Profiler.*` e `Runtime.getHeapUsage` são recusados (`wasn't found` ou `not allowed for untrusted clients`). Por isso **não há heap snapshot**, nem tamanho por objeto. `extensao/background/memoria.ts` usa só o que é aceito, e `COMANDOS_DE_MEMORIA` lista cada comando; o primeiro teste de `testes/extensao/memoria.spec.ts` envia todos pelo `chrome.debugger` real e falha se algum for recusado. Os testes unitários usam o transporte falso, que aceita qualquer comando: **todo comando novo de CDP tem de entrar nesse teste de integração** (uma sessão de CDP do Playwright é confiável e também não serve de prova).

| Passo ou verificação | Como é feito |
|---|---|
| `forcar_gc` | `Runtime.queryObjects` de `Object.prototype`: para devolver só objetos vivos, o navegador faz antes uma coleta completa. A resposta é descartada e o grupo de objetos, liberado. |
| `medir` | `Performance.getMetrics`: `JSHeapUsedSize`, `Nodes`, `JSEventListeners`. |
| `snapshot` | Censo: `Runtime.queryObjects` + `Runtime.callFunctionOn` com `contarPorConstrutor`, que roda **na página** e devolve só a tabela de contagens por construtor (500 mais "outros"). O grupo de objetos é liberado sempre, inclusive em erro. |
| "DOM e listeners" | No início (depois do aquecimento) e no fim: coleta, `Performance.getMetrics` e `DOM.getDetachedDomNodes` (o domínio `DOM` fica habilitado só durante a leitura). Não depende de "Memória". |

- `contarPorConstrutor` é enviada como texto (`toString()`): não pode usar nada de fora do próprio corpo.
- O que é medido vai para `DadosColetados` (`medicoes`, `snapshots`, `contadoresDom`, `pausasDeMedicao`). Long tasks que coincidem com um censo recebem `causadaPelaMedicao` e ficam fora das estatísticas (`extensao/shared/agregacao.ts`).
- A análise é pura e fica em `extensao/shared/memoria.ts`: série por iteração, `classificarSerie` (≥ 5 iterações, subida em ≥ 80% das transições, crescimento acima do mínimo), `classificarExecucao` (basta uma das três séries acusar: um nó DOM retido quase não aparece no heap de JavaScript), comparação entre o primeiro e o último censo, e variação de nós desanexados e listeners. Os limites estão em `LIMITES_PADRAO`. `sessao-estado.ts` chama `analisarMemoria` ao concluir e grava em `ResultadoSessao.memoria`.
- Sessão manual com "Memória": uma medição ao iniciar e outra a cada 5 segundos (sem coleta forçada), e o comando `tirar-snapshot` faz um censo a pedido. Não há classificação, porque não há iterações.
- Cenários de aceitação em `pagina-teste/cenarios/`: `vazamento-listener` e `vazamento-dom` têm de dar "vazamento provável", e `limpa-memoria`, "sem indício".

## CPU

O domínio `Profiler` é recusado a extensões, então o perfil vem do `Tracing`, com a categoria `disabled-by-default-v8.cpu_profiler`. `extensao/background/cpu.ts` (`criarPerfilCpu`) faz a coleta, e `COMANDOS_DE_CPU` lista cada comando; o primeiro teste de `testes/extensao/cpu.spec.ts` envia todos pelo `chrome.debugger` real.

- **Coleta**: `Tracing.start` liga o amostrador (cerca de 160 µs entre amostras, não configurável). Os dados só chegam depois de `Tracing.end`, em eventos `Tracing.dataCollected`, e `Tracing.tracingComplete` fecha a entrega e informa `dataLossOccurred`. O módulo espera a entrega por até `TEMPO_LIMITE_ENTREGA_MS`.
- **Agregação** (`extensao/shared/cpu.ts`, pura): `criarAgregadorCpu` soma cada entrega e a descarta, então o perfil bruto nunca fica inteiro no service worker e só o `ResumoCpu` é gravado. Um evento `Profile` abre o perfil (com o instante de início) e os `ProfileChunk` trazem nós (`id`, `parent`, `callFrame`), amostras e deltas em µs. Tempo próprio é o das amostras com a função no topo; tempo total conta cada função da pilha uma vez por amostra (recursão não infla). Linha e coluna chegam em base 0 e são gravadas em base 1.
- **Fora da lista de funções**: `(idle)`, `(garbage collector)`, `(program)` e `(root)` viram as categorias `ocioso`, `coletaDeLixo` e `programa`, e funções de `chrome-extension://` viram `extensoes`. O percentual é do tempo próprio sobre o tempo amostrado sem o ocioso. O resumo guarda `LIMITE_FUNCOES_CPU` (200) funções mais a linha "outras"; a interface lista `FUNCOES_EXIBIDAS` (30).
- **Intervalos excluídos**: as amostras durante `snapshot` e `forcar_gc` não entram. `perfil.excluir(operacao)` lê o instante antes e depois com `Performance.getMetrics` (`Timestamp`), que está no mesmo relógio monotônico do trace; o relógio do service worker não serve.
- **Cenário**: o runner chama `iniciar` depois do aquecimento e da leitura de início de "DOM e listeners", e `encerrar` ao final dos passos principais. Se um passo falha com a conexão de pé, o que foi gravado ainda vira resumo; em cancelamento ou conexão perdida, `abandonar` só envia `Tracing.end`. Desanexar o debugger também encerra o trace.
- **Sessão manual**: o perfil cobre a sessão até `LIMITE_PERFIL_MANUAL_MS` (5 minutos). No limite só o perfil para (`limiteAtingido`), e o status enviado à interface passa a `limite-atingido`.
- **Falhas**: `Tracing.start` falha se o navegador já tem um trace em andamento (uma gravação do painel Performance, por exemplo). A análise continua sem perfil, e `dados.cpu` fica com `estado: 'falhou'` e o motivo. Uma análise que acaba com o perfil ainda aberto também vira `falhou` (`sessao-estado.ts`).
- O resultado fica em `DadosColetados.cpu` (`ColetaCpu`); `ativo` diz que o perfil chegou a ser ligado, e a interface avisa que as outras métricas foram medidas com esse custo.
- Cenário de aceitação: `pagina-teste/cenarios/cpu-pesada.json` tem de pôr `calculoPesado` como a primeira função da página no resumo.

## Registro de verificações

`extensao/shared/verificacoes.ts` lista as verificações oferecidas na confirmação (hoje "Processamento", "Carregamento", "Erros da página", "Memória", "DOM e listeners" e "CPU"), o que cada uma exige (`pagina` ou `debugger`) e quais coletores liga. Para acrescentar uma verificação, adicione a entrada ali e trate os novos coletores em `extensao/injected/instalacao.ts`; a tela de confirmação e a memória da seleção (`extensao/storage/selecao.ts`, em `chrome.storage.local`, uma seleção por contexto: `manual` ou `cenario:<nome>`) passam a incluí-la sem outras mudanças.

Uma verificação com `exige: 'debugger'` é coletada pelo service worker via CDP, sem content script ("Erros da página" usa `Runtime.exceptionThrown`, convertido em `extensao/shared/erros-pagina.ts`; "Memória", "DOM e listeners" e "CPU" estão descritas acima). Na sessão manual elas vêm desmarcadas por padrão, para que a barra de depuração só apareça se o usuário pedir; em cenário vêm marcadas.

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
