# Sondagem — Extensão de performance web (Chrome) — Plano do projeto

> Documento de planejamento para desenvolvimento posterior. Itens marcados com **(a confirmar)** dependem de decisão do autor.

## 1. Objetivo

Criar uma extensão do Chrome (não é extensão de DevTools) para testar a performance de páginas web em desenvolvimento, com foco em:

- Detectar **vazamentos de memória** de forma comprovada, não apenas indicativa.
- Identificar **problemas de processamento** (long tasks, funções que consomem CPU, interações lentas).
- Apresentar os resultados de forma **mais legível** do que os painéis nativos do DevTools.
- Gerar medições **repetíveis e comparáveis** entre execuções e entre versões do build.

## 2. Escopo

### Dentro do escopo
- Execução de cenários definidos pelo usuário (ex.: abrir/fechar modal, navegar entre telas, preencher formulário) repetidos N vezes.
- Coleta de heap snapshots, contagem de nós DOM e listeners, long tasks, métricas de carregamento e de interação (LCP, CLS, INP).
- Perfil de CPU resumido por função.
- Controle de condições: throttling de CPU e rede, cache desligado e limpeza seletiva de cache entre execuções. O storage de autenticação é preservado (ver seção 3.2).
- Relatórios com tendência de memória e lista de objetos que mais cresceram.
- Exportação de resultados em JSON e CSV.

### Fora do escopo (por enquanto)
- Execução headless ou agendada (será tratada numa fase futura, possivelmente com Puppeteer/Playwright reaproveitando a lógica de CDP).
- Testes de carga com múltiplos usuários.
- Análise de performance em dispositivos reais.

## 3. Requisitos de robustez

- Cada cenário é executado **pelo menos 5 vezes** (valor padrão a confirmar), reportando mediana e p95.
- Antes de cada execução: limpeza seletiva de cache e recarga da página, sem apagar cookies nem storage de autenticação (ver seção 3.2).
- Configurações de throttling são **fixas e registradas** junto com o resultado.
- Cada resultado guarda: versão do build, URL, cenário, configuração, versão do navegador e data.
- Falhas no anexo do debugger ou perda de conexão são tratadas e reportadas, sem corromper o resultado.
- A extensão alerta quando outras extensões podem interferir e recomenda um perfil limpo.

## 3.1 Acionamento e detecção de DevTools

### Execução somente por comando explícito
- A análise **só começa** quando o usuário clica no botão "Analisar" no side panel.
- Nenhuma execução é iniciada automaticamente: nem ao carregar a página, nem ao abrir o navegador, nem por agendamento.
- Antes da execução, a interface mostra um resumo do cenário, a URL, as iterações e o throttling, e pede confirmação.
- Sem execução ativa, a extensão não anexa o debugger e não injeta observadores na página.
- Os observadores injetados são instalados no início da execução e removidos no fim, inclusive em caso de erro ou cancelamento.

### Notificação quando o DevTools já está aberto na página
- O Chrome não expõe uma API para saber se o DevTools está aberto em uma aba. A detecção, portanto, acontece na tentativa de anexar o debugger: se o DevTools já está anexado ao alvo, a chamada falha e a extensão identifica o caso.
- Ao receber essa falha, a extensão **não prossegue**, exibe uma mensagem clara no side panel dizendo que o DevTools está aberto na aba e orienta a fechá-lo ou a usar uma janela de teste dedicada.
- Opcionalmente, a mesma mensagem pode ser enviada como notificação do sistema (`chrome.notifications`), o que exige a permissão correspondente no manifesto.
- Não há tentativa de contornar o conflito, como fechar ou reabrir o DevTools automaticamente.

### Requisitos de teste
- Caso de teste: abrir o DevTools na aba de teste, clicar em "Analisar" e verificar que a mensagem aparece e nenhuma execução começa.
- Caso de teste: clicar em "Analisar" com o DevTools fechado e verificar que a execução segue normalmente.
- Caso de teste: nenhuma execução começa sem clique, após recarregar a página ou reiniciar o navegador.

