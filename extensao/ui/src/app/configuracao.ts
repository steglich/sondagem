import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';
import { rotas } from './rotas';
import { PonteChrome, PonteExtensao } from './sessao/ponte';

export const configuracao: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Os parâmetros da rota (`:id`, `:idA`, `:idB`) chegam aos componentes como inputs.
    provideRouter(rotas, withHashLocation(), withComponentInputBinding()),
    { provide: PonteExtensao, useClass: PonteChrome },
  ],
};
