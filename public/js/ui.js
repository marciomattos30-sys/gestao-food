// Utilidades de tela: API, formatação, avisos, janelas e gráficos.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const n2 = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pct = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
export const dataBR = (d) => (d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('pt-BR') : '—');
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export const nomeMes = (c) => { const [a, m] = c.split('-'); return `${['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][+m - 1]}/${a}`; };

export class ErroApi extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export async function api(metodo, caminho, body) {
  const opt = { method: metodo, headers: { 'x-gf': '1' }, credentials: 'same-origin' };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['content-type'] = 'application/json'; }
  let r;
  try { r = await fetch(caminho, opt); } catch { throw new ErroApi(0, 'Sem conexão. Verifique a internet.'); }
  const d = (r.headers.get('content-type') || '').includes('json') ? await r.json() : null;
  if (!r.ok) {
    if (r.status === 401 && !caminho.startsWith('/api/auth/')) { window.dispatchEvent(new Event('gf:sair')); }
    throw new ErroApi(r.status, d?.erro || 'Algo deu errado.');
  }
  return d;
}

export function aviso(msg, tipo = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${tipo}`; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('vai'), 3200); setTimeout(() => el.remove(), 3800);
}

/** Janela (modal). Retorna o elemento do corpo; fechar() remove. */
export function janela(titulo, html, { largura = 560 } = {}) {
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  fundo.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="max-width:${largura}px"><div class="modal-cab"><b>${esc(titulo)}</b><button class="x" aria-label="Fechar">✕</button></div><div class="modal-corpo">${html}</div></div>`;
  const fechar = () => fundo.remove();
  fundo.addEventListener('click', (e) => { if (e.target === fundo || e.target.closest('.x')) fechar(); });
  document.body.appendChild(fundo);
  const corpo = fundo.querySelector('.modal-corpo');
  corpo.fechar = fechar;
  return corpo;
}

export async function tentar(fn, el) {
  if (el) el.disabled = true;
  try { return await fn(); } catch (e) { aviso(e.message || 'Erro', 'erro'); } finally { if (el) el.disabled = false; }
}

export const vazio = (msg, acao = '') => `<div class="vazio"><p>${msg}</p>${acao}</div>`;
export const tag = (txt, tipo = '') => `<span class="tag ${tipo}">${esc(txt)}</span>`;
export const kpi = (rot, val, sub = '', cls = '') => `<div class="k ${cls}"><small>${esc(rot)}</small><b>${val}</b>${sub ? `<i>${sub}</i>` : ''}</div>`;

// ---------------- Gráficos (SVG, com dica ao passar o mouse) ----------------
const NS = 'http://www.w3.org/2000/svg';
const E = (t, a, p) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); p && p.appendChild(e); return e; };
let tip;
function dica(el, txt) {
  if (!tip) { tip = document.createElement('div'); tip.id = 'tip'; document.body.appendChild(tip); }
  const mostra = (e) => { tip.textContent = txt; tip.style.display = 'block'; tip.style.left = Math.min(e.clientX + 12, innerWidth - 240) + 'px'; tip.style.top = (e.clientY - 34) + 'px'; };
  el.addEventListener('mousemove', mostra); el.addEventListener('touchstart', (e) => mostra(e.touches[0]), { passive: true });
  el.addEventListener('mouseleave', () => (tip.style.display = 'none'));
}
const largura = (alvo) => Math.max(320, Math.round(alvo.getBoundingClientRect().width) || 560);
const barraH = (x, y, w, h) => (w < 5 ? `M${x},${y}h${w}v${h}h${-w}z` : `M${x},${y}h${w - 4}a4 4 0 0 1 4 4v${h - 8}a4 4 0 0 1 -4 4h${-(w - 4)}z`);

