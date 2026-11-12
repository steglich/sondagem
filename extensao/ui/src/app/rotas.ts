import type { Routes } from '@angular/router';
import { Painel } from './painel/painel';

export const rotas: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'painel' },
  { path: 'painel', component: Painel },
  {
    path: 'relatorio/comparar/:idA/:idB',
    loadComponent: () => import('./relatorio/comparacao').then((m) => m.Comparacao),
  },
  // Sem `:id`, a página lista as execuções do histórico.
  {
    path: 'relatorio/:id',
    loadComponent: () => import('./relatorio/relatorio').then((m) => m.Relatorio),
  },
  {
    path: 'relatorio',
    loadComponent: () => import('./relatorio/relatorio').then((m) => m.Relatorio),
  },
  { path: '**', redirectTo: 'painel' },
];
