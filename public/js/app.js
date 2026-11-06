// Gestão Food — entrada do app: login, 2 etapas, escolha de unidade, menu e rotas.
import { api, esc, aviso, tentar, $, $$, nomeMes } from './ui.js';

const PAGINAS = [
  { rota: 'painel', titulo: 'Visão geral', icone: '📊', area: 'painel', mod: './pages/painel.js' },
  { rota: 'fechamento', titulo: 'Fechamento da equipe', icone: '🧾', area: 'fechamento', mod: './pages/fechamento.js' },
  { rota: 'importar', titulo: 'Importar dados', icone: '⬆️', area: 'vendas', mod: './pages/importar.js' },
  { rota: 'financeiro', titulo: 'Financeiro e DRE', icone: '💰', area: 'financeiro', mod: './pages/financeiro.js' },
  { rota: 'equipe', titulo: 'Equipe', icone: '👥', area: 'equipe', mod: './pages/equipe.js' },
  { rota: 'cardapio', titulo: 'Cardápio e Chef', icone: '👨‍🍳', area: 'cardapio', mod: './pages/cardapio.js' },
  { rota: 'checklist', titulo: 'Checklist e documentos', icone: '✅', area: 'checklist', mod: './pages/checklist.js' },
  { rota: 'whatsapp', titulo: 'WhatsApp (Anota AI)', icone: '💬', area: 'whatsapp', mod: './pages/whatsapp.js' },
  { rota: 'config', titulo: 'Configurações', icone: '⚙️', area: null, mod: './pages/config.js' },
];

const mesAtual = () => { const d = new Date(); d.setMonth(d.getMonth() - (d.getDate() < 10 ? 1 : 0)); return d.toISOString().slice(0, 7); };
export const estado = { eu: null, competencia: localStorage.getItem('gf_mes') || mesAtual() };
const pode = (area) => !area || estado.eu.permissoes.includes('*') || estado.eu.permissoes.includes(area);
const app = () => $('#app');

// ---------------- Telas de acesso ----------------
const marca = `<div class="hero"><div><span class="chip">Chef · IA</span><h1>Gestão Food</h1><p>Cardápio, equipe, delivery e resultados da sua operação em um só lugar.</p></div>
  <ul><li>Vendas da loja (Gcom) + delivery (Anota AI)</li><li>Fechamento de funcionários em minutos</li><li>DRE no padrão da franquia</li><li>Fichas e receitas com o Chef por voz</li></ul><small>Instale como app no celular e no computador</small></div>`;

function telaAcesso(html) { app().innerHTML = `<div class="acesso">${marca}<div class="form">${html}</div></div>`; }

async function telaLogin(msg = '') {
  telaAcesso(`<div class="passos"><b>● Acesso</b> · ○ Código · ○ Unidade</div><h2>Entrar</h2>
    <p class="mut">Use o e-mail cadastrado pelo administrador da sua empresa.</p>
    ${msg ? `<p class="alerta">${esc(msg)}</p>` : ''}
    <form id="f"><label>E-mail<input name="email" type="email" autocomplete="username" required></label>
    <label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>
    <label class="linha"><input type="checkbox" name="manter"> Manter conectado neste aparelho</label>
    <button class="btn">Entrar</button></form>
    <button class="btn sec" id="instalar" hidden>📲 Instalar o app</button>
    <p class="mut peq">🔒 Conexão segura · após 5 tentativas erradas o acesso é bloqueado por 15 minutos.<br>Esqueceu a senha? Peça ao administrador para gerar uma nova.</p>`);
  ligarInstalar();
  $('#f').onsubmit = (e) => { e.preventDefault(); const b = e.submitter; tentar(async () => {
    const f = new FormData(e.target);
    const r = await api('POST', '/api/auth/login', { email: f.get('email'), senha: f.get('senha'), manter: !!f.get('manter') });
    r.etapa === '2fa' ? telaCodigo() : iniciar();
  }, b); };
}