/** Barras horizontais. linhas: [{rot, valor, dica, texto}] */
export function barrasH(alvo, linhas, { cor = 'var(--s0)', larguraRotulo = 150 } = {}) {
  alvo.innerHTML = '';
  if (!linhas.length) { alvo.innerHTML = '<p class="mut">Sem dados.</p>'; return; }
  const W = largura(alvo), rh = 26, H = linhas.length * rh + 4, mx = Math.max(...linhas.map((l) => l.valor), 1), pw = W - larguraRotulo - 90;
  const s = E('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, alvo);
  linhas.forEach((l, i) => {
    const y = i * rh + 2, w = Math.max(2, (l.valor / mx) * pw);
    E('text', { x: larguraRotulo - 8, y: y + rh / 2 + 4, 'text-anchor': 'end' }, s).textContent = l.rot.length > 24 ? l.rot.slice(0, 23) + '…' : l.rot;
    dica(E('path', { class: 'm', d: barraH(larguraRotulo, y + 5, w, rh - 10), fill: l.cor || cor }, s), l.dica || `${l.rot}: ${l.texto}`);
    E('text', { x: larguraRotulo + w + 6, y: y + rh / 2 + 4, class: 'lbl' }, s).textContent = l.texto;
  });
}

/** Colunas por período. pontos: [{rot, valor, dica, fraco}] */
export function colunas(alvo, pontos, { cor = 'var(--s0)', fmt = (v) => (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' } = {}) {
  alvo.innerHTML = '';
  if (!pontos.length) { alvo.innerHTML = '<p class="mut">Sem dados.</p>'; return; }
  const W = largura(alvo), H = 210, L = 48, B = 22, T = 12, mx = Math.max(...pontos.map((p) => p.valor), 1) * 1.1, bw = (W - L) / pontos.length;
  const s = E('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, alvo);
  for (let g = 0; g <= 3; g++) { const v = (mx / 3) * g, y = H - B - (v / mx) * (H - B - T); E('line', { x1: L, x2: W, y1: y, y2: y, stroke: 'var(--grade)' }, s); E('text', { x: L - 6, y: y + 4, 'text-anchor': 'end' }, s).textContent = fmt(v); }
  const passo = Math.ceil(pontos.length / Math.max(4, Math.floor(W / 45)));
  pontos.forEach((p, i) => {
    const h = Math.max(1, (p.valor / mx) * (H - B - T)), x = L + i * bw + bw * 0.18, w = Math.max(2, bw * 0.64);
    if (p.valor > 0) dica(E('path', { class: 'm', d: `M${x},${H - B}v${-(h - 4)}a4 4 0 0 1 4 -4h${w - 8}a4 4 0 0 1 4 4v${h - 4}z`, fill: p.cor || cor, 'fill-opacity': p.fraco ? 0.45 : 1 }, s), p.dica || `${p.rot}: ${p.valor}`);
    if (i % passo === 0) E('text', { x: x + w / 2, y: H - 6, 'text-anchor': 'middle' }, s).textContent = p.rot;
  });
}

/** Barras horizontais empilhadas. linhas: [{rot, partes:[{valor, cor, nome}], texto}] */
export function empilhadas(alvo, linhas, { larguraRotulo = 90 } = {}) {
  alvo.innerHTML = '';
  if (!linhas.length) { alvo.innerHTML = '<p class="mut">Sem dados.</p>'; return; }
  const W = largura(alvo), rh = 26, H = linhas.length * rh + 4, mx = Math.max(...linhas.map((l) => l.partes.reduce((a, p) => a + p.valor, 0)), 1), pw = W - larguraRotulo - 80;
  const s = E('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, alvo);
  linhas.forEach((l, i) => {
    const y = i * rh + 2; let x = larguraRotulo;
    E('text', { x: larguraRotulo - 8, y: y + rh / 2 + 4, 'text-anchor': 'end' }, s).textContent = l.rot;
    const partes = l.partes.filter((p) => p.valor > 0);
    partes.forEach((p, j) => {
      const w = (p.valor / mx) * pw, ultimo = j === partes.length - 1, gw = Math.max(1, w - (ultimo ? 0 : 2));
      dica(E('path', { class: 'm', d: ultimo ? barraH(x, y + 5, gw, rh - 10) : `M${x},${y + 5}h${gw}v${rh - 10}h${-gw}z`, fill: p.cor }, s), `${l.rot} · ${p.nome}: ${brl(p.valor)}`);
      x += w;
    });
    E('text', { x: x + 6, y: y + rh / 2 + 4, class: 'lbl' }, s).textContent = l.texto;
  });
}
