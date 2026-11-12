# Tasks

## 1. Agregação do perfil

- [x] 1.1 Definir em `shared/types.ts` os tipos do resumo de CPU (função, categorias do motor, "outras"); verificar que o projeto compila
- [x] 1.2 Implementar a agregação incremental dos eventos `Profile` e `ProfileChunk` do trace em tempo próprio e tempo total por chave de função, com recursão contada uma vez por amostra; verificar com testes unitários sobre um perfil pequeno de resultado conhecido, incluindo função recursiva e função anônima
- [x] 1.3 Separar as categorias do motor e o grupo "extensões" e calcular os percentuais sem o tempo ocioso; verificar com testes unitários
- [x] 1.4 Descartar as amostras dentro dos intervalos excluídos (snapshot e coleta forçada) e aplicar o limite de 200 funções com a linha "outras"; verificar com testes unitários

## 2. Coleta

- [x] 2.1 Registrar a verificação "CPU" (exige debugger) e iniciar o perfil depois do aquecimento, parando ao final dos passos principais; verificar com teste unitário no transporte falso a ordem de `Tracing.start` e `Tracing.end`
- [x] 2.2 Registrar no runner os intervalos de snapshot e de coleta forçada, lidos com `Performance.getMetrics` (relógio do trace), e passá-los à agregação; verificar com teste unitário
- [x] 2.3 Garantir `Tracing.end` em erro e cancelamento, e o descarte de cada pedaço do perfil depois de agregado; verificar com teste unitário do caminho de cancelamento
- [x] 2.4 Implementar o perfil na sessão manual com limite de 5 minutos, aviso e continuidade das outras verificações; verificar com teste unitário usando relógio simulado
- [x] 2.5 Marcar no resultado que o perfil de CPU estava ativo; verificar com teste unitário
- [x] 2.6 Tratar a falha de `Tracing.start` (análise continua sem CPU, com aviso) e `dataLossOccurred` (resumo com aviso de perfil incompleto); verificar com testes unitários no transporte falso

## 3. Interface

- [x] 3.1 Exibir a seção de CPU no resultado: categorias do motor e as 30 primeiras funções com nome, origem, tempo próprio, tempo total e percentual; verificar com teste de componente a partir de um resumo fixo
- [x] 3.2 Exibir o aviso de que as métricas foram coletadas com o perfil ligado, o aviso de limite atingido na sessão manual e os avisos de perfil não coletado e de perfil incompleto; verificar com teste de componente

## 4. Critério de aceitação da fase

- [x] 4.1 Criar o cenário `cpu-pesada` em `pagina-teste/cenarios/`; verificar que passa na validação
- [x] 4.2 Teste de integração: executar `cpu-pesada` com "CPU" ativa e verificar que `calculoPesado` é a primeira função da página no resumo, com arquivo e linha
- [x] 4.3 Teste de integração: executar sem "CPU" e verificar que nenhum comando `Tracing` é enviado e o resultado não tem a seção de CPU
- [x] 4.4 Atualizar `CLAUDE.md` com o módulo de perfil de CPU; verificar que os caminhos citados existem
- [x] 4.5 Teste de integração: enviar pelo `chrome.debugger` real todos os comandos de CDP usados pelo perfil de CPU e falhar se algum for recusado, conferindo também que os intervalos lidos com `Performance.getMetrics` caem dentro do período do perfil
