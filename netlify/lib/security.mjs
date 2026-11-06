// Senhas, tokens, criptografia de segredos e TOTP (verificação em 2 etapas).
import crypto from 'node:crypto';

// ---------- Senhas (scrypt) ----------
export function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(senha, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}

export function confereSenha(senha, armazenado) {
  try {
    const [alg, s, h] = String(armazenado).split('$');
    if (alg !== 'scrypt') return false;
    const calc = crypto.scryptSync(senha, Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
    const esperado = Buffer.from(h, 'base64');
    return esperado.length === calc.length && crypto.timingSafeEqual(calc, esperado);
  } catch { return false; }
}

/** Regra mínima: 8+ caracteres, com letra e número. */
export function senhaForte(s) {
  return typeof s === 'string' && s.length >= 8 && /[A-Za-z]/.test(s) && /\d/.test(s);
}

// ---------- Tokens ----------
export const novoToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// ---------- Criptografia de segredos (AES-256-GCM) ----------
function chave() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error('APP_SECRET ausente ou curto (mínimo 32 caracteres).');
  return crypto.createHash('sha256').update(s).digest();
}
export function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const enc = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}
export function decifrar(pacote) {
  const [v, iv, tag, enc] = String(pacote).split('.');
  if (v !== 'v1') throw new Error('formato inválido');
  const d = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}

// ---------- TOTP (RFC 6238, compatível com Google/Microsoft Authenticator) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function novoSegredoTotp() {
  const bytes = crypto.randomBytes(20);
  let bits = '', out = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function base32Decode(s) {
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const v = B32.indexOf(ch); if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export function codigoTotp(segredo, passo = Math.floor(Date.now() / 30000)) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(passo));
  const h = crypto.createHmac('sha1', base32Decode(segredo)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}
/** Aceita o código atual e o vizinho (±30 s) por diferença de relógio. */
export function confereTotp(segredo, codigo) {
  const c = String(codigo || '').replace(/\D/g, '');
  if (c.length !== 6) return false;
  const p = Math.floor(Date.now() / 30000);
  return [p - 1, p, p + 1].some((x) => {
    const a = Buffer.from(codigoTotp(segredo, x)), b = Buffer.from(c);
    return crypto.timingSafeEqual(a, b);
  });
}
