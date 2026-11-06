// Servidor local para testar as telas sem a Netlify: node tests/dev-server.mjs  → http://localhost:8888
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { setExecutor } from '../netlify/lib/db.mjs';

process.env.GF_TEST = '1';
process.env.APP_SECRET ||= 'dev-dev-dev-dev-dev-dev-dev-dev-dev-dev-1';
process.env.SETUP_KEY ||= 'chave-local-123';
const pg = new PGlite();
setExecutor(async (t, p) => (await pg.query(t, p)).rows);

const raiz = new URL('..', import.meta.url).pathname;
const mods = {};
for (const m of ['setup', 'auth', 'admin', 'equipe', 'fechamento', 'vendas', 'cardapio', 'financeiro', 'checklist']) mods[m] = (await import(`../netlify/functions/${m}.mjs`)).default;
const mem = new Map();
(await import('../netlify/functions/checklist.mjs')).setStore({ set: async (k, v) => mem.set(k, v), get: async (k) => mem.get(k), delete: async (k) => mem.delete(k) });
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8888');
  if (url.pathname.startsWith('/api/')) {
    const seg = url.pathname.split('/')[2];
    const mod = seg === 'documentos' ? 'checklist' : seg;
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await mods[mod](new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks), duplex: 'half' }));
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let f = path.join(raiz, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(raiz, 'public', 'index.html');
  res.writeHead(200, { 'content-type': TIPOS[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8888, () => console.log('Gestão Food local: http://localhost:8888'));
