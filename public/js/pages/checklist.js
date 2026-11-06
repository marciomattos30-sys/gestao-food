import { api, esc, aviso, tentar, janela, kpi, dataBR, $, $$ } from '../ui.js';

export async function render(el, ctx) {
  const aba = (location.hash.match(/aba=(\w+)/) || [])[1] || 'hoje';
  const gerente = ctx.pode('financeiro');
  el.innerHTML = `<h1>Checklist e documentos</h1><nav class="abas"><a href="#/checklist?aba=hoje" class="${aba === 'hoje' ? 'on' : ''}">✅ Checklist do dia</a>
    ${gerente ? `<a href="#/checklist?aba=modelos" class="${aba === 'modelos' ? 'on' : ''}">📋 Modelos</a>` : ''}
    ${ctx.pode('documentos') ? `<a href="#/checklist?aba=docs" class="${aba === 'docs' ? 'on' : ''}">📁 Documentos da loja</a>` : ''}</nav><div id="cc"></div>`;
  const alvo = $('#cc', el), rec = () => render(el, ctx);
  if (aba === 'modelos' && gerente) return modelos(alvo, rec);
  if (aba === 'docs') return documentos(alvo, rec, gerente);
  return hoje(alvo, rec);
}

async function hoje(el, rec) {
  const d = await api('GET', '/api/checklist/hoje');
  const feitos = d.modelos.filter((m) => m.concluido_em).length;
  el.innerHTML = `<section class="kpis">${kpi('Checklists de hoje', `${feitos}/${d.modelos.length}`, dataBR(d.data), feitos === d.modelos.length ? 'destaque' : '')}
    ${kpi('Pendências abertas', d.pendencias.length, '', d.pendencias.length ? 'alerta' : '')}</section>
    <div class="grid2">${d.modelos.map((m) => `<section class="c"><h3>${esc(m.nome)} ${m.concluido_em ? `<span class="st ok">Concluído${m.por ? ' · ' + esc(m.por.split(' ')[0]) : ''}</span>` : '<span class="st pe">Pendente</span>'}</h3>
      <p class="mut peq">${esc(m.quando || '')}</p><form data-m="${m.id}">${m.itens.map((it, i) => item(it, i, (m.respostas || {})[i])).join('')}<button class="btn">Salvar</button></form></section>`).join('')}</div>
    <section class="c"><h3>Pendências</h3>${d.pendencias.length ? `<table class="tab">${d.pendencias.map((p) => `<tr><td>${esc(p.descricao)}<br><small class="mut">${esc(p.origem || '')}</small></td><td><button class="btn peq" data-r="${p.id}">Resolvido</button></td></tr>`).join('')}</table>` : '<p class="mut">Nenhuma pendência. 👍</p>'}</section>`;
  $$('form[data-m]', el).forEach((f) => (f.onsubmit = (e) => { e.preventDefault(); tentar(async () => {
    const m = d.modelos.find((x) => x.id === +f.dataset.m); const respostas = {};
    m.itens.forEach((it, i) => {
      const inp = f.querySelector(`[name="i${i}"]`);
      if (it.tipo === 'sim') { const v = f.querySelector(`[name="i${i}"]:checked`)?.value; if (v) respostas[i] = v === 'sim'; }
      else if (inp && inp.value !== '') respostas[i] = inp.value;
    });
    const r = await api('PUT', `/api/checklist/execucao/${m.id}`, { data: d.data, respostas });
    aviso(r.pendencias_abertas ? `Salvo. ${r.pendencias_abertas} item(ns) fora do padrão viraram pendência.` : r.concluido ? 'Checklist concluído.' : 'Salvo.', r.pendencias_abertas ? 'erro' : 'ok');
    rec();
  }, e.submitter); }));
  $$('[data-r]', el).forEach((b) => (b.onclick = () => tentar(async () => { await api('POST', `/api/checklist/pendencias/${b.dataset.r}/resolver`); rec(); }, b)));
}

function item(it, i, v) {
  const faixa = it.tipo === 'numero' ? [it.min !== undefined ? `mín ${it.min}` : '', it.max !== undefined ? `máx ${it.max}` : ''].filter(Boolean).join(' · ') : '';
  const campo = it.tipo === 'sim'
    ? `<span class="simnao"><label><input type="radio" name="i${i}" value="sim" ${v === true ? 'checked' : ''}> Sim</label><label><input type="radio" name="i${i}" value="nao" ${v === false ? 'checked' : ''}> Não</label></span>`
    : it.tipo === 'numero' ? `<input name="i${i}" inputmode="decimal" class="curto" value="${esc(v ?? '')}">` : `<input name="i${i}" value="${esc(v ?? '')}">`;
  return `<div class="item"><div>${esc(it.texto)}${faixa ? `<small class="mut"> (${faixa})</small>` : ''}${it.foto ? ' <small class="mut">📷 foto recomendada</small>' : ''}</div>${campo}</div>`;
}

