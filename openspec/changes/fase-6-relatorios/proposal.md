# Proposal

## Why

O objetivo declarado do produto é apresentar resultados de forma mais legível do que o DevTools e permitir comparar versões do build (plano, seções 1, 2 e 7). Com os resultados persistidos (fase 5), falta a página de relatório: gráficos, comparação entre execuções, linha de base e exportação.

## What Changes

- Página de relatório por execução: resumo, tendência de memória, long tasks e interações por iteração, objetos que mais cresceram, resumo de CPU e erros da página.
- Comparação entre duas execuções do mesmo cenário, com as diferenças por métrica.
- Linha de base por cenário, escolhida pelo usuário, com limite de regressão definido por ele.
- Exportação de resultados em JSON e CSV.
- Listas grandes com rolagem virtual e gráficos carregados sob demanda, para o relatório não travar.

## Capabilities

### New Capabilities
- `relatorios`: apresentação de uma execução, comparação entre execuções e linha de base por cenário.
- `exportacao-resultados`: exportação dos resultados em JSON e CSV.

### Modified Capabilities

Nenhuma.

## Impact

- Código: rota `relatorio` da aplicação Angular em `extensao/ui/`, funções de comparação e de exportação em `extensao/shared/`.
- Dependências novas: uPlot (gráficos) e Angular CDK (rolagem virtual).
- Sem novas permissões.
- Depende de `fase-5-robustez` aplicada; as seções de memória e CPU aparecem quando as fases 3 e 4 estiverem aplicadas.
