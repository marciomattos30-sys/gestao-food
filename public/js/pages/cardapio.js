import { api, esc, brl, aviso, tentar, janela, vazio, $, $$ } from '../ui.js';

let historico = [];

export async function render(el, ctx) {
  const prods = await api('GET', '/api/cardapio/produtos');
  const gerente = ctx.pode('financeiro');
  const cats = [...new Set(prods.map((p) => p.categoria))];
  el.innerHTML = `<h1>Cardápio e Chef</h1>
  <section class="c chef"><h3>👨‍🍳 Pergunte ao Chef</h3>
    <div id="conversa" class="conversa">${historico.length ? '' : '<p class="mut">Ex.: “O que vai no Beijo na Boca?”, “Quais polpas temos?”, “Como monto o Tost Dog Especial?”</p>'}</div>
    <form id="fchef" class="linha-form"><input id="pq" placeholder="Digite ou toque no microfone" autocomplete="off"><button type="button" class="btn sec" id="mic" title="Falar">🎤</button><button class="btn">Perguntar</button></form>
    <label class="linha peq"><input type="checkbox" id="voz" checked> Ler a resposta em voz alta</label></section>
  <div class="acoes"><input id="busca" placeholder="Buscar produto…">${gerente ? '<button class="btn sec" id="imp">⟳ Atualizar do app Rei do Mate (Gcom)</button>' : ''}</div>
  <div id="lista">${prods.length ? '' : vazio('Cardápio vazio.', gerente ? 'Clique em “Atualizar do app Rei do Mate” para importar os produtos.' : 'Peça ao gerente para importar o cardápio.')}</div>`;

  const desenha = (filtro = '') => {
    const f = filtro.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const ok = (p) => !f || (p.nome + ' ' + (p.descricao || '') + ' ' + p.categoria).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(f);
    $('#lista', el).innerHTML = cats.map((c) => {
      const ps = prods.filter((p) => p.categoria === c && ok(p)); if (!ps.length) return '';
      return `<h3 class="cat">${esc(c)}</h3><div class="cards">${ps.map((p) => `<button class="prod" data-p="${p.id}">${p.foto ? `<img src="${esc(p.foto)}" alt="" loading="lazy">` : '<div class="semfoto">🍹</div>'}
        <div><b>${esc(p.nome)}</b><small>${esc((p.descricao || '').slice(0, 90))}</small>${p.ficha && Object.keys(p.ficha).length ? '<span class="st ok">ficha</span>' : ''}</div></button>`).join('')}</div>`;
    }).join('');
    $$('[data-p]', el).forEach((b) => (b.onclick = () => abrir(prods.find((p) => p.id === +b.dataset.p))));
  };
  if (prods.length) desenha();
  $('#busca', el).oninput = (e) => desenha(e.target.value);
  const imp = $('#imp', el);
  if (imp) imp.onclick = () => tentar(async () => { const r = await api('POST', '/api/cardapio/importar-gcom'); aviso(`${r.produtos} produtos em ${r.categorias} categorias.`); render(el, ctx); }, imp);

  function abrir(p) {
    const f = p.ficha || {};
    const c = janela(p.nome, `${p.foto ? `<img class="foto-g" src="${esc(p.foto)}" alt="">` : ''}<p>${esc(p.descricao || '')}</p>
      ${(p.opcoes || []).map((o) => `<p><b>${esc(o.grupo)}</b>: ${o.itens.map(esc).join(', ')}</p>`).join('')}
      <h4>Ficha técnica</h4>${f.ingredientes || f.passos ? `<p><b>Ingredientes</b></p><pre>${esc(f.ingredientes || '')}</pre><p><b>Passo a passo</b></p><pre>${esc(f.passos || '')}</pre>${f.atencao ? `<p class="alerta">⚠ ${esc(f.atencao)}</p>` : ''}${f.custo ? `<p>Custo da receita: ${brl(f.custo)}</p>` : ''}` : '<p class="mut">Ainda sem ficha (as fichas da Extranet estão fora do ar).</p>'}
      ${gerente ? `<details><summary>Editar ficha e preço</summary><form id="ff"><label>Preço de venda<input name="preco" inputmode="decimal" value="${p.preco ?? ''}"></label>
        <label>Ingredientes (um por linha, com quantidade)<textarea name="ingredientes" rows="4">${esc(f.ingredientes || '')}</textarea></label>
        <label>Passo a passo<textarea name="passos" rows="4">${esc(f.passos || '')}</textarea></label><label>Ponto de atenção<input name="atencao" value="${esc(f.atencao || '')}"></label>
        <div class="g3"><label>Rendimento<input name="rendimento" value="${esc(f.rendimento || '')}"></label><label>Tempo de preparo<input name="tempo" value="${esc(f.tempo || '')}"></label><label>Custo da receita (R$)<input name="custo" inputmode="decimal" value="${esc(f.custo || '')}"></label></div>
        <button class="btn">Salvar</button></form></details>` : ''}`, { largura: 640 });
    const ff = c.querySelector('#ff');
    if (ff) ff.onsubmit = (e) => { e.preventDefault(); tentar(async () => {
      const d = Object.fromEntries(new FormData(ff));
      const { preco, ...ficha } = d;
      await api('PUT', `/api/cardapio/produtos/${p.id}`, { preco, ficha });
      c.fechar(); aviso('Ficha salva.'); render(el, ctx);
    }, e.submitter); };
  }

  // ---------- Chef ----------
  const conversa = $('#conversa', el);
  const mostra = () => {
    if (!historico.length) return;
    conversa.innerHTML = historico.map((m) => `<div class="msg ${m.role}">${esc(m.content).replace(/\n/g, '<br>')}</div>${m.produtos ? `<div class="mini">${m.produtos.map((p) => `<span>${p.foto ? `<img src="${esc(p.foto)}" alt="">` : ''}${esc(p.nome)}</span>`).join('')}</div>` : ''}`).join('');
    conversa.scrollTop = conversa.scrollHeight;
  };
  mostra();
  $('#fchef', el).onsubmit = (e) => { e.preventDefault(); const pq = $('#pq', el).value.trim(); if (!pq) return; tentar(async () => {
    historico.push({ role: 'user', content: pq }); $('#pq', el).value = ''; mostra();
    conversa.insertAdjacentHTML('beforeend', '<div class="msg assistant mut" id="pensando">Pensando…</div>');
    try {
      const r = await api('POST', '/api/cardapio/chef', { pergunta: pq, historico: historico.slice(0, -1).map(({ role, content }) => ({ role, content })) });
      historico.push({ role: 'assistant', content: r.resposta, produtos: r.produtos });
      if ($('#voz', el).checked && 'speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(r.resposta.replace(/[*#]/g, '')); u.lang = 'pt-BR'; speechSynthesis.cancel(); speechSynthesis.speak(u); }
    } catch (err) { historico.pop(); throw err; } finally { mostra(); $('#pensando')?.remove(); }
  }, e.submitter); };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('#mic', el);
  if (!SR) mic.hidden = true;
  else mic.onclick = () => {
    const rec = new SR(); rec.lang = 'pt-BR'; rec.interimResults = false;
    mic.classList.add('gravando');
    rec.onresult = (ev) => { $('#pq', el).value = ev.results[0][0].transcript; $('#fchef', el).requestSubmit(); };
    rec.onend = () => mic.classList.remove('gravando');
    rec.onerror = () => { mic.classList.remove('gravando'); aviso('Não consegui ouvir. Tente de novo.', 'erro'); };
    rec.start();
  };
}
