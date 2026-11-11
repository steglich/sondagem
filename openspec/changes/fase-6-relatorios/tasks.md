# Tasks

## 1. Base do relatório

- [ ] 1.1 Adicionar uPlot e Angular CDK e criar as rotas `relatorio/:id` e `relatorio/comparar/:idA/:idB`; verificar que o build passa e que não há violação de CSP ao abrir as rotas
- [ ] 1.2 Implementar a leitura em duas etapas (registro leve na abertura, detalhes por seção) sobre o repositório; verificar com teste unitário que a abertura não lê o store `detalhes`
- [ ] 1.3 Implementar o cabeçalho do relatório: metadados, condições, ambiente, estado final em destaque e ponto de parada para resultados parciais; verificar com testes de componente para os estados concluída, interrompida, cancelada e erro
- [ ] 1.4 Ligar o histórico do side panel à abertura do relatório em nova aba; verificar com teste de integração

## 2. Seções do relatório

- [ ] 2.1 Criar o componente de gráfico sobre uPlot, com séries por signal e criação adiada até a seção ficar visível; verificar com teste de componente que o gráfico não é criado com a seção fechada
- [ ] 2.2 Implementar a seção de estatísticas (mediana, p75, p95 por métrica) e a seção de processamento (gráfico por iteração e listas virtualizadas de long tasks e interações); verificar com testes de componente
- [ ] 2.3 Implementar a seção de memória: gráfico de heap, nós e listeners por iteração, classificação e lista virtualizada dos construtores que mais cresceram; verificar com teste de componente a partir de um resultado fixo
- [ ] 2.4 Implementar a seção de CPU (categorias e lista virtualizada de funções) e a seção de erros da página por iteração; verificar com testes de componente
- [ ] 2.5 Ocultar as seções de verificações que não rodaram; verificar com teste de componente
- [ ] 2.6 Teste de integração de responsividade: abrir o relatório de um resultado sintético com 10.000 long tasks e resumo de snapshot no tamanho máximo e verificar que nenhuma long task do relatório passa de 200 ms na abertura e na rolagem

## 3. Comparação e linha de base

- [ ] 3.1 Implementar `compararExecucoes` em `shared/` (diferenças por métrica, diferenças de condições e ambiente, recusa de cenários diferentes e de resultados não completos); verificar com testes unitários
- [ ] 3.2 Implementar a tela de comparação com a seleção das duas execuções, a tabela de diferenças e o aviso de condições diferentes; verificar com testes de componente
- [ ] 3.3 Implementar a linha de base por cenário (marcar, desmarcar, limites por métrica) em `chrome.storage.local` e a proteção da execução de referência na política de retenção; verificar com testes unitários
- [ ] 3.4 Sinalizar regressão no relatório e no resumo do side panel ao concluir uma execução com linha de base definida; verificar com testes unitários (acima do limite, dentro do limite, métrica ausente)
- [ ] 3.5 Bloquear linha de base e comparação para sessões manuais e resultados parciais; verificar com testes de componente

## 4. Exportação

- [ ] 4.1 Implementar a exportação JSON com `versao_exportacao` e o nome de arquivo com cenário, build e data; verificar com testes unitários
- [ ] 4.2 Implementar a geração de CSV por iteração com escape RFC 4180, BOM UTF-8 e opção de separador; verificar com testes unitários (vírgula, aspas, quebra de linha, métrica ausente)
- [ ] 4.3 Implementar a exportação CSV da comparação; verificar com teste unitário
- [ ] 4.4 Adicionar os botões de exportação ao relatório e à comparação, com download por Blob; verificar com teste de integração que os arquivos são baixados e que um cenário com login não expõe os valores digitados

## 5. Critério de aceitação da fase

- [ ] 5.1 Teste de integração: executar o mesmo cenário da página de teste com dois valores de versão do build, comparar e verificar que o relatório mostra as duas versões e as diferenças por métrica
- [ ] 5.2 Atualizar `CLAUDE.md` com a estrutura do relatório e os formatos de exportação, e documentar os formatos em `docs/exportacao.md`; verificar que um arquivo exportado corresponde ao documentado
