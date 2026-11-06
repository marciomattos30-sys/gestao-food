// /api/auth/* — login, 2 etapas, unidades, logout, troca de senha.
import { q, one, HttpError } from '../lib/db.mjs';
import { json, cookie, lerCookie, roteador, infoCliente } from '../lib/http.mjs';
import { confereSenha, hashSenha, senhaForte, novoToken, sha256, novoSegredoTotp, confereTotp, cifrar, decifrar } from '../lib/security.mjs';
import { COOKIE, COOKIE_APARELHO, sessao, registrar, PERMISSOES } from '../lib/auth.mjs';

const MAX_TENTATIVAS = 5;
const BLOQUEIO_MIN = 15;
const DIAS_APARELHO = 30;

async function criarSessao(req, usuario, etapa, manter) {
  const token = novoToken();
  const horas = etapa === '2fa' ? 0.25 : (manter ? 24 * 30 : 12);
  const { ip, ua } = infoCliente(req);
  const unidades = await unidadesDo(usuario);
  const unidade_id = unidades.length === 1 ? unidades[0].id : null;
  await q(`INSERT INTO sessoes (token_hash, usuario_id, unidade_id, etapa, expira_em, ip, ua)
           VALUES ($1,$2,$3,$4, now() + ($5 || ' hours')::interval, $6, $7)`,
    [sha256(token), usuario.id, unidade_id, etapa, String(horas), ip, ua]);
  return cookie(COOKIE, token, { maxAge: Math.round(horas * 3600) });
}

async function unidadesDo(u) {
  if (u.papel === 'admin') return q('SELECT id, nome FROM unidades WHERE empresa_id = $1 ORDER BY nome', [u.empresa_id]);
  return q(`SELECT un.id, un.nome FROM unidades un JOIN usuario_unidades uu ON uu.unidade_id = un.id
             WHERE uu.usuario_id = $1 ORDER BY un.nome`, [u.id]);
}

/** 2 etapas obrigatória para Administrador e Gerente. */
const exige2fa = (u) => u.papel === 'admin' || u.papel === 'gerente';

async function aparelhoConfiavel(req, usuario_id) {
  const t = lerCookie(req, COOKIE_APARELHO);
  if (!t) return false;
  return !!(await one('SELECT 1 FROM aparelhos_confiaveis WHERE token_hash=$1 AND usuario_id=$2 AND expira_em > now()', [sha256(t), usuario_id]));
}

async function perfil(s) {
  const u = await one('SELECT id, nome, email, papel, empresa_id, totp_ativo, trocar_senha FROM usuarios WHERE id=$1', [s.id]);
  const unidades = await unidadesDo(u);
  const ultimo = await one(`SELECT em, ip FROM acessos_log WHERE usuario_id=$1 AND evento='login' ORDER BY em DESC OFFSET 1 LIMIT 1`, [u.id]);
  return {
    usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel, totp_ativo: u.totp_ativo, trocar_senha: u.trocar_senha },
    unidades, unidade_id: s.unidade_id, permissoes: PERMISSOES[u.papel], ultimo_acesso: ultimo,
    precisa_configurar_2fa: exige2fa(u) && !u.totp_ativo,
  };
}

