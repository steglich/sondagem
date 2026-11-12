# Design

## Context

Depende da fase 2 (runner e CDP); integra os dados das fases 3 e 4. Até aqui os resultados vivem em `chrome.storage.session`, o throttling do cenário é só registrado e não há limpeza de cache. O esquema do cenário já aceita `execucao.throttling`, `sessao.url_login` e `limpar_storage` desde a fase 2. Esta fase acrescenta dois campos opcionais, sem mudar a versão do esquema: `sessao.passos_login` (exigido pela task 2.3) e `execucao.manter_cache` (a forma de o cenário "declarar o contrário" do cache desligado). Cenários antigos continuam válidos.

## Goals / Non-Goals

**Goals:**
- Etapa de "preparação" do runner que aplica as condições e uma etapa de "restauração" que sempre as desfaz.
- Repositório único de resultados sobre IndexedDB, usado pela fase 6.
- Nenhum caminho de código que apague cookies ou storage sem passar pela confirmação.

**Non-Goals:**
- Notificações do sistema (`chrome.notifications`): o aviso fica no side panel.
- Armazenar credenciais ou renovar a sessão automaticamente.
- Execução em janela ou perfil criado pela extensão.
- Migrar resultados antigos de `chrome.storage.session`.

## Decisions

### Condições como lista de efeitos reversíveis
Cada condição é um par aplicar/desfazer: `Emulation.setCPUThrottlingRate`, `Network.emulateNetworkConditions`, `Network.setCacheDisabled`. A preparação aplica na ordem e empilha os "desfazer"; a restauração desempilha em `finally`. É o mesmo padrão do registro de limpeza da fase 1.

### Perfis de throttling
- `nenhum`: sem limitação.
- `padrao`: CPU 4x; rede com 150 ms de latência, 1,6 Mbps de download e 750 kbps de upload (equivalente ao "Slow 4G" do Lighthouse).
- Personalizados: salvos em `chrome.storage.local` pelo usuário e referenciados pelo nome, ou declarados inline no cenário.

### Limpeza restrita por construção
A limpeza padrão usa só `Network.clearBrowserCache` e `Storage.clearDataForOrigin` com `storageTypes: "cache_storage"`. A função de limpeza de storage aceita apenas uma lista de tipos já confirmada, representada por um tipo próprio que só a tela de confirmação consegue produzir. Assim o runner não consegue chamar a limpeza com tipos não confirmados. Um teste garante que `cookies` nunca aparece na chamada padrão.

Como a confirmação acontece na interface e a limpeza no service worker, o tipo próprio (`TiposConfirmados`) não atravessa a mensagem: a tela envia os tipos que o usuário marcou (`storageConfirmado`), e o service worker só constrói o `TiposConfirmados` se essa lista cobrir tudo o que o cenário declara; caso contrário recusa o início.

`localStorage` e `sessionStorage` não saem por `Storage.clearDataForOrigin`: medido no Chromium dos testes de integração, o tipo `local_storage` apaga também o `sessionStorage` da aba, que o usuário não confirmou. Os dois são limpos na página da origem (`localStorage.clear()` / `sessionStorage.clear()` por `Runtime.evaluate`, só se `location.origin` for a do cenário), seguidos de carga nova. `cookies` e `indexeddb` continuam pelo domínio `Storage`; um teste de integração confere que cada tipo apaga só o próprio.

### Detecção de sessão expirada por URL
O cenário declara `sessao.url_login` (prefixo ou padrão com `*`). O runner observa `Page.frameNavigated` do frame principal; se a URL casar com o padrão fora de passos de login declarados, a execução para com o estado "erro" e o motivo "falha de sessão". Sem `url_login`, a detecção fica desligada e isso é informado na confirmação. Aplicações de página única vão ao login sem trocar de documento, então `Page.navigatedWithinDocument` do quadro principal também é observado. Alternativa descartada: heurística por campos de senha na página, sujeita a falso positivo.

### Login declarado e valores digitados
Passos de login ficam em `sessao.passos_login` e exigem `url_login`. Rodam uma vez, na preparação, e só se a carga da URL inicial cair na tela de login; depois deles a URL inicial é aberta de novo. Sessão que expira no meio da execução é sempre falha de sessão: o login não é refeito. Os valores de `digitar` desses passos são mascarados em qualquer registro de resultado ou log. A extensão não guarda credenciais além do que está no próprio arquivo de cenário, sob responsabilidade do usuário.

