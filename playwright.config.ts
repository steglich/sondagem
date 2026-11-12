import { defineConfig } from '@playwright/test';

const PAGINA_TESTE = 'http://localhost:4300';

export default defineConfig({
  testDir: 'testes',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: PAGINA_TESTE,
    browserName: 'chromium',
    // O Chromium completo (e não o headless shell) é necessário para carregar extensões.
    channel: 'chromium',
  },
  projects: [
    { name: 'pagina-teste', testMatch: 'pagina-teste/**/*.spec.ts' },
    // Requer `npm run build` antes: carrega dist/extensao/.
    { name: 'extensao', testMatch: 'extensao/**/*.spec.ts' },
    // Comparações de tempo (variação entre execuções, impacto do painel): só depois dos
    // outros projetos, para não medir a carga dos testes que rodam em paralelo.
    { name: 'medicao', testMatch: 'medicao/**/*.spec.ts', dependencies: ['pagina-teste', 'extensao'] },
  ],
  webServer: {
    command: 'npm run pagina-teste',
    url: PAGINA_TESTE,
    reuseExistingServer: true,
  },
});
