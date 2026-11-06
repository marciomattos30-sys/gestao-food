import { api, esc, aviso, tentar, janela, $, $$ } from '../ui.js';

const PAPEL = { admin: 'Administrador', gerente: 'Gerente', equipe: 'Equipe' };

export async function render(el, ctx) {
  const eu = ctx.eu, admin = eu.permissoes.includes('*');
  el.innerHTML = `<h1>Configurações</h1>
  <section class="c"><h3>Minha conta</h3><p>${esc(eu.usuario.nome)} · ${esc(eu.usuario.email)} · ${PAPEL[eu.usuario.papel]}</p>
    <p>Verificação em 2 etapas: ${eu.usuario.totp_ativo ? '<span class="st ok">ativa</span>' : '<span class="st pe">desligada</span>'}</p>
    <div class="acoes"><button class="btn sec" id="senha">Trocar senha</button><button class="btn sec" id="totp">${eu.usuario.totp_ativo ? 'Refazer' : 'Ativar'} verificação em 2 etapas</button>
      <button class="btn sec" id="todos">Sair de todos os aparelhos</button><button class="btn sec" id="hist">Histórico de acessos</button></div></section>
  ${admin ? `<section class="c"><h3>Usuários</h3><div id="us"></div><button class="btn" id="novo-u">+ Usuário</button></section>
    <section class="c"><h3>Unidades</h3><div id="un"></div><button class="btn sec" id="novo-un">+ Unidade</button></section>
    <section class="c"><h3>Empresa</h3><form id="emp" class="g3"></form></section>` : ''}
  <section class="c"><h3>Segurança</h3><ul class="mut peq"><li>Senhas guardadas só como código (ninguém consegue ler).</li><li>Acesso bloqueado por 15 minutos após 5 tentativas erradas.</li>
    <li>Administrador e Gerente usam verificação em 2 etapas.</li><li>Cada unidade só vê os próprios dados; DRE, folha e documentos só para Administrador e Gerente.</li></ul></section>`;

  $('#senha', el).onclick = () => {
    const c = janela('Trocar senha', `<form id="f"><label>Senha atual<input type="password" name="atual" required></label><label>Nova senha (8+, letras e números)<input type="password" name="nova" minlength="8" required></label><button class="btn">Salvar</button></form>`);
    c.querySelector('#f').onsubmit = (e) => { e.preventDefault(); tentar(async () => { await api('POST', '/api/auth/senha', Object.fromEntries(new FormData(e.target))); c.fechar(); aviso('Senha alterada.'); }, e.submitter); };
  };
  $('#totp', el).onclick = (e) => tentar(async () => {
    const r = await api('POST', '/api/auth/2fa/iniciar');
    const c = janela('Verificação em 2 etapas', `<p class="mut">Leia o QR code no Google/Microsoft Authenticator e digite o código.</p><div id="qr" class="qr"></div><p class="peq">Chave: <code>${esc(r.segredo)}</code></p>
      <form id="f"><input name="codigo" class="otp" inputmode="numeric" maxlength="6" required><button class="btn">Ativar</button></form>`);
    try { if (!window.QRCode) await new Promise((ok, er) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; s.onload = ok; s.onerror = er; document.head.appendChild(s); }); new window.QRCode(c.querySelector('#qr'), { text: r.url, width: 180, height: 180 }); } catch {}
    c.querySelector('#f').onsubmit = (ev) => { ev.preventDefault(); tentar(async () => { await api('POST', '/api/auth/2fa/ativar', Object.fromEntries(new FormData(ev.target))); c.fechar(); aviso('Ativada.'); location.reload(); }, ev.submitter); };
  }, e.target);
  $('#todos', el).onclick = (e) => tentar(async () => { if (!confirm('Encerrar todas as sessões, inclusive esta?')) return; await api('POST', '/api/auth/logout', { todos: true }); location.reload(); }, e.target);
  $('#hist', el).onclick = (e) => tentar(async () => {
    const l = await api('GET', '/api/auth/acessos');
    janela('Histórico de acessos', `<table class="tab">${l.map((x) => `<tr><td>${new Date(x.em).toLocaleString('pt-BR')}</td><td>${esc(x.evento)}</td><td>${esc(x.email || '')}</td><td class="mut peq">${esc(x.ip || '')}</td></tr>`).join('')}</table>`, { largura: 760 });
  }, e.target);

  if (!admin) return;
  const [us, uns, emp] = await Promise.all([api('GET', '/api/admin/usuarios'), api('GET', '/api/admin/unidades'), api('GET', '/api/admin/empresa')]);
  const nomeUn = Object.fromEntries(uns.map((u) => [u.id, u.nome]));
  $('#us', el).innerHTML = `<table class="tab"><tr><th>Nome</th><th>E-mail</th><th>Nível</th><th>Unidades</th><th>2 etapas</th><th></th></tr>${us.map((u) => `<tr class="${u.ativo ? '' : 'mut'}"><td>${esc(u.nome)}</td><td>${esc(u.email)}</td><td>${PAPEL[u.papel]}</td>
    <td>${u.papel === 'admin' ? 'todas' : u.unidades.map((i) => esc(nomeUn[i] || i)).join(', ')}</td><td>${u.totp_ativo ? '✓' : '—'}</td><td><button class="link" data-u="${u.id}">editar</button></td></tr>`).join('')}</table>`;
  $('#un', el).innerHTML = `<table class="tab"><tr><th>Unidade</th><th>Marca no Gcom</th><th>Loja no Gcom</th><th>Meta CMV</th><th></th></tr>${uns.map((u) => `<tr><td>${esc(u.nome)}</td><td>${esc(u.gcom_marca || '')}</td><td>${esc(u.gcom_loja || '')}</td><td>${u.meta_cmv}%</td><td><button class="link" data-un="${u.id}">editar</button></td></tr>`).join('')}</table>`;
  $('#emp', el).innerHTML = `<label>Razão social<input name="nome" value="${esc(emp.nome)}"></label><label>CNPJ<input name="cnpj" value="${esc(emp.cnpj || '')}"></label><label>Inscrição estadual<input name="ie" value="${esc(emp.ie || '')}"></label>
    <label style="grid-column:1/-1">Endereço<input name="endereco" value="${esc(emp.endereco || '')}"></label><button class="btn">Salvar empresa</button>`;
  $('#emp', el).onsubmit = (e) => { e.preventDefault(); tentar(async () => { await api('PUT', '/api/admin/empresa', Object.fromEntries(new FormData(e.target))); aviso('Empresa salva.'); }, e.submitter); };

  const recarregar = () => render(el, ctx);
  const formUsuario = (u) => {
    const c = janela(u ? u.nome : 'Novo usuário', `<form id="f"><label>Nome<input name="nome" value="${esc(u?.nome || '')}" required></label>
      ${u ? '' : '<label>E-mail<input name="email" type="email" required></label>'}<label>Nível<select name="papel">${Object.entries(PAPEL).map(([k, r]) => `<option value="${k}" ${k === u?.papel ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <p class="mut peq">Equipe: checklist, cardápio/Chef e WhatsApp. Gerente: tudo da unidade. Administrador: todas as unidades e usuários.</p>
      <fieldset><legend>Unidades</legend>${uns.map((x) => `<label class="linha"><input type="checkbox" name="un" value="${x.id}" ${u?.unidades?.includes(x.id) || (!u && uns.length === 1) ? 'checked' : ''}> ${esc(x.nome)}</label>`).join('')}</fieldset>
      ${u ? `<label class="linha"><input type="checkbox" name="ativo" ${u.ativo ? 'checked' : ''}> Acesso ativo</label>` : ''}
      <div class="acoes"><button class="btn">Salvar</button>${u ? '<button type="button" class="btn sec" id="rs">Gerar senha provisória</button><button type="button" class="btn sec" id="r2">Refazer 2 etapas</button>' : ''}</div></form>`);
    const mostrarSenha = (s) => janela('Senha provisória', `<p>Envie esta senha para a pessoa. Ela vai criar a própria senha no primeiro acesso.</p><p class="senha">${esc(s)}</p>
      <div class="acoes"><button class="btn" onclick="navigator.clipboard.writeText('${s}')">Copiar</button><a class="btn sec" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Seu acesso ao Gestão Food: ${location.origin}\nSenha provisória: ${s}`)}">Enviar no WhatsApp</a></div>`);
    c.querySelector('#f').onsubmit = (e) => { e.preventDefault(); tentar(async () => {
      const fd = new FormData(e.target);
      const dados = { nome: fd.get('nome'), papel: fd.get('papel'), unidades: fd.getAll('un').map(Number) };
      if (u) { await api('PUT', `/api/admin/usuarios/${u.id}`, { ...dados, ativo: !!fd.get('ativo') }); c.fechar(); recarregar(); }
      else { const r = await api('POST', '/api/admin/usuarios', { ...dados, email: fd.get('email') }); c.fechar(); mostrarSenha(r.senha_provisoria); recarregar(); }
    }, e.submitter); };
    if (u) {
      c.querySelector('#rs').onclick = (e) => tentar(async () => { const r = await api('POST', `/api/admin/usuarios/${u.id}/senha`); c.fechar(); mostrarSenha(r.senha_provisoria); }, e.target);
      c.querySelector('#r2').onclick = (e) => tentar(async () => { await api('POST', `/api/admin/usuarios/${u.id}/reset-2fa`); aviso('A pessoa vai configurar de novo no próximo acesso.'); }, e.target);
    }
  };
  $('#novo-u', el).onclick = () => formUsuario(null);
  $$('[data-u]', el).forEach((b) => (b.onclick = () => formUsuario(us.find((u) => u.id === +b.dataset.u))));
  const formUnidade = (u) => {
    const c = janela(u ? u.nome : 'Nova unidade', `<form id="f"><label>Nome<input name="nome" value="${esc(u?.nome || '')}" required></label><div class="g3">
      <label>Marca no Gcom (cardápio)<input name="gcom_marca" value="${esc(u?.gcom_marca || '88')}"></label><label>Loja no Gcom (id_etb)<input name="gcom_loja" value="${esc(u?.gcom_loja || '')}"></label>
      <label>Meta de CMV (%)<input name="meta_cmv" inputmode="decimal" value="${u?.meta_cmv ?? 33}"></label></div><button class="btn">Salvar</button></form>`);
    c.querySelector('#f').onsubmit = (e) => { e.preventDefault(); tentar(async () => {
      const f = Object.fromEntries(new FormData(e.target));
      u ? await api('PUT', `/api/admin/unidades/${u.id}`, f) : await api('POST', '/api/admin/unidades', f);
      c.fechar(); recarregar();
    }, e.submitter); };
  };
  $('#novo-un', el).onclick = () => formUnidade(null);
  $$('[data-un]', el).forEach((b) => (b.onclick = () => formUnidade(uns.find((u) => u.id === +b.dataset.un))));
}