export default roteador([
  ['POST', '/api/auth/login', async ({ req, body }) => {
    const email = String(body.email || '').trim().toLowerCase();
    const senha = String(body.senha || '');
    const u = await one('SELECT * FROM usuarios WHERE email=$1', [email]);
    const generico = new HttpError(401, 'E-mail ou senha incorretos.');
    if (!u || !u.ativo) { await registrar(req, 'login_falhou', { email }); throw generico; }
    if (u.bloqueado_ate && new Date(u.bloqueado_ate) > new Date()) {
      throw new HttpError(429, `Acesso bloqueado por tentativas erradas. Tente após ${new Date(u.bloqueado_ate).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}.`);
    }
    if (!confereSenha(senha, u.senha_hash)) {
      const n = (u.tentativas || 0) + 1;
      if (n >= MAX_TENTATIVAS) {
        await q(`UPDATE usuarios SET tentativas=0, bloqueado_ate = now() + interval '${BLOQUEIO_MIN} minutes' WHERE id=$1`, [u.id]);
        await registrar(req, 'bloqueado', { usuario_id: u.id, email });
      } else {
        await q('UPDATE usuarios SET tentativas=$2 WHERE id=$1', [u.id, n]);
      }
      await registrar(req, 'login_falhou', { usuario_id: u.id, email });
      throw generico;
    }
    await q('UPDATE usuarios SET tentativas=0, bloqueado_ate=NULL WHERE id=$1', [u.id]);
    const precisa2fa = u.totp_ativo && !(await aparelhoConfiavel(req, u.id));
    const set = await criarSessao(req, u, precisa2fa ? '2fa' : 'ok', !!body.manter);
    if (!precisa2fa) await registrar(req, 'login', { usuario_id: u.id, email });
    return json({ etapa: precisa2fa ? '2fa' : 'ok' }, 200, { 'set-cookie': set });
  }],

  ['POST', '/api/auth/2fa', async ({ req, body }) => {
    const s = await sessao(req, { aceitar2fa: true });
    if (s.etapa !== '2fa') return json({ etapa: 'ok' });
    const u = await one('SELECT totp_secret FROM usuarios WHERE id=$1', [s.id]);
    if (!u?.totp_secret || !confereTotp(decifrar(u.totp_secret), body.codigo)) {
      await registrar(req, '2fa_falhou', { usuario_id: s.id, email: s.email });
      throw new HttpError(401, 'Código incorreto.');
    }
    await q(`UPDATE sessoes SET etapa='ok', expira_em = now() + interval '12 hours' WHERE token_hash=$1`, [s.token_hash]);
    const headers = new Headers({ 'content-type': 'application/json' });
    if (body.confiar) {
      const t = novoToken();
      await q(`INSERT INTO aparelhos_confiaveis (token_hash, usuario_id, expira_em) VALUES ($1,$2, now() + interval '${DIAS_APARELHO} days')`, [sha256(t), s.id]);
      headers.append('set-cookie', cookie(COOKIE_APARELHO, t, { maxAge: DIAS_APARELHO * 86400 }));
    }
    await registrar(req, 'login', { usuario_id: s.id, email: s.email, detalhe: '2fa' });
    return new Response(JSON.stringify({ etapa: 'ok' }), { headers });
  }],

  ['GET', '/api/auth/me', async ({ req }) => json(await perfil(await sessao(req)))],

  ['POST', '/api/auth/unidade', async ({ req, body }) => {
    const s = await sessao(req);
    const lista = await unidadesDo(s);
    const id = Number(body.unidade_id);
    if (!lista.some((u) => u.id === id)) throw new HttpError(403, 'Sem acesso a esta unidade.');
    await q('UPDATE sessoes SET unidade_id=$2 WHERE token_hash=$1', [s.token_hash, id]);
    return json({ ok: true });
  }],

  ['POST', '/api/auth/logout', async ({ req, body }) => {
    const t = lerCookie(req, COOKIE);
    if (t) {
      const s = await one('SELECT usuario_id FROM sessoes WHERE token_hash=$1', [sha256(t)]);
      if (body.todos && s) await q('DELETE FROM sessoes WHERE usuario_id=$1', [s.usuario_id]);
      else await q('DELETE FROM sessoes WHERE token_hash=$1', [sha256(t)]);
    }
    return json({ ok: true }, 200, { 'set-cookie': cookie(COOKIE, '', { maxAge: 0 }) });
  }],

  ['POST', '/api/auth/senha', async ({ req, body }) => {
    const s = await sessao(req);
    const u = await one('SELECT senha_hash FROM usuarios WHERE id=$1', [s.id]);
    if (!confereSenha(String(body.atual || ''), u.senha_hash)) throw new HttpError(400, 'Senha atual incorreta.');
    if (!senhaForte(body.nova)) throw new HttpError(400, 'A nova senha precisa de 8 caracteres, com letras e números.');
    await q('UPDATE usuarios SET senha_hash=$2, trocar_senha=false WHERE id=$1', [s.id, hashSenha(body.nova)]);
    await q('DELETE FROM sessoes WHERE usuario_id=$1 AND token_hash<>$2', [s.id, s.token_hash]);
    await registrar(req, 'senha_alterada', { usuario_id: s.id, email: s.email });
    return json({ ok: true });
  }],

  // Configurar o app autenticador: gera o segredo e confirma com o 1º código.
  ['POST', '/api/auth/2fa/iniciar', async ({ req }) => {
    const s = await sessao(req);
    const segredo = novoSegredoTotp();
    await q('UPDATE usuarios SET totp_secret=$2, totp_ativo=false WHERE id=$1', [s.id, cifrar(segredo)]);
    const emissor = encodeURIComponent('Gestão Food');
    const url = `otpauth://totp/${emissor}:${encodeURIComponent(s.email)}?secret=${segredo}&issuer=${emissor}`;
    return json({ segredo, url });
  }],
  ['POST', '/api/auth/2fa/ativar', async ({ req, body }) => {
    const s = await sessao(req);
    const u = await one('SELECT totp_secret FROM usuarios WHERE id=$1', [s.id]);
    if (!u?.totp_secret || !confereTotp(decifrar(u.totp_secret), body.codigo)) throw new HttpError(400, 'Código incorreto. Confira a hora do celular e tente de novo.');
    await q('UPDATE usuarios SET totp_ativo=true WHERE id=$1', [s.id]);
    await registrar(req, '2fa_ativado', { usuario_id: s.id, email: s.email });
    return json({ ok: true });
  }],

  ['GET', '/api/auth/acessos', async ({ req }) => {
    const s = await sessao(req);
    const rows = s.papel === 'admin'
      ? await q(`SELECT l.em, l.evento, l.email, l.ip, l.ua FROM acessos_log l JOIN usuarios u ON u.id=l.usuario_id
                  WHERE u.empresa_id=$1 ORDER BY l.em DESC LIMIT 200`, [s.empresa_id])
      : await q('SELECT em, evento, email, ip, ua FROM acessos_log WHERE usuario_id=$1 ORDER BY em DESC LIMIT 50', [s.id]);
    return json(rows);
  }],
]);

export const config = { path: '/api/auth/*' };
