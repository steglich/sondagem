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

- `tempo_limite_ms`: tempo limite do passo. Padrão: 10000 (120000 no passo `snapshot`).
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

| Tipo | Campos | O que faz |
|---|---|---|
| `medir` | `metricas`: lista com `heap_usado`, `nos_dom`, `listeners` | Registra, na iteração corrente, o heap de JavaScript em uso (bytes), o número de nós DOM e o de listeners. Leve: use em toda iteração. |
| `snapshot` | `rotulo`, único entre os snapshots | Faz um censo: quantos objetos vivos a página tem de cada construtor. Mais pesado: use no início e no fim. |
| `forcar_gc` | — | Força uma coleta de lixo completa e espera terminar. Costuma aparecer duas vezes seguidas, porque uma coleta nem sempre libera tudo. |

Os três só rodam com a verificação "Memória" marcada. Com ela desmarcada são ignorados (os passos de ação rodam normalmente) e a confirmação avisa que um vazamento não será confirmado.

#### O que o resultado traz

- **Série por iteração**: o valor de cada métrica na última medição de cada iteração completa, e o crescimento médio por iteração. Para a série fazer sentido, ponha `forcar_gc` (duas vezes) antes do `medir`, como no exemplo.
- **Classificação**: "vazamento provável" se o heap, os nós DOM ou os listeners subirem em pelo menos 80% das transições entre iterações consecutivas e acima de um mínimo no total (100 KB de heap; 3 nós ou listeners). "Sem indício de vazamento" caso contrário. Com menos de 5 iterações completas, "dados insuficientes". É um indício: a confirmação depende de analisar os objetos.
- **Construtores que mais cresceram**: a diferença de contagem entre o primeiro e o último `snapshot` da execução, do que mais ganhou objetos para o que mais perdeu.

#### Limites do censo

O `snapshot` não é um heap snapshot do DevTools: o navegador não oferece o heap profiler a extensões. O censo traz só a **contagem** de objetos por construtor, sem tamanho próprio nem tamanho retido, e sem o caminho de retenção. Para isso, compare heap snapshots no DevTools, guiado pelos construtores que a Sondagem apontou.

- Conta os objetos JavaScript vivos do mundo principal da página. Objetos criados com `Object.create(null)` ficam de fora.
- Um nó DOM entra na contagem (como `HTMLLIElement`, por exemplo) se a página o criou ou tocou por script.
- Classes com o mesmo nome em módulos diferentes são somadas; classes sem nome aparecem como "(anônimo)".
- O resumo guarda os 500 construtores com mais objetos e soma o resto em "(outros)".
- A contagem roda na página e lê `constructor.name` de cada objeto, o que pode acionar um getter da aplicação. Nada é escrito na página.

#### "DOM e listeners"

A verificação "DOM e listeners" não depende de passos do cenário: com ela marcada, a extensão conta os nós DOM desanexados (fora do documento, mas ainda na memória) e os listeners depois do aquecimento e no fim da execução, sempre depois de uma coleta de lixo, e reporta a variação.

## Regras de validação

- `seletor` é obrigatório em `clicar` e `digitar`.
- `vezes` maior que zero, ou `"iteracoes"`.
- `rotulo` único entre os snapshots; o erro aponta os dois passos.
- `em_erro` restrito a `interromper`, `pular` e `repetir`.
- Campos desconhecidos e tipos de passo fora da lista são rejeitados.
- JSON malformado é rejeitado com a linha e a coluna do erro.
