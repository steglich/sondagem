// Gera extensao/shared/gerado/validador-cenario.js a partir do JSON Schema do cenário.
//
// O Ajv em tempo de execução compila schemas com `new Function`, proibido pela CSP
// da extensão. O modo standalone produz o validador como código-fonte, sem
// dependência do Ajv em tempo de execução. O arquivo gerado é versionado, para
// que testes e typecheck não dependam do build; um teste confere que está em dia.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ARQUIVO_SCHEMA = join(raiz, 'extensao', 'shared', 'cenario.schema.json');
export const ARQUIVO_VALIDADOR = join(raiz, 'extensao', 'shared', 'gerado', 'validador-cenario.js');

const CABECALHO = '// Gerado por scripts/gerar-validador.mjs a partir de cenario.schema.json. Não edite.\n';

/** Devolve o código-fonte do validador (módulo ES, sem imports). */
export async function gerarValidador() {
  const schema = JSON.parse(await readFile(ARQUIVO_SCHEMA, 'utf8'));
  const ajv = new Ajv({ allErrors: true, code: { source: true, esm: true }, allowUnionTypes: true, inlineRefs: false });
  const codigo = standaloneCode(ajv, ajv.compile(schema));
  if (/\brequire\(|^\s*import\s|\bnew Function\b|\beval\(/m.test(codigo)) {
    throw new Error('O validador gerado tem dependências ou código dinâmico; simplifique o schema.');
  }
  return CABECALHO + codigo + '\n';
}

export async function gravarValidador() {
  await writeFile(ARQUIVO_VALIDADOR, await gerarValidador());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await gravarValidador();
  console.log('✓ validador do cenário gerado');
}