## 3.2 Preservação da sessão de autenticação

### Regra padrão
- A extensão **nunca** apaga cookies, `localStorage`, `sessionStorage` nem IndexedDB por padrão. Apagar esses dados desloga o usuário e invalida o teste.
- A limpeza entre execuções fica restrita ao cache HTTP (`Network.clearBrowserCache` via CDP) e, se necessário, ao Cache Storage de service workers (`Storage.clearDataForOrigin` com `storageTypes: "cache_storage"`).
- O cache desligado durante a execução (`Network.setCacheDisabled`) não afeta a sessão.

### Limpeza explícita, quando necessária
- Só ocorre se o cenário declarar o campo `limpar_storage` com os tipos desejados (por exemplo, `"local_storage"`). Sem essa declaração, nada é apagado.
- Antes de qualquer limpeza, a interface mostra um aviso informando quais tipos de dados serão removidos e pede confirmação.
- Se o cenário precisar de estado limpo sem perder a sessão, ele deve usar passos da própria aplicação (por exemplo, "sair" e "entrar" pela interface), e não a limpeza do navegador.

### Recuperação de sessão expirada
- Se a aplicação redirecionar para a tela de login durante uma execução, o passo é marcado como falha de sessão, não de performance, e a execução para com mensagem clara.
- O login scriptado (passos `digitar` e `clicar` na tela de login) só é executado se o cenário o declarar. Credenciais não são salvas pela extensão nesta fase.

### Requisitos de teste
- Caso de teste: após uma execução completa, o usuário continua logado na aplicação.
- Caso de teste: a limpeza de cache não remove cookies nem `localStorage`.
- Caso de teste: um cenário com `limpar_storage` exibe o aviso e só apaga os tipos confirmados.

## 3.4 Modos de análise

A análise tem dois modos, escolhidos no botão "Analisar" antes de cada execução.

### Cenário declarativo (modo principal)
- O usuário escreve ou seleciona um cenário JSON, e a extensão executa os passos de ação e de medição.
- Repetível: as iterações são iguais entre execuções, o que permite comparar versões e confirmar vazamentos.
- Indicado para detecção de vazamento, regressões e comparação entre builds.

### Sessão manual (modo de diagnóstico)
- O usuário navega livremente na página, enquanto a extensão apenas observa e registra as medições escolhidas na seção 3.3.
- A extensão **não executa ações automáticas** nesse modo e não faz iterações.
- Não é repetível: duas sessões manuais nunca são idênticas. Por isso, os resultados não são usados para confirmar vazamento nem para comparar builds. Servem para investigar um problema observado na hora.
- Os resultados ficam marcados com o tipo de sessão e não entram na linha de base do cenário declarativo.
- **Início somente por clique:** a sessão só começa após o clique em "Analisar" e a confirmação do modo, das verificações escolhidas e da aba alvo. Nada inicia sozinho, nem ao carregar a página, nem ao reabrir o side panel.
- **Parada somente por comando:** a sessão termina apenas pelo botão "Parar" ou pelo fechamento explícito da sessão pelo usuário. Ela não para sozinha por inatividade, a menos que o usuário tenha configurado isso de forma explícita.
- **Remoção de todas as conexões ao término:** ao parar, a extensão deve:
  - desanexar o debugger (`chrome.debugger.detach`) e desfazer qualquer `Emulation`, `Network` ou `Profiler` ativado;
  - desconectar todos os `PerformanceObserver` e remover os listeners e hooks instalados na página;
  - encerrar as portas (`chrome.runtime.connect`) e os listeners de eventos de `chrome.debugger` e `chrome.tabs`;
  - cancelar temporizadores e promessas pendentes;
  - restaurar a aba ao estado normal, sem resíduos da análise.
- **Fechamento inesperado:** se a aba for fechada, ou se o service worker for suspenso no meio da sessão, a extensão executa a mesma limpeza na próxima oportunidade e registra a sessão como interrompida, sem perder os dados já coletados.
- **Confirmação de limpeza:** a interface mostra que a desconexão foi concluída, com a lista do que foi removido.

