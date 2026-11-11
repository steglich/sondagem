# Tasks

## 1. Estrutura e ferramentas

- [x] 1.1 Criar `package.json` na raiz, `tsconfig.base.json` e as pastas `extensao/{background,injected,shared,storage}`, `pagina-teste/` e `scripts/`; verificar que `npm install` conclui sem erros
- [x] 1.2 Criar o workspace Angular em `extensao/ui/` com roteamento por hash e as rotas `painel` e `relatorio` (lazy) com componentes vazios; verificar que `ng build` conclui em modo produção
- [x] 1.3 Configurar ESLint com `no-restricted-imports` proibindo `@angular/*` e `extensao/ui/**` em `background/`, `injected/` e `shared/`; verificar que um import proibido de teste faz `npm run lint` falhar e que, sem ele, passa
- [x] 1.4 Configurar Vitest com um teste trivial em `extensao/shared/`; verificar que `npm test` passa

## 2. Extensão carregável

- [x] 2.1 Criar `extensao/manifest.json` (MV3, `sidePanel` e `storage`, service worker como módulo, CSP sem `eval`) e um service worker que só configura a abertura do side panel pelo ícone; verificar que o manifesto é aceito pelo Chrome
- [x] 2.2 Criar `extensao/injected/observers.ts` vazio (apenas export de placeholder) e o script esbuild que gera o service worker (ESM) e o código injetado (IIFE); verificar que os dois arquivos são gerados em `dist/extensao/`
- [x] 2.3 Criar o script que copia manifesto, bundles e build do Angular para `dist/extensao/`, mais os comandos `npm run build` e `npm run watch`; verificar que `dist/extensao/` carrega em `chrome://extensions` sem erros e que o ícone abre o side panel
- [x] 2.4 Adicionar no side panel um botão que abre a rota de relatório em nova aba; verificar manualmente que a aba abre sem erros de console nem violações de CSP
- [x] 2.5 Criar o script pós-build que falha se os bundles do service worker ou do código injetado contiverem código do Angular, e ligá-lo ao `npm run build`; verificar que o build passa e que a checagem falha com um import forçado
- [x] 2.6 Configurar Playwright com Chromium e `--load-extension` e escrever o teste de integração: service worker registrado, painel renderiza pela URL direta, nenhuma página comum recebe script da extensão; verificar que `npm run test:integracao` passa

## 3. Página de teste

- [x] 3.1 Criar o servidor estático local na porta 4300 e o comando `npm run pagina-teste`; verificar que `http://localhost:4300` responde com o índice dos casos
- [x] 3.2 Implementar `/limpa` (abrir e fechar componente removendo listeners e nós); verificar com teste Playwright que 10 ciclos não aumentam a contagem de nós
- [x] 3.3 Implementar `/vazamento-listener` (listener global registrado a cada abertura e nunca removido); verificar com teste que um contador exposto pela página indica 10 listeners após 10 ciclos
- [x] 3.4 Implementar `/vazamento-dom` (nós removidos mantidos em array global); verificar com teste que o array tem os nós dos 10 ciclos e que eles não estão no documento
- [x] 3.5 Implementar `/cpu-pesada` (botão que chama `calculoPesado`, bloqueando mais de 200 ms); verificar com teste que a duração medida do clique passa de 200 ms
- [x] 3.6 Garantir `data-testid` único em todos os elementos interativos; verificar com teste que cada seletor encontra exatamente um elemento

## 4. Documentação e verificação final

- [x] 4.1 Atualizar `CLAUDE.md` com os comandos reais (build, watch, lint, testes, teste único, página de teste) e a estrutura de pastas; verificar que cada comando documentado roda como escrito
- [x] 4.2 Verificação de integração: a partir de um clone limpo, `npm install && npm run build && npm run lint && npm test && npm run test:integracao` passam, e a extensão carrega e abre o side panel
