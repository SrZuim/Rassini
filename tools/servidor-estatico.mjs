/* ==========================================================================
   RNA One — servidor estático para desenvolvimento
   O projeto é 100% estático e usa ES Modules, que não funcionam por file://.
   O README sugere `python -m http.server`; este script é a alternativa em Node
   para ambientes sem Python — sem dependências, sem node_modules.

   Uso:  node tools/servidor-estatico.mjs [porta]
   ========================================================================== */
import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.argv[2] || 5566);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.sql': 'text/plain; charset=utf-8'
};

const servidor = http.createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, `http://localhost:${PORTA}`).pathname);
    let alvo = path.join(RAIZ, url === '/' ? '/login.html' : url);

    /* Não sair da raiz do projeto. */
    if (!alvo.startsWith(RAIZ)) { res.writeHead(403).end('Acesso negado'); return; }

    let info = await fs.stat(alvo).catch(() => null);
    if (info?.isDirectory()) {
      alvo = path.join(alvo, 'index.html');
      info = await fs.stat(alvo).catch(() => null);
    }
    if (!info) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 — não encontrado: ' + url); return; }

    res.writeHead(200, {
      'content-type': TIPOS[path.extname(alvo).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    createReadStream(alvo).pipe(res);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('500 — ' + e.message);
  }
});

servidor.listen(PORTA, () => {
  console.log(`RNA One servindo ${RAIZ}`);
  console.log(`http://localhost:${PORTA}/login.html`);
});
