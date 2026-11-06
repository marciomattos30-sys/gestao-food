// Respostas, cookies, leitura do corpo e roteamento simples.
import { HttpError } from './db.mjs';

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export function lerCookie(req, nome) {
  const c = req.headers.get('cookie') || '';
  const m = c.split(/;\s*/).find((p) => p.startsWith(nome + '='));
  return m ? decodeURIComponent(m.slice(nome.length + 1)) : null;
}

export function cookie(nome, valor, { maxAge, path = '/' } = {}) {
  const partes = [`${nome}=${encodeURIComponent(valor)}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax'];
  if (process.env.CONTEXT !== 'dev' && !process.env.GF_TEST) partes.push('Secure');
  if (maxAge !== undefined) partes.push(`Max-Age=${maxAge}`);
  return partes.join('; ');
}

export async function corpo(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  try { return await req.json(); } catch { return {}; }
}

export function infoCliente(req) {
  return {
    ip: req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || '',
    ua: (req.headers.get('user-agent') || '').slice(0, 200),
  };
}

/**
 * Roteador: rotas = [['GET', '/api/x/:id', handler], ...]
 * handler(ctx) recebe { req, params, url, body }.
 */
export function roteador(rotas) {
  const compiladas = rotas.map(([m, p, h]) => {
    const nomes = [];
    const re = new RegExp('^' + p.replace(/:(\w+)/g, (_, n) => { nomes.push(n); return '([^/]+)'; }) + '/?$');
    return { m, re, nomes, h };
  });
  return async (req) => {
    const url = new URL(req.url);
    try {
      // Proteção CSRF: toda escrita precisa vir do próprio app.
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.get('x-gf') !== '1') {
        throw new HttpError(403, 'Requisição recusada.');
      }
      for (const r of compiladas) {
        if (r.m !== req.method) continue;
        const mm = url.pathname.match(r.re);
        if (!mm) continue;
        const params = Object.fromEntries(r.nomes.map((n, i) => [n, decodeURIComponent(mm[i + 1])]));
        const ct = req.headers.get('content-type') || '';
        const body = ct.includes('multipart/form-data') ? null : await corpo(req);
        return await r.h({ req, params, url, body });
      }
      return json({ erro: 'Rota não encontrada.' }, 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ erro: e.message }, e.status);
      console.error(e);
      return json({ erro: 'Erro interno. Tente de novo.' }, 500);
    }
  };
}

/** Converte "1.234,56" / "1234.56" / número em número. */
export function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[R$\s]/g, '');
  if (/,\d{1,2}$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.')) || 0;
  return Number(s.replace(/,/g, '')) || 0;
}

export const competenciaValida = (c) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(c || ''));
