import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { descreverCondicoes } from '../../../../shared/condicoes';
import { type RegistroExecucao, ehParcial } from '../../../../shared/historico';
import { descreverStorage } from '../../../../shared/limpeza-storage';
import { pontoDeParada } from '../../../../shared/relatorio';
import { VERIFICACOES } from '../../../../shared/verificacoes';
import { dataHora, estadoExibido } from './formato';

/**
 * Cabeçalho do relatório: de que execução se trata, como terminou e em que
 * condições e ambiente rodou. Um resultado parcial tem o estado em destaque e o
 * ponto em que parou.
 */
@Component({
  selector: 'sd-cabecalho',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header>
      <h2 data-testid="relatorio-nome">{{ registro().nomeCenario ?? 'Sessão manual' }}</h2>
      <p>
        <strong class="estado" data-testid="relatorio-estado" [class.parcial]="parcial()">{{ estado() }}</strong>
        @if (parcial()) {
          <span data-testid="relatorio-parcial"> — resultado parcial: não serve de referência nem de comparação.</span>
        }
      </p>
      @if (parada(); as ponto) {
        <p class="aviso" role="status" data-testid="relatorio-parada">
          @if (ponto.iteracao !== null) {
            Parou na iteração {{ ponto.iteracao }}{{ ponto.totalIteracoes === null ? '' : ' de ' + ponto.totalIteracoes }}
            ({{ ponto.iteracoesCompletas }} {{ ponto.iteracoesCompletas === 1 ? 'completa' : 'completas' }}).
          } @else if (registro().tipo === 'cenario') {
            Parou antes da primeira iteração.
          } @else {
            A sessão não chegou ao fim.
          }
          @if (ponto.motivo) {
            <span data-testid="relatorio-motivo">{{ ponto.motivo }}</span>
          }
        </p>
      }

      <dl data-testid="relatorio-metadados">
        <dt>Tipo</dt>
        <dd>{{ registro().tipo === 'cenario' ? 'Cenário' : 'Sessão manual' }}</dd>
        <dt>URL</dt>
        <dd>{{ registro().url }}</dd>
        <dt>Início</dt>
        <dd data-testid="relatorio-inicio">{{ data(registro().inicio) }}</dd>
        <dt>Duração</dt>
        <dd>{{ duracao() }}</dd>
        <dt>Versão do build</dt>
        <dd data-testid="relatorio-build">{{ registro().versaoBuild ?? 'não informada' }}</dd>
        @if (registro().configuracao; as configuracao) {
          <dt>Iterações</dt>
          <dd data-testid="relatorio-iteracoes">{{ iteracoes() }} de {{ configuracao.iteracoes }} completas</dd>
        }
        <dt>Verificações</dt>
        <dd data-testid="relatorio-verificacoes">{{ verificacoes() }}</dd>
      </dl>

      <h3>Condições de teste</h3>
      <dl data-testid="relatorio-condicoes">
        <dt>Perfil de throttling</dt>
        <dd>{{ registro().condicoes.perfil }}</dd>
        <dt>CPU e rede</dt>
        <dd>{{ condicoes() }}</dd>
        <dt>Cache</dt>
        <dd>{{ cache() }}</dd>
        @if (registro().condicoes.storageLimpo.length > 0) {
          <dt>Storage apagado</dt>
          <dd>{{ storage() }}</dd>
        }
      </dl>

      <h3>Ambiente</h3>
      <dl data-testid="relatorio-ambiente">
        <dt>Navegador</dt>
        <dd>{{ navegador() }}</dd>
        @if (registro().ambiente; as ambiente) {
          <dt>Janela</dt>
          <dd>{{ ambiente.janela.largura }}×{{ ambiente.janela.altura }}, densidade {{ ambiente.dpr }}</dd>
        }
        <dt>Outras extensões ativas</dt>
        <dd data-testid="relatorio-extensoes">{{ extensoes() }}</dd>
      </dl>
    </header>
  `,
  styles: `
    .estado {
      font-size: 1.05rem;
    }
    .estado.parcial {
      padding: 2px 8px;
      border-radius: 4px;
      background: #c77700;
      color: #fff;
    }
    dl {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      gap: 2px 16px;
      margin: 0 0 12px;
    }
    dt {
      opacity: 0.7;
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
  `,
})
export class Cabecalho {
  readonly registro = input.required<RegistroExecucao>();

  protected readonly data = dataHora;
  protected readonly estado = computed(() => estadoExibido(this.registro()));
  /** Parcial também é a execução que "concluiu" depois de a aplicação pedir o login. */
  protected readonly parcial = computed(() => ehParcial(this.registro()) || Boolean(this.registro().resumo?.cenario?.falhaDeSessao));
  protected readonly parada = computed(() => pontoDeParada(this.registro()));
  protected readonly iteracoes = computed(() => this.registro().resumo?.cenario?.iteracoesCompletas ?? 0);
  protected readonly condicoes = computed(() => descreverCondicoes(this.registro().condicoes));
  protected readonly storage = computed(() => descreverStorage(this.registro().condicoes.storageLimpo));

  protected readonly duracao = computed(() => {
    const { inicio, fim } = this.registro();
    return fim === null ? 'em andamento' : `${((fim - inicio) / 1000).toFixed(1)} s`;
  });

  protected readonly verificacoes = computed(() => {
    const selecao = this.registro().selecao;
    const nomes = VERIFICACOES.filter((v) => selecao.includes(v.id)).map((v) => v.nome);
    return nomes.length ? nomes.join(', ') : 'nenhuma';
  });

  protected readonly cache = computed(() => {
    const { cacheDesligado, cacheLimpo } = this.registro().condicoes;
    return `${cacheDesligado ? 'desligado durante a análise' : 'ligado'}${cacheLimpo ? ', limpo antes de começar' : ''}`;
  });

  protected readonly navegador = computed(() => {
    const registro = this.registro();
    return registro.ambiente?.versaoNavegador ?? registro.navegador?.versao ?? 'não informado';
  });

  protected readonly extensoes = computed(() => {
    const extensoes = this.registro().extensoes;
    return extensoes.length ? extensoes.map((e) => e.nome).join(', ') : 'nenhuma';
  });
}
