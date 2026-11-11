import { bootstrapApplication } from '@angular/platform-browser';
import { Raiz } from './app/raiz';
import { configuracao } from './app/configuracao';

bootstrapApplication(Raiz, configuracao).catch((erro: unknown) => console.error(erro));
