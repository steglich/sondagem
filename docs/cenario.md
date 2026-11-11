# Formato do cenário (esquema versão 1)

Um cenário é um arquivo JSON, versionável e editável à mão, que descreve os passos de uma análise repetível. O esquema completo está em [`extensao/shared/cenario.schema.json`](../extensao/shared/cenario.schema.json). A extensão valida o cenário ao carregar e antes de executar: um cenário inválido não roda nenhum passo, e cada erro aponta o campo pelo caminho (por exemplo, `/passos/3/passos/0/seletor`).

## Exemplo

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

## Campos do cenário

| Campo | Obrigatório | Descrição |
|---|---|---|
| `versao_esquema` | sim | Sempre `1`. Outra versão é rejeitada com a lista das suportadas. |
| `nome` | sim | Identifica o cenário na extensão. Salvar outro cenário com o mesmo nome substitui o anterior. |
| `url_inicial` | sim | Página aberta em carga nova no início da execução. Precisa ser `http://` ou `https://`. |
| `passos` | sim | Lista de passos, com ao menos um. |
| `descricao` | não | Texto livre. |
| `execucao.iteracoes` | não | Inteiro maior que zero. Sem ele vale o padrão de 5. O valor informado na confirmação tem prioridade. |
| `execucao.throttling` | não | Nome de um perfil (`"padrao"`) ou um objeto `{ "cpu": 4, "rede": { "latencia_ms", "download_kbps", "upload_kbps" } }`. Nesta fase é só registrado no resultado; passa a ser aplicado na fase 5. |
| `aquecimento` | não | Passos de ação executados uma vez antes dos `passos`. O que acontece neles não entra no resultado. |
| `sessao.url_login` | não | URL da tela de login da aplicação. Reservado para a fase 5. |
| `limpar_storage` | não | Tipos de storage a limpar: `cookies`, `local_storage`, `session_storage`, `indexeddb`, `cache_storage`. Reservado para a fase 5; sem o campo nada é apagado. |

## Passos

Todo passo tem `tipo`. Os passos de ação e de medição aceitam também:

- `tempo_limite_ms`: tempo limite do passo. Padrão: 10000.
- `em_erro`: o que fazer se o passo falhar. `interromper` (padrão) encerra a execução; `pular` segue para o próximo passo e marca a iteração como incompleta, fora das estatísticas; `repetir` tenta de novo até 2 vezes e, se o erro persistir, interrompe.

### Passos de ação

Sempre executados, na ordem declarada, como entrada real do usuário (os eventos chegam à página com `isTrusted` verdadeiro e contam para o INP).

| Tipo | Campos | Comportamento |
|---|---|---|
| `navegar` | `url` | Abre a URL (absoluta ou relativa à `url_inicial`) e espera o evento de carregamento. |
| `clicar` | `seletor` | Espera o elemento existir, rola até ele e clica no centro. Falha se outro elemento estiver por cima. |
| `digitar` | `seletor`, `texto`, `limpar` (opcional) | Foca o elemento e insere o texto. Com `"limpar": true`, substitui o conteúdo atual. |
| `esperar` | `ms` **ou** `seletor` | Espera o tempo dado, ou até o elemento existir na página. |
| `rolar` | `x` e/ou `y`, `seletor` (opcional) | Gira a roda do mouse em pixels, sobre o elemento ou sobre o centro da janela. |
| `aguardar_inatividade` | `ms` (opcional, padrão 500) | Conclui quando passam `ms` milissegundos sem requisições de rede em andamento e sem long tasks. |

Prefira seletores estáveis, como `[data-testid='...']`.

### Repetição

`repetir` agrupa os passos de uma iteração:

```json
{ "tipo": "repetir", "vezes": "iteracoes", "passos": [ ... ] }
```

`vezes` é um inteiro maior que zero ou a referência `"iteracoes"`, que resolve para o número de iterações da execução (confirmação → `execucao.iteracoes` → 5). Cada volta de um `repetir` do nível principal é uma iteração numerada: long tasks, interações e erros da página ficam associados à iteração em que ocorreram. Um `repetir` dentro de outro é só um laço.

### Passos de medição

| Tipo | Campos | Observação |
|---|---|---|
| `medir` | `metricas`: lista com `heap_usado`, `nos_dom`, `listeners` | Leve, em cada iteração. |
| `snapshot` | `rotulo`, único entre os snapshots | Pesado, no início e no fim. |
| `forcar_gc` | — | Costuma aparecer duas vezes seguidas, porque uma coleta nem sempre libera tudo. |

Os passos de medição só rodam se a verificação correspondente estiver marcada. Eles dependem da verificação de memória, que chega na fase 3: até lá são aceitos pelo esquema e ignorados na execução.

## Regras de validação

- `seletor` é obrigatório em `clicar` e `digitar`.
- `vezes` maior que zero, ou `"iteracoes"`.
- `rotulo` único entre os snapshots; o erro aponta os dois passos.
- `em_erro` restrito a `interromper`, `pular` e `repetir`.
- Campos desconhecidos e tipos de passo fora da lista são rejeitados.
- JSON malformado é rejeitado com a linha e a coluna do erro.
