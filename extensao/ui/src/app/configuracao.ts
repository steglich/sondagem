import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { rotas } from './rotas';

export const configuracao: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), provideRouter(rotas, withHashLocation())],
};