### IndexedDB com `idb`
Banco `sondagem`, com os object stores `execucoes` (metadados e estatísticas, índices por cenário e por data) e `detalhes` (listas grandes e resumos de snapshot e CPU, por id de execução). Separar os dois permite listar o histórico sem carregar os detalhes. O repositório em `storage/repository.ts` é a única porta de acesso. Preferências e cenários continuam em `chrome.storage.local`. O estado da sessão em andamento continua em `chrome.storage.session` (é o que deixa uma sessão manual sobreviver à suspensão do service worker), mas sem o resultado: fica só o `idResultado`, e o resultado é relido do repositório.

### Gravação incremental e recuperação
Ao iniciar, a execução é criada no banco com o estado "em andamento". Ao fim de cada iteração, os dados agregados são gravados. Ao acordar, o service worker procura execuções "em andamento" sem runner ativo: executa a limpeza (desanexar, remover scripts registrados), muda o estado para "interrompida" e mantém o que já foi gravado.

### Limites e retenção
Padrões: 20 MB por execução, 500 MB de histórico, aviso em 80%, retenção de 50 execuções por cenário. Todos configuráveis. O tamanho é estimado pelo JSON serializado no momento da gravação. O truncamento remove primeiro as listas detalhadas (long tasks, interações), nunca as estatísticas.

### Outras extensões por `chrome.management`
`chrome.management.getAll()` filtra extensões ativas diferentes da própria. Exige a permissão `management`. Alternativa descartada: inferir pela presença de scripts de extensões na página, incompleto.

### Variação e impacto da extensão
Coeficiente de variação por métrica entre as execuções completas do mesmo cenário e das mesmas condições, com limite padrão de 10%. O teste de impacto roda o mesmo cenário com o painel aberto e fechado na página de teste e compara o tempo total de long tasks por iteração, com limite padrão de 5%.

**Valor medido** (`testes/medicao/estabilidade.spec.ts`, cenário `cpu-pesada`, 8 iterações, 3 rodadas alternadas de cada lado, Chromium do Playwright em WSL2, 2026-11-12): mediana de 300,0 ms de long tasks por iteração com o painel aberto e 300,0 ms com ele fechado, diferença de 0,00%, igual em três execuções do teste. Ressalva: o bloqueio de `/cpu-pesada` dura um tempo fixo (300 ms), então o teste acusa long tasks a mais ou alongadas pela extensão, mas não mede lentidão dentro do próprio bloqueio.

**Variação medida** (mesmo arquivo, `abrir-fechar` com `padrao`, 3 execuções de 5 iterações, mesma máquina): coeficiente de variação de 0,5% e 1,3% na duração da iteração em duas rodadas com a máquina sem outra carga (média de 393 ms), e 3,9% com outros cinco testes em paralelo; o tempo em long tasks foi zero nas três, sem variação a calcular. Com a suíte de integração inteira rodando em paralelo na mesma máquina, a mesma medição deu 13%, acima do limite: por isso estes dois testes ficam no projeto `medicao` do Playwright, que roda depois dos outros e em série. O número vale como indicação de que execuções só são comparáveis com a máquina sem outra carga.

### Suposições registradas
- Valores do perfil `padrao`, dos limites de armazenamento, da retenção, da variação (10%) e do impacto (5%) são padrões propostos; o plano os deixa a definir.

## Risks / Trade-offs

- [`Storage.clearDataForOrigin` com tipo errado apaga a sessão] → Tipo confirmado obrigatório e teste que inspeciona os parâmetros enviados.
- [Service worker encerrado entre gravações perde a iteração corrente] → Perda limitada a uma iteração; o resultado fica como interrompido.
- [`management` é uma permissão sensível] → Uso interno; só leitura de nome e estado.
- [Throttling de rede não cobre WebSocket nem service workers da página em todos os casos] → Limitação documentada no resultado.
- [Estimativa de tamanho por JSON é imprecisa] → Margem de segurança no aviso de 80%.