### Regras comuns aos dois modos
- Ambos respeitam a seleção de verificações (seção 3.3) e a preservação da sessão (seção 3.2).
- Ambos exigem o clique em "Analisar" e podem ser cancelados a qualquer momento.
- Ambos seguem a regra de DevTools aberto (seção 3.1).

### Requisitos de teste
- Caso de teste: uma sessão manual não executa cliques nem navegação automática.
- Caso de teste: resultados de sessão manual não aparecem como linha de base de cenário declarativo.
- Caso de teste: "Parar" desanexa o debugger e remove os observadores injetados.
- Caso de teste: recarregar a página ou reabrir o side panel não inicia nenhuma sessão.
- Caso de teste: ao parar, nenhuma porta, listener ou observador da sessão permanece ativo, verificado por inspeção de conexões abertas.
- Caso de teste: fechar a aba durante a sessão executa a limpeza completa e registra a sessão como interrompida.

## 3.3 Seleção das verificações

### Princípio
- Cada execução roda apenas as **verificações escolhidas pelo usuário**. Não há obrigação de executar tudo a cada vez.
- A escolha acontece na tela de confirmação do botão "Analisar" (seção 3.1), junto com o resumo do cenário.

### Verificações disponíveis
- **Memória:** `medir` leve por iteração e snapshots de início e fim, com `forcar_gc`.
- **DOM e listeners:** contagem de nós desanexados e de listeners acumulados.
- **Processamento:** long tasks e interações lentas (INP), associadas à iteração em que ocorreram.
- **CPU:** perfil resumido por função, via CDP (`Profiler`).
- **Carregamento:** métricas de carregamento e Web Vitals (LCP, CLS, FCP, TTFB).
- **Erros da página:** exceções JavaScript e promises rejeitadas.

### Regras de dependência
- Os passos de medição do cenário são filtrados conforme a seleção. Um `snapshot` ou `forcar_gc` só é executado se a verificação de memória estiver ativa. Os passos de ação (`clicar`, `esperar` etc.) são sempre executados, porque a ação é o que o cenário mede.
- Se o usuário desmarcar a verificação de memória, a interface avisa que o vazamento não será confirmado, sem bloquear a execução.
- Verificações que usam CDP (memória e CPU) exigem o debugger anexado. Se ele não puder ser anexado (seção 3.1), a execução não prossegue e o aviso indica quais verificações dependem disso.

### Memória da escolha
- A última seleção fica salva **por cenário** em `chrome.storage`, para que o usuário não precise marcar tudo de novo.
- Essa preferência não contém dados de autenticação e não afeta a sessão (seção 3.2).

### Requisitos de teste
- Caso de teste: executar com apenas "Carregamento" ativo não cria snapshots nem chama `forcar_gc`.
- Caso de teste: desmarcar "Memória" mostra o aviso sobre vazamento não confirmado.
- Caso de teste: a seleção salva é restaurada na próxima abertura do mesmo cenário.

## 3.5 Requisitos de performance da própria extensão

### Princípio
- A medição nunca depende da interface. O código que mede roda separado do código que exibe, e a exibição não pode interferir no que está sendo medido.

### Separação de responsabilidades
- **Medição:** TypeScript puro, sem Angular, no service worker e no código injetado na página. O código injetado nunca carrega o Angular, para não alterar a página testada.
- **Interface (side panel e relatório):** Angular, usado só para exibir status, controles e resultados.

### Durante a execução
- A interface mostra apenas o status (por exemplo, "iteração 7 de 20"), com atualização no máximo a cada segundo.
- Gráficos detalhados e listas grandes são carregados somente ao final da execução ou ao abrir o relatório.
- Eventos de `PerformanceObserver` e long tasks são agregados na medição e enviados à interface em lotes, não um a um.

