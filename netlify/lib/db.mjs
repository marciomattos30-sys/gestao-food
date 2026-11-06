// Acesso ao banco. Em produção: Neon (Netlify DB). Nos testes: PGlite em memória.
import { neon } from '@neondatabase/serverless';

let _run = null;

/** Troca o executor (usado nos testes). fn(text, params) => Promise<rows[]> */
export function setExecutor(fn) { _run = fn; }

function executor() {
  if (_run) return _run;
  const url = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new HttpError(500, 'Banco não configurado (NETLIFY_DATABASE_URL).');
  const sql = neon(url);
  _run = (text, params = []) => sql.query(text, params);
  return _run;
}

/** Consulta com parâmetros ($1, $2...). Retorna as linhas. */
export async function q(text, params = []) {
  const rows = await executor()(text, params);
  return Array.isArray(rows) ? rows : (rows?.rows ?? []);
}

export async function one(text, params = []) {
  const r = await q(text, params);
  return r[0] || null;
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
