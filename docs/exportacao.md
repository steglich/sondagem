# Exportação de resultados

O relatório de uma execução (`#/relatorio/<id>`) exporta em JSON e em CSV; a tela de comparação exporta em CSV. Os arquivos são gerados na própria página e baixados pelo navegador. Não existe importação.

## Nome dos arquivos

```
sondagem_<cenário>_<build>_<AAAA-MM-DD_HHMM>.json
sondagem_<cenário>_<build>_<AAAA-MM-DD_HHMM>.csv
sondagem_comparacao_<cenário>_<build A>_vs_<build B>_<AAAA-MM-DD_HHMM>.csv
```

- `<cenário>` é o nome do cenário, ou `sessao-manual`.
- `<build>` é a versão do build informada na confirmação; sem ela, a parte some. Na comparação, o lado sem build usa a data da execução.
- A data é o início da execução, no fuso do navegador (na comparação, a da execução B).
- Acentos são removidos e o que não é letra, número, ponto, hífen ou sublinhado vira hífen.

Exemplo: `sondagem_abrir-fechar-modal_1.5.0_2026-11-12_0905.json`.

## JSON

Tudo o que está armazenado da execução, mais a versão do formato do arquivo.

| Campo | Conteúdo |
|---|---|
| `versao_exportacao` | Versão do formato deste arquivo. Hoje, `1`. |
| `execucao` | O registro da execução: metadados, condições, ambiente e estatísticas. |
| `detalhes` | As listas detalhadas. |

### `execucao`

| Campo | Conteúdo |
|---|---|
| `id` | Identificador da execução no histórico. |
| `versaoFormato` | Versão do formato em que o registro foi gravado. |
| `tipo` | `cenario` ou `sessao-manual`. |
| `estado` | `concluida`, `cancelada`, `interrompida` ou `erro`. |
| `grupo` | `cenario:<nome>` ou `manual`. |
| `nomeCenario` | Nome do cenário; `null` em sessão manual. |
| `url` | URL analisada. |
| `inicio`, `fim` | Em ms desde a época. |
| `selecao` | Verificações marcadas. |
| `versaoBuild` | Versão do build informada pelo usuário, ou `null`. |
| `navegador` | Versão e user agent. |
| `ambiente` | Versão do navegador, tamanho da janela e densidade de pixels; `null` em sessão manual. |
| `condicoes` | Condições de teste que valeram, em números: perfil, fator de CPU, rede, cache e storage apagado. |
| `chaveCondicoes` | As condições em texto, usadas para achar execuções comparáveis. |
| `extensoes` | Outras extensões ativas durante a análise. |
| `definicao` | O cenário executado, com `***` no lugar do que é digitado nos passos de login. |
| `configuracao` | O que valeu na execução: nome, URL inicial, iterações, throttling e versão do build. |
| `andamento` | Sempre `null` em execução terminada. |
| `resumo` | O resultado sem as listas: desfecho, limpeza, estatísticas por métrica (`cenario.estatisticas`, com mediana, p75 e p95), iterações e análise de memória. |
| `tamanho` | Tamanho estimado no histórico, em bytes. |
| `truncado` | Listas que não foram guardadas por causa do limite de armazenamento. |

### `detalhes`

| Campo | Conteúdo |
|---|---|
| `longTasks` | Início, duração e iteração de cada long task. |
| `interacoes` | Início, duração, tipo de evento, elemento e iteração de cada interação. |
| `documentos` | Cada carregamento observado, com as métricas (LCP, FCP, CLS, TTFB, INP). |
| `errosPagina` | Exceções e promises rejeitadas, com a origem e a iteração. |
| `medicoes` | Heap usado, nós DOM e listeners em cada medição. |
| `snapshots` | Censos de objetos por construtor. |
| `pausasDeMedicao` | Intervalos em que a página ficou parada por um censo. |
| `contadoresDom` | Contadores no início e no fim da análise. |
| `cpu` | Resumo do perfil de CPU: categorias e funções. |

Uma lista que aparece em `execucao.truncado` vem vazia em `detalhes`.

## CSV das medições por iteração

Uma linha por iteração do cenário (sessão manual não tem iterações, e por isso não tem este arquivo). As duas primeiras colunas existem sempre; as outras, só quando a verificação correspondente rodou.

| Coluna | Presente quando |
|---|---|
| `Iteração` | sempre |
| `Completa` | sempre (`sim` ou `não`) |
| `Duração da iteração (ms)` | sempre |
| `Tempo em long tasks (ms)` | "Processamento" |
| `Long tasks (quantidade)` | "Processamento" |
| `Pior interação (ms)` | "Processamento" |
| `Interações (quantidade)` | "Processamento" |
| `Heap usado (bytes)` | o cenário mede `heap_usado` |
| `Nós DOM (quantidade)` | o cenário mede `nos_dom` |
| `Listeners (quantidade)` | o cenário mede `listeners` |
| `Erros da página (quantidade)` | "Erros da página" |

Um campo vazio significa "sem dado": a iteração não teve interação, não foi medida, ou a lista foi truncada. Long tasks causadas pela própria medição (censo de objetos) não entram, como nas estatísticas.

## CSV da comparação

Uma linha por métrica. Os valores são as medianas entre as iterações; a diferença é de B em relação a A.

| Coluna | Conteúdo |
|---|---|
| `Métrica` | Nome da métrica. |
| `Unidade` | Unidade dos valores. |
| `A (build <versão>)` | Valor na execução A, a referência. Sem build informado, só `A`. |
| `B (build <versão>)` | Valor na execução B. |
| `Diferença` | B − A. Vazio se faltar um dos lados. |
| `Diferença (%)` | Diferença sobre A. Vazio se faltar um dos lados ou se A for zero. |

## Regras do CSV

- Codificação UTF-8 com BOM, para as planilhas reconhecerem os acentos.
- Linhas terminadas em CRLF; a primeira é o cabeçalho.
- Escape da RFC 4180: campo com separador, aspas ou quebra de linha vai entre aspas, e as aspas de dentro são dobradas.
- Separador vírgula e ponto decimal, por padrão. A tela oferece ponto e vírgula, e nesse caso os números usam vírgula decimal, que é o que as planilhas em português esperam.
- Números com no máximo 3 casas decimais.

## Dados sensíveis

Os arquivos não contêm o que é digitado nos passos de login: o cenário já é guardado no histórico com `***` nesses textos, e a exportação não tem outra fonte. A extensão não lê nem guarda cookies, tokens ou conteúdo de storage da aplicação analisada. As URLs visitadas aparecem como foram carregadas.
