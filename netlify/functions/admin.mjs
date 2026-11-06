// /api/admin/* — usuários, unidades e empresa (somente Administrador).
import { q, one, HttpError } from '../lib/db.mjs';
import { json, roteador } from '../lib/http.mjs';
import { exigir, registrar } from '../lib/auth.mjs';
import { hashSenha, novoToken } from '../lib/security.mjs';
import { semearUnidade } from '../lib/seed.mjs';

const admin = (req) => exigir(req, 'admin', { unidade: false });
const senhaProvisoria = () => novoToken().replace(/[^A-Za-z0-9]/g, '').slice(0, 10) + '7a';

export default roteador([
  ['GET', '/api/admin/usuarios', async ({ req }) => {
    const s = await admin(req);
    return json(await q(`SELECT u.id, u.nome, u.email, u.papel, u.ativo, u.totp_ativo,
        COALESCE(array_agg(uu.unidade_id) FILTER (WHERE uu.unidade_id IS NOT NULL), '{}') AS unidades
      FROM usuarios u LEFT JOIN usuario_unidades uu ON uu.usuario_id=u.id
      WHERE u.empresa_id=$1 GROUP BY u.id ORDER BY u.nome`, [s.empresa_id]));
  }],
  ['POST', '/api/admin/usuarios', async ({ req, body }) => {
    const s = await admin(req);
    if (!body.nome || !body.email) throw new HttpError(400, 'Informe nome e e-mail.');
    if (!['admin', 'gerente', 'equipe'].includes(body.papel)) throw new HttpError(400, 'Nível inválido.');
    const senha = senhaProvisoria();
    let u;
    try {
      u = await one(`INSERT INTO usuarios (empresa_id, nome, email, senha_hash, papel, trocar_senha) VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
        [s.empresa_id, body.nome, String(body.email).trim().toLowerCase(), hashSenha(senha), body.papel]);
    } catch { throw new HttpError(400, 'Este e-mail já está cadastrado.'); }
    for (const un of body.unidades || []) await q('INSERT INTO usuario_unidades VALUES ($1,$2) ON CONFLICT DO NOTHING', [u.id, Number(un)]);
    await registrar(req, 'usuario_criado', { usuario_id: s.id, email: s.email, detalhe: body.email });
    return json({ ok: true, senha_provisoria: senha });
  }],
  ['PUT', '/api/admin/usuarios/:id', async ({ req, params, body }) => {
    const s = await admin(req);
    const id = Number(params.id);
    const alvo = await one('SELECT id FROM usuarios WHERE id=$1 AND empresa_id=$2', [id, s.empresa_id]);
    if (!alvo) throw new HttpError(404, 'Usuário não encontrado.');
    if (id === s.id && (body.ativo === false || (body.papel && body.papel !== 'admin'))) throw new HttpError(400, 'Você não pode tirar o seu próprio acesso de administrador.');
    if (body.papel && !['admin', 'gerente', 'equipe'].includes(body.papel)) throw new HttpError(400, 'Nível inválido.');
    await q('UPDATE usuarios SET nome=COALESCE($2,nome), papel=COALESCE($3,papel), ativo=COALESCE($4,ativo) WHERE id=$1',
      [id, body.nome ?? null, body.papel ?? null, body.ativo ?? null]);
    if (Array.isArray(body.unidades)) {
      await q('DELETE FROM usuario_unidades WHERE usuario_id=$1', [id]);
      for (const un of body.unidades) await q('INSERT INTO usuario_unidades VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, Number(un)]);
    }
    if (body.ativo === false) await q('DELETE FROM sessoes WHERE usuario_id=$1', [id]);
    return json({ ok: true });
  }],
  ['POST', '/api/admin/usuarios/:id/senha', async ({ req, params }) => {
    const s = await admin(req);
    const senha = senhaProvisoria();
    const r = await q('UPDATE usuarios SET senha_hash=$3, trocar_senha=true, tentativas=0, bloqueado_ate=NULL WHERE id=$1 AND empresa_id=$2 RETURNING id',
      [Number(params.id), s.empresa_id, hashSenha(senha)]);
    if (!r.length) throw new HttpError(404, 'Usuário não encontrado.');
    await q('DELETE FROM sessoes WHERE usuario_id=$1', [Number(params.id)]);
    return json({ ok: true, senha_provisoria: senha });
  }],
  ['POST', '/api/admin/usuarios/:id/reset-2fa', async ({ req, params }) => {
    const s = await admin(req);
    await q('UPDATE usuarios SET totp_ativo=false, totp_secret=NULL WHERE id=$1 AND empresa_id=$2', [Number(params.id), s.empresa_id]);
    await q('DELETE FROM aparelhos_confiaveis WHERE usuario_id=$1', [Number(params.id)]);
    return json({ ok: true });
  }],

  ['GET', '/api/admin/unidades', async ({ req }) => {
    const s = await admin(req);
    return json(await q('SELECT * FROM unidades WHERE empresa_id=$1 ORDER BY nome', [s.empresa_id]));
  }],
  ['POST', '/api/admin/unidades', async ({ req, body }) => {
    const s = await admin(req);
    if (!body.nome) throw new HttpError(400, 'Informe o nome da unidade.');
    const u = await one('INSERT INTO unidades (empresa_id, nome, gcom_marca, gcom_loja) VALUES ($1,$2,$3,$4) RETURNING id',
      [s.empresa_id, body.nome, body.gcom_marca || null, body.gcom_loja || null]);
    await semearUnidade(u.id);
    return json({ ok: true, id: u.id });
  }],
  ['PUT', '/api/admin/unidades/:id', async ({ req, params, body }) => {
    const s = await admin(req);
    await q(`UPDATE unidades SET nome=COALESCE($3,nome), gcom_marca=COALESCE($4,gcom_marca), gcom_loja=COALESCE($5,gcom_loja),
             meta_cmv=COALESCE($6,meta_cmv) WHERE id=$1 AND empresa_id=$2`,
      [Number(params.id), s.empresa_id, body.nome ?? null, body.gcom_marca ?? null, body.gcom_loja ?? null, body.meta_cmv ?? null]);
    return json({ ok: true });
  }],

  ['GET', '/api/admin/empresa', async ({ req }) => {
    const s = await admin(req);
    return json(await one('SELECT * FROM empresas WHERE id=$1', [s.empresa_id]));
  }],
  ['PUT', '/api/admin/empresa', async ({ req, body }) => {
    const s = await admin(req);
    await q('UPDATE empresas SET nome=COALESCE($2,nome), cnpj=$3, ie=$4, endereco=$5 WHERE id=$1',
      [s.empresa_id, body.nome ?? null, body.cnpj ?? null, body.ie ?? null, body.endereco ?? null]);
    return json({ ok: true });
  }],
]);

export const config = { path: '/api/admin/*' };