### Desempenho da interface
- Componentes com `ChangeDetectionStrategy.OnPush` e signals, para reduzir a detecção de mudanças.
- Virtual scroll nas listas de objetos retidos, long tasks e requisições.
- Build de produção do Angular em todos os ambientes da extensão, com CSP estrita e sem `eval`.

### Dados da medição
- O heap snapshot bruto não é mantido em memória nem armazenado integralmente. A extensão guarda um resumo com contagem por construtor, tamanho retido e os objetos mais relevantes para a comparação.
- Limite de tamanho por execução e por histórico, com aviso antes de atingir o limite.
- Os resumos são salvos em IndexedDB, com política de retenção definida pelo usuário.

### Requisitos de teste
- Caso de teste: com a interface aberta e atualizando, a variação de long tasks da página testada fica dentro de um limite definido em relação à execução com a interface fechada.
- Caso de teste: nenhum código do Angular aparece no contexto da página testada.
- Caso de teste: abrir um relatório com um snapshot grande não trava o side panel.

## 4. Arquitetura proposta

```
extensao/
  manifest.json            # MV3, permissões: debugger, tabs, scripting, storage, sidePanel
  background/
    service-worker.ts      # orquestra execuções, anexa debugger, coleta dados
    cdp.ts                 # wrapper de chrome.debugger (attach, send, detach, eventos)
    scenarios.ts           # execução de cenários (passos definidos pelo usuário)
  injected/
    observers.ts           # PerformanceObserver, long tasks, contagem de nós/listeners
  ui/                      # Angular (a confirmar)
    side-panel/            # controle: escolher cenário, iniciar, acompanhar
    report/                # relatório: gráficos de memória, long tasks, comparações
  shared/
    types.ts               # modelos de resultado (Run, Snapshot, Metric)
    stats.ts               # mediana, p75, p95
  storage/
    repository.ts          # chrome.storage / IndexedDB para execuções
```

### Decisões técnicas
- **Debugger (CDP)** para snapshots, GC forçado, throttling e perfis de CPU.
- **chrome.scripting** para injetar observadores na página.
- **Side Panel** como interface principal de controle; página de relatório separada.
- **Angular** para a interface, com build estático copiado para a pasta da extensão (`--base-href ./`). Confirmar se o autor quer Angular ou outra abordagem.
- **Sem dev server** na extensão: desenvolvimento com `ng build --watch` e recarga manual em `chrome://extensions`.

## 4.1 Especificação do cenário declarativo

### Essencial (fase 2)
- **Metadados:** nome, descrição, URL inicial e versão do esquema.
- **Estado inicial:** sessão já autenticada, preservada entre execuções. Login scriptado só é usado quando a sessão expira, e o cenário declara explicitamente quais tipos de storage limpar, se houver algum.
- **Aquecimento (`aquecimento`):** passos executados antes das iterações, sem medições, e excluídos dos resultados.
- **Passos de ação:** `navegar`, `clicar`, `digitar`, `esperar` (tempo ou seletor), `rolar`, `aguardar_inatividade`.
- **Passo de repetição (`repetir`):** agrupa os passos de uma iteração. O campo `vezes` aceita um número ou a referência `"iteracoes"`, que vem do cenário ou da execução.
- **Passos de medição em dois níveis:**
  - `medir` leve, em cada iteração: heap usado, nós DOM e listeners.
  - `snapshot` pesado, apenas no início e no fim, com `rotulo` único.
- **Passo `forcar_gc`:** executado duas vezes em sequência, porque uma única coleta nem sempre libera tudo.
- **Tempo limite e erro por passo:** campos `tempo_limite_ms` e `em_erro`, com os valores `interromper`, `pular` ou `repetir`. O padrão é `interromper`, porque pular um passo sem aviso invalida a iteração.
- **Parâmetros de execução:** iterações e throttling definidos no cenário, com possibilidade de sobrescrever na execução. Se o usuário não informar, valem os padrões do cenário.
- **Validação:** JSON Schema verificado antes de rodar, com mensagens que apontem o campo e a posição. Regras mínimas:
  - `vezes` maior que zero.
  - `seletor` obrigatório em `clicar` e `digitar`.
  - `rotulo` único entre os snapshots.
  - `em_erro` restrito aos três valores permitidos.