async function modelos(el, rec) {
  const ms = await api('GET', '/api/checklist/modelos');
  el.innerHTML = `<div class="acoes"><button class="btn" id="novo">+ Modelo</button></div><p class="mut">Quando o checklist da loja chegar, ajuste os itens aqui. Item "Sim/Não" com resposta "Não" e número fora da faixa viram pendência.</p>
    <section class="c"><table class="tab"><tr><th>Checklist</th><th>Quando</th><th>Itens</th><th></th></tr>${ms.map((m) => `<tr><td>${esc(m.nome)}${m.ativo ? '' : ' <span class="st">inativo</span>'}</td><td>${esc(m.quando || '')}</td><td>${m.itens.length}</td><td><button class="link" data-e="${m.id}">editar</button></td></tr>`).join('')}</table></section>`;
  const editar = (m = { nome: '', quando: '', itens: [{ texto: '', tipo: 'sim' }], ativo: true }) => {
    const linhas = (its) => its.map((it) => `<tr><td><input class="t" value="${esc(it.texto)}"></td><td><select class="tp">${['sim', 'numero', 'texto'].map((t) => `<option ${t === it.tipo ? 'selected' : ''} value="${t}">${{ sim: 'Sim/Não', numero: 'Número', texto: 'Texto' }[t]}</option>`).join('')}</select></td>
      <td><input class="mn curto" value="${it.min ?? ''}" placeholder="mín"></td><td><input class="mx curto" value="${it.max ?? ''}" placeholder="máx"></td><td><input type="checkbox" class="ft" ${it.foto ? 'checked' : ''}> 📷</td><td><button class="link rm">×</button></td></tr>`).join('');
    const c = janela(m.id ? m.nome : 'Novo checklist', `<div class="g3"><label>Nome<input id="mn" value="${esc(m.nome)}"></label><label>Quando<input id="mq" value="${esc(m.quando || '')}" placeholder="todo dia · 06:30"></label>
      <label class="linha"><input type="checkbox" id="ma" ${m.ativo ? 'checked' : ''}> Ativo</label></div><table class="tab" id="its">${linhas(m.itens)}</table>
      <div class="acoes"><button class="btn sec" id="add">+ Item</button><button class="btn" id="ok">Salvar</button></div>`, { largura: 820 });
    const ligar = () => $$('.rm', c).forEach((b) => (b.onclick = () => b.closest('tr').remove()));
    ligar();
    c.querySelector('#add').onclick = () => { c.querySelector('#its').insertAdjacentHTML('beforeend', linhas([{ texto: '', tipo: 'sim' }])); ligar(); };
    c.querySelector('#ok').onclick = (e) => tentar(async () => {
      const itens = $$('#its tr', c).map((tr) => ({ texto: tr.querySelector('.t').value, tipo: tr.querySelector('.tp').value, min: tr.querySelector('.mn').value, max: tr.querySelector('.mx').value, foto: tr.querySelector('.ft').checked }));
      await api('POST', '/api/checklist/modelos', { id: m.id, nome: c.querySelector('#mn').value, quando: c.querySelector('#mq').value, ativo: c.querySelector('#ma').checked, itens });
      c.fechar(); rec();
    }, e.target);
  };
  $('#novo', el).onclick = () => editar();
  $$('[data-e]', el).forEach((b) => (b.onclick = () => editar(ms.find((m) => m.id === +b.dataset.e))));
}

async function documentos(el, rec, gerente) {
  const d = await api('GET', '/api/documentos');
  const st = (x) => (x.dias == null ? '' : x.dias < 0 ? '<span class="st er">Vencido</span>' : x.dias <= 30 ? `<span class="st pe">Vence em ${x.dias} d</span>` : '<span class="st ok">Em dia</span>');
  el.innerHTML = `<section class="kpis">${kpi('Documentos', d.documentos.length)}${kpi('Vencem em 30 dias', d.documentos.filter((x) => x.dias != null && x.dias >= 0 && x.dias <= 30).length, '', 'alerta')}
    ${kpi('Vencidos', d.documentos.filter((x) => x.dias != null && x.dias < 0).length)}</section>
    <div class="acoes"><button class="btn" id="novo">+ Documento</button></div>
    ${d.pastas.map((p) => { const ds = d.documentos.filter((x) => x.pasta === p); return `<section class="c"><h3>📁 ${esc(p)} <small class="mut">${ds.length}</small></h3>${ds.length ? `<table class="tab">${ds.map((x) => `<tr><td><b>${esc(x.nome)}</b>${x.numero ? `<br><small class="mut">nº ${esc(x.numero)}</small>` : ''}</td><td>${x.validade ? dataBR(String(x.validade).slice(0, 10)) : '—'}</td><td>${st(x)}</td>
      <td>${x.tem_arquivo ? `<a class="link" href="/api/documentos/${x.id}/arquivo" target="_blank" rel="noopener">abrir</a>` : ''} ${gerente ? `<button class="link" data-x="${x.id}">excluir</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="mut peq">Nenhum documento.</p>'}</section>`; }).join('')}
    <p class="mut peq">Sugestões: licença sanitária, alvará, contrato de franquia, contrato do espaço (Bradesco), dedetização, limpeza da caixa d'água, Manual de Boas Práticas e POPs, extintores, certidões, ASO e carteira de manipulador.</p>`;
  $('#novo', el).onclick = () => {
    const c = janela('Novo documento', `<form id="fd"><label>Pasta<select name="pasta">${d.pastas.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
      <label>Nome<input name="nome" required placeholder="Ex.: Licença sanitária"></label><div class="g3"><label>Número<input name="numero"></label><label>Validade<input type="date" name="validade"></label></div>
      <label>Arquivo (PDF ou foto, até 8 MB)<input type="file" name="arquivo" accept="application/pdf,image/*" capture="environment"></label><button class="btn">Salvar</button></form>`);
    c.querySelector('#fd').onsubmit = (e) => { e.preventDefault(); tentar(async () => { await api('POST', '/api/documentos', new FormData(e.target)); c.fechar(); aviso('Documento salvo.'); rec(); }, e.submitter); };
  };
  $$('[data-x]', el).forEach((b) => (b.onclick = () => tentar(async () => { if (confirm('Excluir o documento?')) { await api('DELETE', `/api/documentos/${b.dataset.x}`); rec(); } }, b)));
}
