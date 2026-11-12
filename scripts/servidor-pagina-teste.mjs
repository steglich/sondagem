// Servidor estático da página de teste, em http://localhost:4300.
//
// Cada caso é uma rota (/limpa, /vazamento-listener, /vazamento-dom, /cpu-pesada, /erros,
// /login, /protegida) servida a partir de pagina-teste/<caso>.html. A rota /protegida só é
// servida com o cookie do login simulado; sem ele, redireciona para /login. Arquivos .ts são convertidos para
// JavaScript na hora, sem minificação, para que os nomes de função (como
// calculoPesado) apareçam como escritos nos perfis de CPU.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const PORTA = 4300;
const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'pagina-teste');

const tipos = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
};

/** Converte a URL em um arquivo dentro de pagina-teste/, ou null se sair da pasta. */
function resolverArquivo(caminhoUrl) {
  let relativo = decodeURIComponent(caminhoUrl);
  if (relativo === '/') relativo = '/index';
  if (!extname(relativo)) relativo += '.html';
  const arquivo = normalize(join(pasta, relativo));
  return arquivo.startsWith(pasta + sep) ? arquivo : null;
}

/** Mesmo nome de pagina-teste/sessao.ts. */
const COOKIE_SESSAO = 'sondagem_teste_sessao';

function temSessao(req) {
  return (req.headers.cookie ?? '').split(';').some((cookie) => cookie.trim() === `${COOKIE_SESSAO}=ativa`);
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORTA}`);
  if (url.pathname === '/protegida' && !temSessao(req)) {
    const voltar = encodeURIComponent(url.pathname + url.search);
    res.writeHead(302, { location: `/login?voltar=${voltar}`, 'cache-control': 'no-store' }).end();
    return;
  }
  const arquivo = resolverArquivo(url.pathname);
  const tipo = arquivo && tipos[extname(arquivo)];
  if (!arquivo || !tipo) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Não encontrado');
    return;
  }
  try {
    let corpo = await readFile(arquivo, 'utf8');
    if (arquivo.endsWith('.ts')) {
      corpo = (await transform(corpo, { loader: 'ts', format: 'esm', target: 'es2022', sourcefile: arquivo })).code;
    }
    res.writeHead(200, { 'content-type': tipo, 'cache-control': 'no-store' }).end(corpo);
  } catch (erro) {
    const naoExiste = erro && typeof erro === 'object' && 'code' in erro && erro.code === 'ENOENT';
    res
      .writeHead(naoExiste ? 404 : 500, { 'content-type': 'text/plain; charset=utf-8' })
      .end(naoExiste ? 'Não encontrado' : String(erro));
  }
});

servidor.listen(PORTA, 'localhost', () => {
  console.log(`Página de teste em http://localhost:${PORTA}`);
});
