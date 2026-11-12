import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PERFIS_EMBUTIDOS, type PerfilThrottling, descreverCondicoes, erroDoPerfil } from '../../../../shared/condicoes';
import { PonteExtensao } from '../sessao/ponte';

/** Texto de um campo numérico para número; vazio vira `null`. */
function numero(texto: string): number | null {
  const limpo = texto.trim().replace(',', '.');
  return limpo === '' ? null : Number(limpo);
}

/**
 * Perfis de throttling personalizados. Um perfil salvo aqui pode ser usado pelo nome
 * em `execucao.throttling` de um cenário, ou escolhido na confirmação da sessão manual.
 */
@Component({
  selector: 'sd-perfis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="titulo-perfis">
      <h2 id="titulo-perfis">Perfis de throttling</h2>
      <ul>
        @for (perfil of embutidos; track perfil.nome) {
          <li data-testid="perfil-embutido">
            <span>
              <strong>{{ perfil.nome }}</strong>
              <small>{{ descrever(perfil) }} (embutido)</small>
            </span>
          </li>
        }
        @for (perfil of perfis(); track perfil.nome) {
          <li data-testid="perfil">
            <span>
              <strong data-testid="perfil-nome">{{ perfil.nome }}</strong>
              <small data-testid="perfil-descricao">{{ descrever(perfil) }}</small>
            </span>
            <button type="button" class="secundario" [attr.data-testid]="'remover-perfil-' + perfil.nome" (click)="remover(perfil.nome)">
              Remover
            </button>
          </li>
        }
      </ul>

      <h3>Novo perfil</h3>
      <div class="campos">
        <label>
          Nome
          <input type="text" data-testid="perfil-campo-nome" [value]="nome()" (input)="nome.set($any($event.target).value)" />
        </label>
        <label>
          Fator de CPU (1 = sem limitação)
          <input type="number" min="1" step="0.5" data-testid="perfil-campo-cpu" [value]="cpu()" (input)="cpu.set($any($event.target).value)" />
        </label>
        <label>
          Latência da rede, em ms (vazio = rede sem limitação)
          <input type="number" min="0" data-testid="perfil-campo-latencia" [value]="latencia()" (input)="latencia.set($any($event.target).value)" />
        </label>
        <label>
          Download, em kbps (vazio = sem limite)
          <input type="number" min="0" data-testid="perfil-campo-download" [value]="download()" (input)="download.set($any($event.target).value)" />
        </label>
        <label>
          Upload, em kbps (vazio = sem limite)
          <input type="number" min="0" data-testid="perfil-campo-upload" [value]="upload()" (input)="upload.set($any($event.target).value)" />
        </label>
      </div>

      @if (erro(); as mensagem) {
        <p class="aviso" role="alert" data-testid="perfil-erro">{{ mensagem }}</p>
      }
      @if (salvo(); as nomeSalvo) {
        <p class="nota" role="status" data-testid="perfil-salvo">Perfil “{{ nomeSalvo }}” salvo.</p>
      }
      <button type="button" data-testid="salvar-perfil" (click)="salvar()">Salvar perfil</button>
    </section>
  `,
  styles: `
    section {
      margin-top: 24px;
    }
    ul {
      display: grid;
      gap: 6px;
      margin: 0 0 12px;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    small {
      display: block;
      opacity: 0.7;
    }
    .campos {
      display: grid;
      gap: 8px;
      margin-bottom: 12px;
    }
    .campos label {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .campos input {
      box-sizing: border-box;
      width: 100%;
      font: inherit;
    }
    .nota {
      opacity: 0.7;
    }
  `,
})
export class Perfis {
  private readonly ponte = inject(PonteExtensao);

  protected readonly embutidos = PERFIS_EMBUTIDOS;
  protected readonly descrever = descreverCondicoes;
  protected readonly perfis = signal<PerfilThrottling[]>([]);
  protected readonly nome = signal('');
  protected readonly cpu = signal('1');
  protected readonly latencia = signal('');
  protected readonly download = signal('');
  protected readonly upload = signal('');
  protected readonly erro = signal<string | null>(null);
  protected readonly salvo = signal<string | null>(null);

  constructor() {
    void this.recarregar();
  }

  /** Confere e salva. Com erro, nada é gravado. */
  protected async salvar(): Promise<void> {
    this.salvo.set(null);
    const latencia = numero(this.latencia());
    const download = numero(this.download());
    const upload = numero(this.upload());
    // Só há limitação de rede se algum dos três campos foi preenchido.
    const comRede = latencia !== null || download !== null || upload !== null;
    const perfil: PerfilThrottling = {
      nome: this.nome().trim(),
      cpu: numero(this.cpu()) ?? 1,
      rede: comRede ? { latenciaMs: latencia ?? 0, downloadKbps: download, uploadKbps: upload } : null,
    };
    const erro = erroDoPerfil(perfil);
    this.erro.set(erro);
    if (erro) return;
    await this.ponte.salvarPerfil(perfil);
    await this.recarregar();
    this.salvo.set(perfil.nome);
    this.nome.set('');
    this.cpu.set('1');
    this.latencia.set('');
    this.download.set('');
    this.upload.set('');
  }

  protected async remover(nome: string): Promise<void> {
    await this.ponte.removerPerfil(nome);
    this.salvo.set(null);
    await this.recarregar();
  }

  private async recarregar(): Promise<void> {
    this.perfis.set(await this.ponte.listarPerfis());
  }
}
