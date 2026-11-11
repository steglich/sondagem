// Falha se os bundles do código de medição contiverem código do Angular.
// Segunda barreira do isolamento; a primeira é a regra no-restricted-imports do ESLint.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const arquivos = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['dist/extensao/service-worker.js', 'dist/extensao/injected.js'];

/** Marcas que só aparecem em código compilado do Angular. */
const marcas = [
  { nome: 'pacote @angular/*', padrao: /@angular\// },
  { nome: 'instruções Ivy (ɵɵ)', padrao: /ɵɵ|\\u0275\\u0275/ },
  { nome: 'símbolos privados do Angular (ɵ)', padrao: /ɵ(fac|cmp|dir|prov|mod|inj)\b/ },
  { nome: 'ngDevMode', padrao: /\bngDevMode\b/ },
  { nome: 'NG0 (código de erro do Angular)', padrao: /\bNG0\d{3}\b/ },
];

let falhou = false;
for (const arquivo of arquivos) {
  const conteudo = await readFile(join(raiz, arquivo), 'utf8');
  const encontradas = marcas.filter((m) => m.padrao.test(conteudo)).map((m) => m.nome);
  if (encontradas.length > 0) {
    falhou = true;
    console.error(`✗ ${arquivo} contém código do Angular: ${encontradas.join(', ')}`);
  } else {
    console.log(`✓ ${arquivo} sem código do Angular`);
  }
}

if (falhou) {
  console.error('O código de medição não pode incluir o framework de interface.');
  process.exit(1);
}
