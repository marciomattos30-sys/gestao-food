import { api, esc, brl, n2, kpi, aviso, tentar, janela, empilhadas, dataBR, $, $$ } from '../ui.js';

export async function render(el, ctx) {
  const { competencia, nomeMes } = ctx;
  const [d, equipe] = await Promise.all([api('GET', `/api/fechamento/mes/${competencia}`), api('GET', '/api/equipe/colaboradores?todos=1')]);
  const t = d.totais;
  el.innerHTML = `<h1>Fechamento da equipe · ${nomeMes}</h1>
  <section class="kpis">${kpi('Consumo (Gcom)', brl(t.consumo))}${kpi('Vales', brl(t.vales))}${kpi('Quebras', brl(t.quebras))}${kpi('Total a descontar', brl(t.total), `${d.linhas.filter((l) => l.total > 0).length} funcionários`, 'destaque')}</section>
  ${d.sem_ligacao.length ? `<section class="c alerta-box"><h3>Ligar nomes do Gcom à equipe</h3><p class="mut">Estas vendas a funcionário vieram com nomes que não batem com o cadastro. Ligue uma vez: o sistema lembra nos próximos meses.</p>
    <table>${d.sem_ligacao.map((s, i) => `<tr><td><b>${esc(s.nome)}</b><br><small class="mut">${s.vendas} vendas · ${brl(s.total)}</small></td>
      <td><select data-lig="${i}"><option value="">Escolha…</option>${equipe.map((c) => `<option value="${c.id}" ${sugere(s.nome, c.nome) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></td>
      <td><button class="btn peq" data-b="${i}">Ligar</button></td></tr>`).join('')}</table></section>` : ''}
  <div class="acoes"><button class="btn" id="b-vales">+ Vales do mês</button><button class="btn sec" id="b-quebra">+ Quebra</button>
    <a class="btn sec" href="#/importar">⬆ Importar Gcom / ponto / caixa</a><button class="btn sec" id="b-csv">⬇ Baixar planilha</button></div>
  <section class="c"><h3>Folha + consumo</h3><div class="rolagem"><table class="tab"><tr><th>Funcionário</th><th class="n">Faltas</th><th class="n">Abono</th><th class="n">Extra 0%D</th><th class="n">Extra diurna</th>
    <th class="n">Consumo</th><th class="n">Vales</th><th class="n">Quebras</th><th class="n">Total a descontar</th><th></th></tr>
    ${d.linhas.map((l) => `<tr><td><b>${esc(l.nome)}</b><br><small class="mut">${esc(l.funcao || '')}</small></td>
      <td class="n">${l.faltas || ''}</td><td class="n">${l.abono || ''}</td><td class="n">${esc(l.extra_0 || '')}</td><td class="n">${esc(l.extra_diurna || '')}</td>
      <td class="n">${l.consumo ? n2(l.consumo) : '—'}</td><td class="n">${l.vales ? n2(l.vales) : '—'}</td><td class="n">${l.quebras ? n2(l.quebras) : '—'}</td>
      <td class="n"><b>${n2(l.total)}</b></td><td><button class="link" data-det="${l.id}">detalhe</button></td></tr>`).join('')}
    <tr class="tot"><td>Total</td><td colspan="4"></td><td class="n">${n2(t.consumo)}</td><td class="n">${n2(t.vales)}</td><td class="n">${n2(t.quebras)}</td><td class="n">${n2(t.total)}</td><td></td></tr></table></div></section>
  <section class="c"><h3>Desconto em folha por funcionário</h3><div class="leg"><span><i style="background:var(--s1)"></i>Consumo</span><span><i style="background:var(--s2)"></i>Vale</span><span><i style="background:var(--s3)"></i>Quebras</span></div><div id="g"></div></section>`;

  empilhadas($('#g', el), d.linhas.filter((l) => l.total > 0).sort((a, b) => b.total - a.total).map((l) => ({
    rot: l.nome.split(' ')[0], texto: n2(l.total),
    partes: [{ valor: l.consumo, cor: 'var(--s1)', nome: 'Consumo' }, { valor: l.vales, cor: 'var(--s2)', nome: 'Vale' }, { valor: l.quebras, cor: 'var(--s3)', nome: 'Quebras' }],
  })));

  const recarregar = () => render(el, ctx);
  $$('[data-b]', el).forEach((b) => (b.onclick = () => tentar(async () => {
    const i = b.dataset.b, col = $(`[data-lig="${i}"]`, el).value;
    if (!col) return aviso('Escolha o funcionário.', 'erro');
    await api('POST', '/api/fechamento/ligar', { nome: d.sem_ligacao[i].nome, colaborador_id: +col });
    aviso('Ligado.'); recarregar();
  }, b)));

  $('#b-vales', el).onclick = () => {
    const ativos = d.linhas;
    const c = janela('Vales do mês', `<label>Data do pagamento<input type="date" id="vd" value="${competencia}-20"></label>
      <table>${ativos.map((l) => `<tr><td>${esc(l.nome)}</td><td><input class="valor" data-v="${l.id}" inputmode="decimal" placeholder="0,00"></td></tr>`).join('')}</table>
      <button class="btn" id="ok">Lançar vales</button>`);
    c.querySelector('#ok').onclick = (e) => tentar(async () => {
      const data = c.querySelector('#vd').value;
      const itens = $$('[data-v]', c).filter((i) => i.value.trim()).map((i) => ({ competencia, data, colaborador_id: +i.dataset.v, valor: i.value }));
      if (!itens.length) return aviso('Preencha pelo menos um valor.', 'erro');
      await api('POST', '/api/fechamento/vales', { itens }); c.fechar(); aviso(`${itens.length} vale(s) lançados.`); recarregar();
    }, e.target);
  };
  $('#b-quebra', el).onclick = () => {
    const c = janela('Lançar quebra', `<label>Funcionário<select id="qc"><option value="">— sem dono —</option>${equipe.map((x) => `<option value="${x.id}">${esc(x.nome)}</option>`).join('')}</select></label>
      <label>Data<input type="date" id="qd" value="${competencia}-01"></label><label>O que quebrou / motivo<input id="qx" placeholder="Ex.: taça 300 ml"></label>
      <label>Valor<input id="qv" inputmode="decimal" placeholder="0,00"></label><button class="btn" id="ok">Lançar</button>`);
    c.querySelector('#ok').onclick = (e) => tentar(async () => {
      await api('POST', '/api/fechamento/quebras', { competencia, colaborador_id: +c.querySelector('#qc').value || null, data: c.querySelector('#qd').value, descricao: c.querySelector('#qx').value, valor: c.querySelector('#qv').value });
      c.fechar(); aviso('Quebra lançada.'); recarregar();
    }, e.target);
  };
  $$('[data-det]', el).forEach((b) => (b.onclick = () => tentar(async () => {
    const id = +b.dataset.det, l = d.linhas.find((x) => x.id === id);
    const x = await api('GET', `/api/fechamento/detalhe/${competencia}/${id}`);
    const c = janela(l.nome, `<h4>Consumo (${x.consumo.length})</h4>${x.consumo.length ? `<table>${x.consumo.map((v) => `<tr><td>${new Date(v.data).toLocaleString('pt-BR')}</td><td class="mut">${esc(v.atendente || '')}</td><td class="n">${n2(v.total)}</td></tr>`).join('')}</table>` : '<p class="mut">—</p>'}
      <h4>Vales</h4>${x.vales.map((v) => `<p>${dataBR(v.data)} · ${brl(v.valor)} <button class="link" data-xv="${v.id}">excluir</button></p>`).join('') || '<p class="mut">—</p>'}
      <h4>Quebras</h4>${x.quebras.map((v) => `<p>${dataBR(v.data)} · ${esc(v.descricao || '')} · ${brl(v.valor)} <button class="link" data-xq="${v.id}">excluir</button></p>`).join('') || '<p class="mut">—</p>'}
      <h4>Ponto</h4><div class="g3"><label>Faltas<input id="pf" value="${l.faltas || ''}"></label><label>Abono<input id="pa" value="${l.abono || ''}"></label><label>Atraso<input id="pt" value="${esc(l.atraso || '')}"></label>
      <label>Extra 0%D<input id="p0" value="${esc(l.extra_0 || '')}"></label><label>Extra diurna<input id="pd" value="${esc(l.extra_diurna || '')}"></label></div><button class="btn" id="sp">Salvar ponto</button>`, { largura: 620 });
    c.querySelector('#sp').onclick = (e) => tentar(async () => {
      await api('PUT', '/api/fechamento/ponto', { competencia, itens: [{ colaborador_id: id, faltas: c.querySelector('#pf').value, abono: c.querySelector('#pa').value, atraso: c.querySelector('#pt').value, extra_0: c.querySelector('#p0').value, extra_diurna: c.querySelector('#pd').value }] });
      c.fechar(); recarregar();
    }, e.target);
    $$('[data-xv]', c).forEach((bb) => (bb.onclick = () => tentar(async () => { await api('DELETE', `/api/fechamento/vales/${bb.dataset.xv}`); c.fechar(); recarregar(); })));
    $$('[data-xq]', c).forEach((bb) => (bb.onclick = () => tentar(async () => { await api('DELETE', `/api/fechamento/quebras/${bb.dataset.xq}`); c.fechar(); recarregar(); })));
  })));

  $('#b-csv', el).onclick = () => {
    const linhas = [['Funcionário', 'Função', 'Faltas', 'Abono', 'Extra 0%D', 'Extra diurna', 'Atraso', 'Consumo', 'Vales', 'Quebras', 'Total a descontar'],
      ...d.linhas.map((l) => [l.nome, l.funcao || '', l.faltas || '', l.abono || '', l.extra_0 || '', l.extra_diurna || '', l.atraso || '', n2(l.consumo), n2(l.vales), n2(l.quebras), n2(l.total)]),
      ['TOTAL', '', '', '', '', '', '', n2(t.consumo), n2(t.vales), n2(t.quebras), n2(t.total)]];
    const csv = '﻿' + linhas.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `fechamento-${competencia}.csv`; a.click();
  };
}

function sugere(nomeGcom, nome) {
  const t = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/\s+/).filter((x) => !['DE', 'DA', 'DO', 'DOS', 'DAS'].includes(x));
  const a = t(nomeGcom), b = t(nome);
  return a[0] === b[0] && a.filter((x) => b.includes(x)).length >= Math.min(2, a.length);
}
