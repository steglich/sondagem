import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { rotas } from './rotas';
import { PonteChrome, PonteExtensao } from './sessao/ponte';

export const configuracao: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(rotas, withHashLocation()),
    { provide: PonteExtensao, useClass: PonteChrome },
  ],
};
