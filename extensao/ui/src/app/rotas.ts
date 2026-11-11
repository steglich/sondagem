import type { Routes } from '@angular/router';
import { Painel } from './painel/painel';

export const rotas: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'painel' },
  { path: 'painel', component: Painel },
  {
    path: 'relatorio',
    loadComponent: () => import('./relatorio/relatorio').then((m) => m.Relatorio),
  },
  { path: '**', redirectTo: 'painel' },
];
