import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { type Cenario, type ErroValidacao, analisarTextoCenario } from '../../../../shared/cenario';
import { PonteExtensao } from '../sessao/ponte';

/**
 * Cenários salvos na extensão: carregar de um arquivo JSON ou de texto colado,
 * listar, escolher o que será usado em "Analisar" e remover. Um cenário só é
 * salvo depois de validado; os erros aparecem com o caminho do campo.
 */
@Component({
  selector: 'sd-cenarios',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="titulo-cenarios">
      <h2 id="titulo-cenarios">Cenários</h2>

      <ul data-testid="lista-cenarios">
        <li>
          <label>
            <input
              type="radio"
              name="cenario"
              data-testid="selecionar-nenhum"
              [checked]="selecionado() === null"
              (change)="selecionar(null)"
            />
            <span>Nenhum <small>sessão manual</small></span>
          </label>
        </li>
        @for (cenario of cenarios(); track cenario.nome) {
          <li data-testid="cenario">
            <label>
              <input
                type="radio"
                name="cenario"
                [attr.data-testid]="'selecionar-cenario-' + cenario.nome"
                [checked]="selecionado() === cenario.nome"
                (change)="selecionar(cenario.nome)"
              />
              <span>
                {{ cenario.nome }}
                <small>{{ cenario.url_inicial }}</small>
              </span>
            </label>
            <button
              type="button"
              class="secundario"
              [attr.data-testid]="'remover-cenario-' + cenario.nome"
              [attr.aria-label]="'Remover o cenário ' + cenario.nome"
              (click)="remover(cenario.nome)"
            >
              Remover
            </button>
          </li>
        } @empty {
          <li class="vazio" data-testid="sem-cenarios">Nenhum cenário salvo.</li>
        }
      </ul>

      <label class="campo">
        Carregar arquivo JSON
        <input type="file" accept=".json,application/json" data-testid="arquivo-cenario" (change)="carregarArquivo($event)" />
      </label>
      <label class="campo">
        Ou colar o JSON do cenário
        <textarea
          rows="5"
          spellcheck="false"
          data-testid="texto-cenario"
          [value]="texto()"
          (input)="texto.set($any($event.target).value)"
        ></textarea>
      </label>
      <button type="button" class="secundario" data-testid="salvar-cenario" [disabled]="texto().trim() === ''" (click)="salvarTexto()">
        Salvar cenário
      </button>

      @if (salvo(); as nome) {
        <p class="nota" role="status" data-testid="cenario-salvo">Cenário “{{ nome }}” salvo e selecionado.</p>
      }
      @if (erros().length > 0) {
        <div class="aviso" role="alert" data-testid="erros-cenario">
          <p>O cenário não foi salvo. Corrija {{ erros().length === 1 ? 'o erro' : 'os ' + erros().length + ' erros' }}:</p>
          <ul>
            @for (erro of erros(); track $index) {
              <li data-testid="erro-cenario">
                @if (erro.caminho) {
                  <code data-testid="erro-cenario-caminho">{{ erro.caminho }}</code>
                }
                <span>{{ erro.mensagem }}</span>
              </li>
            }
          </ul>
        </div>
      }
    </section>
  `,
  styles: `
    section {
      margin-top: 20px;
    }
    ul {
      margin: 0 0 12px;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      padding: 4px 0;
    }
    label {
      display: flex;
      gap: 8px;
      align-items: flex-start;
    }
    small {
      display: block;
      opacity: 0.7;
      overflow-wrap: anywhere;
    }
    .campo {
      flex-direction: column;
      gap: 4px;
      margin-bottom: 8px;
    }
    textarea {
      box-sizing: border-box;
      width: 100%;
      font: 12px ui-monospace, monospace;
    }
    .aviso ul {
      margin: 0;
    }
    .aviso li {
      display: block;
    }
    code {
      margin-right: 6px;
      overflow-wrap: anywhere;
    }
    .vazio,
    .nota {
      opacity: 0.7;
    }
  `,
})
export class Cenarios {
  private readonly ponte = inject(PonteExtensao);

  protected readonly cenarios = signal<Cenario[]>([]);
  protected readonly selecionado = signal<string | null>(null);
  protected readonly texto = signal('');
  protected readonly erros = signal<ErroValidacao[]>([]);
  protected readonly salvo = signal<string | null>(null);

  constructor() {
    void this.recarregar();
  }

  protected async selecionar(nome: string | null): Promise<void> {
    this.selecionado.set(nome);
    await this.ponte.selecionarCenario(nome);
  }

  protected async remover(nome: string): Promise<void> {
    await this.ponte.removerCenario(nome);
    this.salvo.set(null);
    await this.recarregar();
  }

  protected async carregarArquivo(evento: Event): Promise<void> {
    const campo = evento.target as HTMLInputElement;
    const arquivo = campo.files?.[0];
    if (!arquivo) return;
    await this.salvar(await arquivo.text());
    // Permite escolher o mesmo arquivo de novo depois de corrigi-lo.
    campo.value = '';
  }

  protected async salvarTexto(): Promise<void> {
    if (await this.salvar(this.texto())) this.texto.set('');
  }

  /** Valida e salva. Com erro, nada é gravado. */
  private async salvar(texto: string): Promise<boolean> {
    this.salvo.set(null);
    const resultado = analisarTextoCenario(texto);
    if (!resultado.ok) {
      this.erros.set(resultado.erros);
      return false;
    }
    this.erros.set([]);
    await this.ponte.salvarCenario(resultado.cenario);
    await this.ponte.selecionarCenario(resultado.cenario.nome);
    await this.recarregar();
    this.salvo.set(resultado.cenario.nome);
    return true;
  }

  private async recarregar(): Promise<void> {
    const [cenarios, selecionado] = await Promise.all([this.ponte.listarCenarios(), this.ponte.lerCenarioSelecionado()]);
    this.cenarios.set(cenarios);
    this.selecionado.set(selecionado);
  }
}
