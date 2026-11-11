import { Component } from '@angular/core';

@Component({
  selector: 'sd-painel',
  template: `
    <main>
      <h1>Sondagem</h1>
      <button type="button" data-testid="abrir-relatorio" (click)="abrirRelatorio()">
        Abrir relatório
      </button>
    </main>
  `,
  styles: `
    main {
      padding: 12px 16px;
    }
  `,
})
export class Painel {
  /** Abre a rota de relatório em uma aba própria. */
  abrirRelatorio(): void {
    void chrome.tabs.create({ url: chrome.runtime.getURL('index.html#/relatorio') });
  }
}