- **Cancelamento:** interrupção a qualquer momento, com desanexação garantida do debugger e limpeza da janela de teste.

### Exemplo de cenário

```json
{
  "versao_esquema": 1,
  "nome": "abrir-fechar-modal",
  "url_inicial": "http://localhost:4200/produtos",
  "execucao": { "iteracoes": 20, "throttling": "padrao" },
  "aquecimento": [
    { "tipo": "clicar", "seletor": "[data-testid='abrir-modal']" },
    { "tipo": "clicar", "seletor": "[data-testid='fechar-modal']" }
  ],
  "passos": [
    { "tipo": "forcar_gc" },
    { "tipo": "forcar_gc" },
    { "tipo": "snapshot", "rotulo": "inicio" },
    {
      "tipo": "repetir",
      "vezes": "iteracoes",
      "passos": [
        { "tipo": "clicar", "seletor": "[data-testid='abrir-modal']", "tempo_limite_ms": 5000, "em_erro": "interromper" },
        { "tipo": "esperar", "seletor": "[data-testid='modal']" },
        { "tipo": "clicar", "seletor": "[data-testid='fechar-modal']" },
        { "tipo": "aguardar_inatividade", "ms": 300 },
        { "tipo": "forcar_gc" },
        { "tipo": "forcar_gc" },
        { "tipo": "medir", "metricas": ["heap_usado", "nos_dom", "listeners"] }
      ]
    },
    { "tipo": "forcar_gc" },
    { "tipo": "forcar_gc" },
    { "tipo": "snapshot", "rotulo": "fim" }
  ]
}
```

### Infraestrutura complementar para a fase 2
- **Máquina de estados do runner:** ociosa, preparando, aquecendo, executando, coletando, concluída, erro e cancelada.
- **Captura de erros da página:** exceções JavaScript e promises rejeitadas, via `Runtime` no CDP, associadas à iteração em que ocorreram.
- **Ambiente registrado:** tamanho da janela, DPR, versão do navegador e user agent, salvos com cada resultado.
- **Histórico e linha de base:** comparação da execução atual com uma referência escolhida pelo usuário, com limite definido por ele.
- **Testes da própria ferramenta:** unitários para estatísticas (mediana, p75, p95) e para a validação do JSON, mais um teste de integração com a página de teste da seção 8.

### Posterior
- Múltiplas abas ou popups.
- Mock de requisições de rede.
- Exportação e importação de cenários.
- Documentação completa do formato, com exemplos.

## 5. Fluxo de detecção de vazamento (núcleo do produto)

1. Abrir a aba de teste em uma janela dedicada (DevTools deve estar fechado nela).
2. Anexar o debugger e aplicar as condições de teste.
3. Executar o cenário de aquecimento (1 vez) para estabilizar caches e lazy loading.
4. Forçar GC e tirar **snapshot inicial**.
5. Repetir o cenário N vezes, forçando GC ao final de cada iteração.
6. Tirar **snapshot final**.
7. Comparar snapshots: objetos retidos, tamanho retido e crescimento por construtor.
8. Contar nós DOM desanexados e listeners acumulados.
9. Gerar relatório com tendência por iteração e os principais candidatos a vazamento.

Um vazamento é considerado **provável** quando a memória retida cresce de forma consistente ao longo das iterações. Confirmação depende de análise humana dos objetos listados.

## 6. Modo ao vivo (opcional, fase posterior)

Versão leve que acompanha a sessão normal de uso, sem controlar a execução:

- Timeline de memória, long tasks e INP no mesmo eixo de tempo.
- Marcação de qual interação disparou cada long task.
- Não depende de CDP quando possível, para não conflitar com o DevTools.

## 7. Fases sugeridas