function telaCodigo() {
  telaAcesso(`<div class="passos">✓ Acesso · <b>● Código</b> · ○ Unidade</div><h2>Código de segurança</h2>
    <p class="mut">Abra o app autenticador (Google ou Microsoft Authenticator) e digite o código de 6 dígitos.</p>
    <form id="f"><input name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="otp" required autofocus>
    <label class="linha"><input type="checkbox" name="confiar"> Confiar neste aparelho por 30 dias</label>
    <button class="btn">Confirmar</button></form><p class="mut peq">Perdeu o celular? Peça ao administrador para refazer a verificação.</p>`);
  $('#f').onsubmit = (e) => { e.preventDefault(); tentar(async () => {
    const f = new FormData(e.target);
    await api('POST', '/api/auth/2fa', { codigo: f.get('codigo'), confiar: !!f.get('confiar') });
    iniciar();
  }, e.submitter); };
}

async function telaConfigurar2fa() {
  const r = await api('POST', '/api/auth/2fa/iniciar');
  telaAcesso(`<h2>Ative a verificação em 2 etapas</h2>
    <p class="mut">Obrigatória para Administrador e Gerente (quem vê DRE, folha e dados da equipe).</p>
    <ol class="mut"><li>Instale o Google Authenticator ou o Microsoft Authenticator no celular.</li><li>Leia o QR code abaixo (ou digite a chave).</li><li>Digite o código de 6 dígitos que aparecer.</li></ol>
    <div id="qr" class="qr"></div><p class="peq">Chave: <code>${esc(r.segredo.match(/.{1,4}/g).join(' '))}</code></p>
    <form id="f"><input name="codigo" inputmode="numeric" maxlength="6" class="otp" required><button class="btn">Ativar</button></form>`);
  try {
    if (!window.QRCode) await new Promise((ok, err) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; s.onload = ok; s.onerror = err; document.head.appendChild(s); });
    new window.QRCode($('#qr'), { text: r.url, width: 180, height: 180 });
  } catch { $('#qr').innerHTML = '<p class="mut">Digite a chave no app autenticador.</p>'; }
  $('#f').onsubmit = (e) => { e.preventDefault(); tentar(async () => {
    await api('POST', '/api/auth/2fa/ativar', { codigo: new FormData(e.target).get('codigo') });
    aviso('Verificação em 2 etapas ativada.'); iniciar();
  }, e.submitter); };
}

function telaTrocarSenha() {
  telaAcesso(`<h2>Crie a sua senha</h2><p class="mut">A senha atual é provisória. Crie uma nova com pelo menos 8 caracteres, letras e números.</p>
    <form id="f"><label>Senha provisória<input name="atual" type="password" required></label>
    <label>Nova senha<input name="nova" type="password" minlength="8" autocomplete="new-password" required></label>
    <button class="btn">Salvar</button></form>`);
  $('#f').onsubmit = (e) => { e.preventDefault(); tentar(async () => {
    const f = new FormData(e.target);
    await api('POST', '/api/auth/senha', { atual: f.get('atual'), nova: f.get('nova') });
    aviso('Senha alterada.'); iniciar();
  }, e.submitter); };
}

function telaUnidade() {
  const u = estado.eu;
  telaAcesso(`<div class="passos">✓ Acesso · ✓ Código · <b>● Unidade</b></div><h2>Olá, ${esc(u.usuario.nome.split(' ')[0])}</h2>
    <p class="mut">Escolha a unidade para continuar</p><div class="unidades">${u.unidades.map((x) => `<button class="uni" data-id="${x.id}"><b>${esc(x.nome)}</b><span>›</span></button>`).join('') || '<p class="alerta">Você ainda não tem acesso a nenhuma unidade. Fale com o administrador.</p>'}</div>
    ${u.ultimo_acesso ? `<p class="mut peq">Último acesso: ${new Date(u.ultimo_acesso.em).toLocaleString('pt-BR')}</p>` : ''}`);
  $$('.uni').forEach((b) => (b.onclick = () => tentar(async () => { await api('POST', '/api/auth/unidade', { unidade_id: +b.dataset.id }); iniciar(); }, b)));
}

