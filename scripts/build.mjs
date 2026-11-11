// Gera dist/extensao/, a pasta carregável em chrome://extensions.
//
//   node scripts/build.mjs           build de produção
//   node scripts/build.mjs --watch   rebuild contínuo (esbuild + ng build --watch)
//
// Dois pipelines independentes: esbuild para o código de medição (service worker
// em ESM e código injetado em IIFE) e Angular CLI para a interface. O Angular
// escreve direto em dist/extensao/ (ver extensao/ui/angular.json); este script
// limpa a pasta, copia o manifesto e gera os bundles de medição.
import { spawn } from 'node:child_process';
import { copyFile, mkdir, rm, watch } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const saida = join(raiz, 'dist', 'extensao');
const manifesto = join(raiz, 'extensao', 'manifest.json');
const modoWatch = process.argv.includes('--watch');

/** Opções comuns: sem minificação, para que nomes de função apareçam nos perfis. */
const comum = {
  bundle: true,
  target: 'chrome116',
  platform: 'browser',
  logLevel: 'info',
  legalComments: 'none',
  sourcemap: modoWatch ? 'linked' : false,
};

/** @type {import('esbuild').BuildOptions[]} */
const bundles = [
  {
    ...comum,
    entryPoints: [join(raiz, 'extensao', 'background', 'service-worker.ts')],
    outfile: join(saida, 'service-worker.js'),
    format: 'esm',
  },
  {
    ...comum,
    entryPoints: [join(raiz, 'extensao', 'injected', 'entrada.ts')],
    outfile: join(saida, 'injected.js'),
    format: 'iife',
  },
];

async function copiarManifesto() {
  await copyFile(manifesto, join(saida, 'manifest.json'));
}

function rodarAngular(argumentos) {
  const ng = join(raiz, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
  const processo = spawn(process.execPath, [ng, 'build', ...argumentos], {
    cwd: join(raiz, 'extensao', 'ui'),
    stdio: 'inherit',
    env: { ...process.env, NG_CLI_ANALYTICS: 'false' },
  });
  // Encerrar este script (Ctrl+C, kill) encerra também o ng build.
  for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sinal, () => {
      processo.kill(sinal);
      process.exit(130);
    });
  }
  return new Promise((resolve, reject) => {
    processo.on('error', reject);
    processo.on('exit', (codigo) =>
      codigo === 0 ? resolve() : reject(new Error(`ng build terminou com código ${codigo}`)),
    );
  });
}

await rm(saida, { recursive: true, force: true });
await mkdir(saida, { recursive: true });
await copiarManifesto();

if (modoWatch) {
  for (const opcoes of bundles) {
    const contexto = await esbuild.context(opcoes);
    await contexto.watch();
  }
  rodarAngular(['--watch', '--configuration', 'development']).catch((erro) => {
    console.error(erro.message);
    process.exit(1);
  });
  console.log('Observando alterações. Recarregue a extensão em chrome://extensions após cada build.');
  const alteracoes = watch(manifesto)[Symbol.asyncIterator]();
  while (!(await alteracoes.next()).done) {
    await copiarManifesto();
    console.log('manifest.json copiado.');
  }
} else {
  await Promise.all(bundles.map((opcoes) => esbuild.build(opcoes)));
  await rodarAngular([]);
}
