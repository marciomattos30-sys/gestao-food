// Acesso ao banco. Em produção: Neon (Netlify DB). Nos testes: PGlite em memória.
// conexao: pacote @netlify/database (variavel NETLIFY_DB_URL)

let _run = null;

/** Troca o executor (usado nos testes). fn(text, params) => Promise<rows[]> */
export function setExecutor(fn) { _run = fn; }

async function executor() { if (_run) return _run; const { getDatabase } = await import('@netlify/database'); let db; try { db = getDatabase(); } catch { throw new HttpError(500, 'Banco nao configurado. Crie o banco em Data & storage > Database.'); } _run = async (text, params = []) => (await db.pool.query(text, params)).rows; return _run; }

/** Consulta com parâmetros ($1, $2...). Retorna as linhas. */
export async function q(text, params = []) {
  const rows = await (await executor())(text, params);
  return Array.isArray(rows) ? rows : (rows?.rows ?? []);
}

export async function one(text, params = []) {
  const r = await q(text, params);
  return r[0] || null;
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
