// /api/setup — cria as tabelas e o primeiro administrador.
// Só funciona com a chave SETUP_KEY (variável da Netlify) e enquanto não existir nenhum usuário.
import crypto from 'node:crypto';
import { q, one, HttpError } from '../lib/db.mjs';
import { json, roteador } from '../lib/http.mjs';
import { hashSenha, senhaForte } from '../lib/security.mjs';
import { semearUnidade } from '../lib/seed.mjs';
import SCHEMA from '../lib/schema.mjs';

export const lerSchema = () => SCHEMA;

export async function aplicarSchema() {
  const sql = lerSchema().replace(/--[^\n]*\n/g, '\n');
  for (const cmd of sql.split(';').map((s) => s.trim()).filter(Boolean)) await q(cmd);
}

function chaveOk(req) {
  const k = process.env.SETUP_KEY || '';
  const v = req.headers.get('x-setup-key') || '';
  return k.length >= 12 && v.length === k.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(v));
}

export default roteador([
  ['GET', '/api/setup', async () => {
    try {
      const r = await one('SELECT count(*)::int AS n FROM usuarios');
      return json({ instalado: r.n > 0 });
    } catch { return json({ instalado: false }); }
  }],
  ['POST', '/api/setup', async ({ req, body }) => {
    if (!chaveOk(req)) throw new HttpError(403, 'Chave de instalação inválida.');
    await aplicarSchema();
    const r = await one('SELECT count(*)::int AS n FROM usuarios');
    if (r.n > 0) return json({ ok: true, mensagem: 'Tabelas atualizadas. O sistema já tem usuários.' });
    const { empresa, cnpj, unidade, nome, email, senha } = body;
    if (!empresa || !unidade || !nome || !email) throw new HttpError(400, 'Preencha empresa, unidade, nome e e-mail.');
    if (!senhaForte(senha)) throw new HttpError(400, 'A senha precisa de 8 caracteres, com letras e números.');
    const e = await one('INSERT INTO empresas (nome, cnpj) VALUES ($1,$2) RETURNING id', [empresa, cnpj || null]);
    const u = await one(`INSERT INTO unidades (empresa_id, nome, gcom_marca, gcom_loja) VALUES ($1,$2,$3,$4) RETURNING id`,
      [e.id, unidade, body.gcom_marca || '88', body.gcom_loja || '3787']);
    const us = await one(`INSERT INTO usuarios (empresa_id, nome, email, senha_hash, papel) VALUES ($1,$2,$3,$4,'admin') RETURNING id`,
      [e.id, nome, String(email).trim().toLowerCase(), hashSenha(senha)]);
    await q('INSERT INTO usuario_unidades (usuario_id, unidade_id) VALUES ($1,$2)', [us.id, u.id]);
    await semearUnidade(u.id);
    return json({ ok: true, mensagem: 'Instalado. Entre com o e-mail e a senha cadastrados.' });
  }],
]);

export const config = { path: '/api/setup' };