async function telaInstalacao() {
  telaAcesso(`<h2>Instalação</h2><p class="mut">Primeiro acesso: cria as tabelas e o administrador. Use a chave SETUP_KEY configurada na Netlify.</p>
    <form id="f"><label>Chave de instalação<input name="chave" type="password" required></label>
    <label>Empresa<input name="empresa" value="Rei do Mate" required></label><label>CNPJ<input name="cnpj"></label>
    <label>Primeira unidade<input name="unidade" value="Bradesco Matriz" required></label>
    <label>Seu nome<input name="nome" required></label><label>Seu e-mail<input name="email" type="email" required></label>
    <label>Senha (8+ caracteres, letras e números)<input name="senha" type="password" minlength="8" required></label>
    <button class="btn">Instalar</button></form>`);
  $('#f').onsubmit = (e) => { e.preventDefault(); tentar(async () => {
    const f = Object.fromEntries(new FormData(e.target));
    const r = await fetch('/api/setup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-gf': '1', 'x-setup-key': f.chave }, body: JSON.stringify(f) });
    const d = await r.json(); if (!r.ok) throw new Error(d.erro);
    aviso(d.mensagem); telaLogin();
  }, e.submitter); };
}

// ---------------- Instalação do app (PWA) ----------------
let promptInstalar = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); promptInstalar = e; ligarInstalar(); });
function ligarInstalar() {
  const b = $('#instalar'); if (!b || !promptInstalar) return;
  b.hidden = false; b.onclick = async () => { promptInstalar.prompt(); promptInstalar = null; b.hidden = true; };
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ---------------- App logado ----------------
function casca() {
  const u = estado.eu, un = u.unidades.find((x) => x.id === u.unidade_id);
  const menu = PAGINAS.filter((p) => pode(p.area));
  app().innerHTML = `<header class="topo"><button class="menu-btn" aria-label="Menu">☰</button><b>Gestão Food</b><span class="un">${esc(un?.nome || '')}</span><span class="sp"></span>
      <input type="month" id="mes" value="${estado.competencia}" aria-label="Mês"><span class="quem">${esc(u.usuario.nome.split(' ')[0])}</span><button class="sair" title="Sair">Sair</button></header>
    <div class="corpo"><nav class="lateral">${menu.map((p) => `<a href="#/${p.rota}" data-r="${p.rota}"><span>${p.icone}</span>${esc(p.titulo)}</a>`).join('')}
      ${u.unidades.length > 1 ? '<a href="#" id="troca-un"><span>🏬</span>Trocar unidade</a>' : ''}</nav>
    <main id="pagina"></main></div>`;
  $('.sair').onclick = async () => { await api('POST', '/api/auth/logout', {}).catch(() => {}); estado.eu = null; telaLogin(); };
  $('.menu-btn').onclick = () => document.body.classList.toggle('menu-aberto');
  $('#mes').onchange = (e) => { if (e.target.value) { estado.competencia = e.target.value; localStorage.setItem('gf_mes', e.target.value); rota(); } };
  const t = $('#troca-un'); if (t) t.onclick = (e) => { e.preventDefault(); telaUnidade(); };
}

async function rota() {
  if (!estado.eu) return;
  const nome = (location.hash.replace('#/', '') || '').split('?')[0];
  const disponiveis = PAGINAS.filter((p) => pode(p.area));
  const p = disponiveis.find((x) => x.rota === nome) || disponiveis[0];
  if (!$('#pagina')) casca();
  document.body.classList.remove('menu-aberto');
  $$('.lateral a').forEach((a) => a.classList.toggle('on', a.dataset.r === p.rota));
  const el = $('#pagina');
  el.innerHTML = `<div class="carregando">Carregando…</div>`;
  document.title = `${p.titulo} · Gestão Food`;
  try {
    const m = await import(p.mod);
    await m.render(el, { competencia: estado.competencia, nomeMes: nomeMes(estado.competencia), eu: estado.eu, pode });
  } catch (e) {
    el.innerHTML = `<div class="vazio"><p>${esc(e.message || 'Não foi possível abrir esta tela.')}</p></div>`;
  }
}

async function iniciar() {
  try {
    estado.eu = await api('GET', '/api/auth/me');
  } catch (e) {
    if (e.status === 401) {
      try { const s = await (await fetch('/api/setup')).json(); if (!s.instalado) return telaInstalacao(); } catch {}
      return /código/.test(e.message) ? telaCodigo() : telaLogin();
    }
    return telaLogin(e.message);
  }
  if (estado.eu.usuario.trocar_senha) return telaTrocarSenha();
  if (estado.eu.precisa_configurar_2fa) return telaConfigurar2fa();
  if (!estado.eu.unidade_id) return telaUnidade();
  casca(); rota();
}

window.addEventListener('hashchange', rota);
window.addEventListener('gf:sair', () => { estado.eu = null; telaLogin('Sua sessão terminou. Entre novamente.'); });
iniciar();
