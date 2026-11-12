import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { type SeparadorCsv, csvPorIteracao, exportarJson, nomeDoArquivo } from '../../../../shared/exportacao';
import type { ExecucaoGuardada, RegistroExecucao } from '../../../../shared/historico';
import { PonteExtensao } from '../sessao/ponte';

export const TIPO_JSON = 'application/json';
export const TIPO_CSV = 'text/csv;charset=utf-8';

/** Botões de exportação de uma execução: JSON com tudo o que está guardado, e CSV das medições por iteração. */
@Component({
  selector: 'sd-exportar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="titulo-exportar">
      <h3 id="titulo-exportar">Exportar</h3>
      <div class="acoes">
        <button type="button" class="secundario" data-testid="exportar-json" [disabled]="ocupado()" (click)="exportarJson()">Exportar JSON</button>
        @if (temIteracoes()) {
          <button type="button" class="secundario" data-testid="exportar-csv" [disabled]="ocupado()" (click)="exportarCsv()">Exportar CSV</button>
          <label>
            Separador do CSV
            <select data-testid="separador-csv" (change)="separador.set($any($event.target).value)">
              <option value="," [selected]="separador() === ','">vírgula (padrão)</option>
              <option value=";" [selected]="separador() === ';'">ponto e vírgula (planilhas em português)</option>
            </select>
          </label>
        }
      </div>
      @if (erro(); as mensagem) {
        <p class="aviso" role="alert" data-testid="exportar-erro">{{ mensagem }}</p>
      }
    </section>
  `,
  styles: `
    section {
      margin: 12px 0;
    }
    .acoes {
      align-items: center;
    }
    select {
      font: inherit;
    }
  `,
})
export class Exportar {
  private readonly ponte = inject(PonteExtensao);

  readonly registro = input.required<RegistroExecucao>();

  protected readonly separador = signal<SeparadorCsv>(',');
  protected readonly ocupado = signal(false);
  protected readonly erro = signal<string | null>(null);
  /** O CSV tem uma linha por iteração: sem iterações (sessão manual), não há o que exportar nele. */
  protected readonly temIteracoes = computed(() => (this.registro().resumo?.cenario?.iteracoes.length ?? 0) > 0);

  protected exportarJson(): Promise<void> {
    return this.exportar('json', TIPO_JSON, exportarJson);
  }

  protected exportarCsv(): Promise<void> {
    const separador = this.separador();
    return this.exportar('csv', TIPO_CSV, (guardada) => csvPorIteracao(guardada, separador));
  }

  /** Os detalhes só são lidos aqui, na hora de exportar. */
  private async exportar(extensao: 'json' | 'csv', tipo: string, gerar: (guardada: ExecucaoGuardada) => string): Promise<void> {
    const registro = this.registro();
    this.ocupado.set(true);
    this.erro.set(null);
    try {
      const dados = await this.ponte.lerDetalhes(registro.id);
      if (!dados) {
        this.erro.set('Os detalhes desta execução não estão mais no histórico.');
        return;
      }
      this.ponte.baixar(nomeDoArquivo(registro, extensao), gerar({ registro, dados }), tipo);
    } catch (falha) {
      this.erro.set(`Não foi possível exportar: ${falha instanceof Error ? falha.message : String(falha)}`);
    } finally {
      this.ocupado.set(false);
    }
  }
}
