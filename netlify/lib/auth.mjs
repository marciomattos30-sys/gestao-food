// Sessão, papéis e registro de acessos.
import { q, one, HttpError } from './db.mjs';
import { lerCookie, infoCliente } from './http.mjs';
import { sha256 } from './security.mjs';

export const COOKIE = 'gf_s';
export const COOKIE_APARELHO = 'gf_d';

/** Quem pode o quê. Regras aplicadas no servidor (a tela só esconde). */
export const PERMISSOES = {
  admin:   ['*'],
  gerente: ['painel', 'equipe', 'fechamento', 'vendas', 'cardapio', 'chef', 'financeiro', 'checklist', 'documentos', 'whatsapp'],
  equipe:  ['cardapio', 'chef', 'checklist', 'whatsapp'],
};
export const pode = (papel, area) => {
  const p = PERMISSOES[papel] || [];
  return p.includes('*') || p.includes(area);
};

export async function registrar(req, evento, { usuario_id = null, email = null, detalhe = null } = {}) {
  const { ip, ua } = infoCliente(req);
  try {
    await q('INSERT INTO acessos_log (usuario_id, email, evento, detalhe, ip, ua) VALUES ($1,$2,$3,$4,$5,$6)',
      [usuario_id, email, evento, detalhe, ip, ua]);
  } catch (e) { console.error('log', e); }
}

/** Lê a sessão do cookie. etapa: 'ok' (logado) ou '2fa' (falta o código). */
export async function sessao(req, { aceitar2fa = false } = {}) {
  const t = lerCookie(req, COOKIE);
  if (!t) throw new HttpError(401, 'Entre novamente.');
  const s = await one(
    `SELECT s.token_hash, s.unidade_id, s.etapa, u.id, u.nome, u.email, u.papel, u.empresa_id, u.ativo,
            u.totp_ativo, u.trocar_senha
       FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = $1 AND s.expira_em > now()`, [sha256(t)]);
  if (!s || !s.ativo) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  if (s.etapa !== 'ok' && !aceitar2fa) throw new HttpError(401, 'Confirme o código de segurança.');
  return s;
}

/**
 * Exige login completo, permissão na área e (opcionalmente) uma unidade escolhida
 * à qual o usuário tenha acesso. Retorna { ...usuario, unidade_id }.
 */
export async function exigir(req, area, { unidade = true } = {}) {
  const s = await sessao(req);
  if (area && !pode(s.papel, area)) throw new HttpError(403, 'Sem permissão para esta área.');
  if (unidade) {
    if (!s.unidade_id) throw new HttpError(409, 'Escolha a unidade.');
    const ok = await one(
      `SELECT 1 FROM unidades un WHERE un.id = $1 AND un.empresa_id = $2
         AND ($3 = 'admin' OR EXISTS (SELECT 1 FROM usuario_unidades uu WHERE uu.usuario_id = $4 AND uu.unidade_id = un.id))`,
      [s.unidade_id, s.empresa_id, s.papel, s.id]);
    if (!ok) throw new HttpError(403, 'Sem acesso a esta unidade.');
  }
  return s;
}