| Fase | Entrega | Critério de conclusão |
|---|---|---|
| 0. Setup | Projeto Angular, manifest, service worker e página de controle vazios; build copiado para a extensão | Extensão carrega sem erros e abre o side panel |
| 1. Métricas básicas | Injeção de observadores, long tasks e Web Vitals em um cenário simples | Resultados aparecem no side panel para uma página de teste |
| 2. Cenários | Gravação/execução de passos repetidos com N iterações | Mesmo cenário produz resultados consistentes em 3 execuções |
| 3. Memória | Heap snapshots, GC forçado, comparação e tendência | Vazamento intencional de teste é detectado |
| 4. CPU | Perfil de CPU resumido por função | Função artificialmente pesada aparece no topo do resumo |
| 5. Robustez | Throttling, limpeza de estado, tratamento de erros, persistência | Testes repetidos têm variação dentro de limite definido |
| 6. Relatórios | Gráficos, comparação entre execuções, exportação JSON/CSV | Relatório permite comparar duas versões do build |
| 7. Modo ao vivo | Timeline simples de métricas durante uso normal | Opcional, após as fases anteriores |

## 8. Página de teste para validação

Criar uma página de teste dedicada com problemas conhecidos e controlados:

- Listener que nunca é removido ao fechar um componente.
- Nós DOM mantidos em um array global após remoção.
- Função com loop pesado disparada por clique.
- Página "limpa" como controle, para garantir que não há falsos positivos.

Essa página serve como critério de aceitação de cada fase de detecção.

## 9. Riscos e limitações conhecidas

- **Conflito de debugger** se o DevTools estiver aberto na aba de teste. Mitigação: janela dedicada e aviso na interface.
- **Barra de aviso do Chrome** durante o uso do debugger. Aceitável para desenvolvimento.
- **Suspensão do service worker** (MV3). Mitigação: estado em `chrome.storage` e tratamento de `onDetach`.
- **Interferência de outras extensões.** Mitigação: recomendação de perfil limpo.
- **Ruído de medição.** Mitigação: múltiplas iterações, mediana e p95.
- **Execução acidental ou sem intenção do usuário.** Mitigação: execução somente por clique em "Analisar", com confirmação e sem gatilhos automáticos (seção 3.1).
- **DevTools aberto na aba de teste.** A detecção ocorre na falha de anexação do debugger, e a execução é interrompida com aviso (seção 3.1).
- **Perda de sessão durante ou entre execuções.** Mitigação: nenhuma limpeza de cookies ou storage por padrão, e detecção de redirecionamento para o login (seção 3.2).
- **Falsos positivos de vazamento** por caches legítimos da aplicação. Mitigação: aquecimento e análise humana dos objetos listados.
- **Forçar GC não é determinístico** em todos os casos. Mitigação: várias coletas antes do snapshot.

## 10. Questões em aberto

### Decisões confirmadas
- **Interface em Angular.** Confirmado.
- **Uso interno apenas**, sem distribuição pela Chrome Web Store.
- **Sem execução em CI** nesta fase.

### Parâmetros com valor padrão e opção de personalização
- Número de iterações por cenário: valor padrão a definir; o usuário pode informar outro valor.
- Perfis de throttling (CPU e rede): valores padrão a definir; o usuário pode informar valores personalizados.

### Formato dos cenários: declarativo
- Cada cenário é um arquivo JSON com a lista de passos, versionável e editável à mão.
- Passos previstos: `navegar`, `clicar`, `digitar`, `esperar` (tempo ou seletor), `rolar`, `aguardar_inatividade`. Lista a confirmar na fase 2.
- Seletores preferidos: atributos estáveis como `data-testid`.
- Gravação e cenários em código ficam como possibilidades futuras, fora da fase inicial.

## 11. Próximos passos imediatos

1. Definir os valores padrão de iterações e throttling.
2. Definir o esquema do JSON de cenário (campos e tipos de cada passo).
3. Criar a página de teste com os problemas controlados (seção 8).
4. Executar a fase 0 (setup) e validar o carregamento da extensão.
