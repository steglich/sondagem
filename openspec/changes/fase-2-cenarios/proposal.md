# Proposal

## Why

Medições só são comparáveis se as ações forem idênticas entre execuções. Esta fase entrega o modo principal do produto: o cenário declarativo em JSON, executado N vezes pela extensão por meio do debugger (plano, seções 3.1, 3.4, 4.1 e 9). É também a base obrigatória das fases de memória e CPU, que dependem do CDP.

## What Changes

- Formato do cenário JSON (esquema versão 1) com validação antes de rodar e mensagens que apontam o campo e a posição.
- Carregar, salvar e selecionar cenários no side panel.
- Conexão com o debugger (CDP): anexar, enviar comandos, receber eventos, desanexar sempre, e parar com mensagem clara quando não for possível anexar (por exemplo, DevTools aberto na aba).
- Runner com máquina de estados: aquecimento, iterações, tempo limite e política de erro por passo, cancelamento.
- Passos de ação: `navegar`, `clicar`, `digitar`, `esperar`, `rolar`, `aguardar_inatividade` e `repetir`.
- Métricas das fases anteriores associadas à iteração em que ocorreram, com mediana, p75 e p95.
- Nova verificação "Erros da página": exceções e promises rejeitadas, por iteração.
- Registro do ambiente (janela, DPR, versão do navegador, user agent) em cada resultado.

Os passos de medição `medir`, `snapshot` e `forcar_gc` são aceitos pelo esquema nesta fase, mas só passam a ser executados na fase 3. O campo de throttling é aceito e registrado, e aplicado na fase 5.

## Capabilities

### New Capabilities
- `cenario-declarativo`: formato, validação e gerenciamento dos cenários JSON.
- `conexao-debugger`: ciclo de vida da conexão com o debugger do Chrome e tratamento de falhas de anexação e desconexão.
- `execucao-cenarios`: execução repetível dos passos de um cenário, com iterações, erros, cancelamento e estatísticas.
- `erros-da-pagina`: captura de exceções JavaScript e promises rejeitadas durante a análise.

### Modified Capabilities

Nenhuma.

## Impact

- Código: `extensao/background/{cdp,scenarios}.ts`, `extensao/shared/{types,stats}.ts`, esquema JSON do cenário, telas de cenário no side panel.
- Manifesto: nova permissão `debugger`. O Chrome exibe a barra de aviso de depuração durante a execução.
- Dependência nova: Ajv, usado apenas em tempo de build para gerar o validador.
- Depende de `fase-1-metricas-basicas` aplicada.
