# Tasks

## 1. Agregação do perfil

- [ ] 1.1 Definir em `shared/types.ts` os tipos do resumo de CPU (função, categorias do motor, "outras"); verificar que o projeto compila
- [ ] 1.2 Implementar a agregação do perfil bruto em tempo próprio e tempo total por chave de função, com recursão contada uma vez por amostra; verificar com testes unitários sobre um perfil pequeno de resultado conhecido, incluindo função recursiva e função anônima
- [ ] 1.3 Separar as categorias do motor e o grupo "extensões" e calcular os percentuais sem o tempo ocioso; verificar com testes unitários
- [ ] 1.4 Descartar as amostras dentro dos intervalos excluídos (snapshot e coleta forçada) e aplicar o limite de 200 funções com a linha "outras"; verificar com testes unitários

## 2. Coleta

- [ ] 2.1 Registrar a verificação "CPU" (exige debugger) e iniciar o perfil depois do aquecimento, parando ao final dos passos principais; verificar com teste unitário no transporte falso a ordem dos comandos `Profiler`
- [ ] 2.2 Registrar no runner os intervalos de snapshot e de coleta forçada e passá-los à agregação; verificar com teste unitário
- [ ] 2.3 Garantir `Profiler.stop` e `Profiler.disable` em erro e cancelamento, e o descarte do perfil bruto após a agregação; verificar com teste unitário do caminho de cancelamento
- [ ] 2.4 Implementar o perfil na sessão manual com limite de 5 minutos, aviso e continuidade das outras verificações; verificar com teste unitário usando relógio simulado
- [ ] 2.5 Marcar no resultado que o perfil de CPU estava ativo; verificar com teste unitário

## 3. Interface

- [ ] 3.1 Exibir a seção de CPU no resultado: categorias do motor e as 30 primeiras funções com nome, origem, tempo próprio, tempo total e percentual; verificar com teste de componente a partir de um resumo fixo
- [ ] 3.2 Exibir o aviso de que as métricas foram coletadas com o perfil ligado e o aviso de limite atingido na sessão manual; verificar com teste de componente

## 4. Critério de aceitação da fase

- [ ] 4.1 Criar o cenário `cpu-pesada` em `pagina-teste/cenarios/`; verificar que passa na validação
- [ ] 4.2 Teste de integração: executar `cpu-pesada` com "CPU" ativa e verificar que `calculoPesado` é a primeira função da página no resumo, com arquivo e linha
- [ ] 4.3 Teste de integração: executar sem "CPU" e verificar que nenhum comando `Profiler` é enviado e o resultado não tem a seção de CPU
- [ ] 4.4 Atualizar `CLAUDE.md` com o módulo de perfil de CPU; verificar que os caminhos citados existem
