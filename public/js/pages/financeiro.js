import { api, esc, brl, n2, pct, kpi, aviso, tentar, janela, barrasH, colunas, dataBR, MESES, $, $$ } from '../ui.js';

const ABAS = [['dre', 'DRE automática'], ['cmv', 'Compras e CMV'], ['contas', 'Contas e fornecedores'], ['taxas', 'Máquinas e taxas'], ['impostos', 'Impostos']];

export async function render(el, ctx) {
  const aba = (location.hash.match(/aba=(\w+)/) || [])[1] || 'dre';
  el.innerHTML = `<h1>Financeiro · ${ctx.nomeMes}</h1><nav class="abas">${ABAS.map(([k, r]) => `<a href="#/financeiro?aba=${k}" class="${k === aba ? 'on' : ''}">${r}</a>`).join('')}</nav><div id="conteudo"></div>`;
  const alvo = $('#conteudo', el);
  const recarregar = () => render(el, ctx);
  await ({ dre, cmv, contas, taxas, impostos })[aba](alvo, ctx, recarregar);
}

async function dre(el, { competencia, nomeMes }, recarregar) {
  const d = await api('GET', `/api/financeiro/dre/${competencia}`);
  const t = d.totais;
  const grupo = (g) => d.linhas.filter((l) => l.grupo === g);
  const linha = (l) => `<tr><td>${esc(l.rotulo)}</td><td class="n">${n2(l.valor)}</td><td class="n">${pct(l.pct)}</td><td><small class="${l.fonte === '—' ? 'mut' : 'fonte'}">${esc(l.fonte)}</small></td>
    <td>${l.travado ? '🔒' : `<button class="link" data-aj="${l.chave}">ajustar</button>`}</td></tr>`;
  const sub = (rot, v, p) => `<tr class="sub"><td>${rot}</td><td class="n">${n2(v)}</td><td class="n">${pct(p)}</td><td></td><td></td></tr>`;
  el.innerHTML = `<section class="kpis">${kpi('Receita', brl(t.receita))}${kpi('Lucro bruto', brl(t.lucro_bruto), pct(d.pct.lucro_bruto))}${kpi('Lucro operacional', brl(t.lucro_operacional), pct(d.pct.lucro_operacional))}
    ${kpi('Lucro líquido', brl(t.lucro_liquido), pct(d.pct.lucro_liquido), 'destaque')}${kpi('Cupons', d.indicadores.cupons.toLocaleString('pt-BR'), `${d.indicadores.funcionarios} funcionários`)}</section>
    ${d.pendentes.length ? `<p class="alerta">Falta para fechar: ${d.pendentes.map(esc).join(' · ')}. <a href="#/importar">Importar</a></p>` : ''}
    <div class="acoes"><button class="btn" id="travar">🔒 Fechar o mês (travar valores)</button><button class="btn sec" id="csv">⬇ DRE no formato da franquia</button>
      <a class="btn sec" href="https://reidomate.extranet.com.br/index.php?module=dre_novo" target="_blank" rel="noopener">Abrir Extranet (lançar DRE)</a></div>
    <section class="c"><div class="rolagem"><table class="tab dre"><tr><th>Linha</th><th class="n">R$</th><th class="n">%</th><th>Fonte</th><th></th></tr>
      ${sub('(1) TOTAL RECEITAS', t.receita, 100)}${grupo('receita').map(linha).join('')}
      ${sub('(3) TOTAL CUSTO VARIÁVEL', t.custo_variavel, d.pct.custo_variavel)}${grupo('variavel').map(linha).join('')}
      ${sub('(4) LUCRO BRUTO', t.lucro_bruto, d.pct.lucro_bruto)}
      ${sub('(5) TOTAL DESP. OPERACIONAL', t.despesa_operacional, d.pct.despesa_operacional)}${grupo('operacional').map(linha).join('')}
      ${sub('(6) LUCRO OPERACIONAL', t.lucro_operacional, d.pct.lucro_operacional)}
      ${sub('(7) TOTAL OUTRAS DESPESAS', t.outras_despesas, d.pct.outras_despesas)}${grupo('outras').map(linha).join('')}
      ${sub('(8) LUCRO LÍQUIDO', t.lucro_liquido, d.pct.lucro_liquido)}</table></div></section>`;
  $$('[data-aj]', el).forEach((b) => (b.onclick = () => {
    const l = d.linhas.find((x) => x.chave === b.dataset.aj);
    const c = janela(l.rotulo, `<p class="mut">Valor automático: ${brl(l.valor)} (${esc(l.fonte)}). Informe outro valor só se precisar corrigir.</p>
      <label>Valor<input id="v" inputmode="decimal" placeholder="${n2(l.valor)}"></label><label class="linha"><input type="checkbox" id="tr"> Travar esta linha</label>
      <div class="acoes"><button class="btn" id="ok">Salvar</button><button class="btn sec" id="auto">Voltar ao automático</button></div>`);
    c.querySelector('#ok').onclick = (e) => tentar(async () => { await api('PUT', `/api/financeiro/dre/${competencia}`, { linha: l.chave, valor: c.querySelector('#v').value || null, travado: c.querySelector('#tr').checked }); c.fechar(); recarregar(); }, e.target);
    c.querySelector('#auto').onclick = (e) => tentar(async () => { await api('PUT', `/api/financeiro/dre/${competencia}`, { linha: l.chave, valor: null, travado: false }); c.fechar(); recarregar(); }, e.target);
  }));
  $('#travar', el).onclick = (e) => tentar(async () => { if (!confirm(`Travar todos os valores de ${nomeMes}? Depois só muda destravando linha por linha.`)) return; await api('POST', `/api/financeiro/dre/${competencia}/travar`); aviso('Mês fechado.'); recarregar(); }, e.target);
  $('#csv', el).onclick = () => {
    const L = Object.fromEntries(d.linhas.map((l) => [l.chave, l.valor]));
    const rows = [['Conta', 'R$', '%'], ['(1) TOTAL RECEITAS', t.receita], ['(A) Venda Balcão', L.venda_balcao], ['(B) Delivery Próprio', L.delivery_proprio], ['(C) Delivery Terceiro', L.delivery_terceiro],
      ['(2) RECEITA BASE ROYALTIES', t.receita_base_royalties], ['(3) TOTAL CUSTO VARIÁVEL', t.custo_variavel],
      ...d.linhas.filter((l) => l.grupo === 'variavel').map((l) => [l.rotulo, l.valor]), ['(4) LUCRO BRUTO = 1 - 3', t.lucro_bruto], ['(5) TOTAL DESP. OPERACIONAL', t.despesa_operacional],
      ...d.linhas.filter((l) => l.grupo === 'operacional').map((l) => [l.rotulo, l.valor]), ['(6) LUCRO OPERACIONAL = 4 - 5', t.lucro_operacional], ['(7) TOTAL OUTRAS DESPESAS', t.outras_despesas],
      ...d.linhas.filter((l) => l.grupo === 'outras').map((l) => [l.rotulo, l.valor]), ['(8) LUCRO LÍQUIDO', t.lucro_liquido], ['Cupons emitidos (TC)', d.indicadores.cupons], ['Nº Funcionários', d.indicadores.funcionarios]]
      .map((r, i, arr) => (i === 0 ? r : [r[0], i >= arr.length - 2 ? String(r[1]) : n2(r[1]), i < arr.length - 2 && t.receita ? pct(r[1] / t.receita * 100) : '']));
    const csv = '﻿' + rows.map((r) => r.map((x) => `"${x}"`).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `DRE-${competencia}.csv`; a.click();
  };
}

async function cmv(el, { competencia }) {
  const ano = competencia.slice(0, 4);
  const d = await api('GET', `/api/financeiro/cmv/${ano}`);
  const tot = d.fornecedores.reduce((a, f) => a + f.valor, 0);
  const atual = d.meses.find((m) => m.competencia === competencia);
  el.innerHTML = `<section class="kpis">${kpi('Compras do mês', brl(atual?.compras || 0))}${kpi('CMV % da receita', atual?.pct != null ? pct(atual.pct) : '—', `meta ${pct(d.meta)}`, atual?.pct > d.meta ? 'alerta' : 'destaque')}
    ${kpi(`Compras ${ano}`, brl(tot), `${d.meses.length} meses`)}</section>
    <div class="grid2"><section class="c"><h3>Compras de mercadoria por mês · ${ano}</h3><div id="g1"></div></section>
    <section class="c"><h3>Compras por fornecedor · ${ano}</h3><div id="g2"></div></section></div>
    <section class="c"><h3>CMV real × teórico</h3><p class="mut">CMV real = estoque inicial + compras − estoque final (contagem no checklist "Inventário"). CMV teórico = vendas por produto × custo das fichas.
    Os dois ficam completos quando as fichas técnicas e as notas fiscais por item estiverem cadastradas.</p></section>`;
  colunas($('#g1', el), d.meses.map((m) => ({ rot: MESES[+m.competencia.slice(5) - 1], valor: m.compras, dica: `${m.competencia}: ${brl(m.compras)}${m.pct != null ? ` · ${pct(m.pct)} da receita` : ''}` })));
  barrasH($('#g2', el), d.fornecedores.slice(0, 10).map((f) => ({ rot: f.fornecedor, valor: f.valor, texto: pct(f.valor / tot * 100), dica: `${f.fornecedor}: ${brl(f.valor)}` })));
}

async function contas(el, { competencia }, recarregar) {
  const [lanc, forn, contasDre] = await Promise.all([api('GET', `/api/financeiro/lancamentos/${competencia}`), api('GET', '/api/financeiro/fornecedores'), api('GET', '/api/financeiro/contas-dre')]);
  const rot = Object.fromEntries(contasDre.map((c) => [c.chave, c.rotulo]));
  const opcContas = (sel) => contasDre.filter((c) => c.grupo !== 'receita').map((c) => `<option value="${c.chave}" ${c.chave === sel ? 'selected' : ''}>${esc(c.rotulo)}</option>`).join('');
  el.innerHTML = `<div class="acoes"><button class="btn" id="novo">+ Lançamento</button><button class="btn sec" id="rec">↻ Copiar contas fixas do mês anterior</button><a class="btn sec" href="#/importar">⬆ Importar planilha</a></div>
  <div class="grid2"><section class="c"><h3>Lançamentos do mês (${lanc.length})</h3><div class="rolagem"><table class="tab"><tr><th>Data</th><th>Fornecedor / descrição</th><th>Conta da DRE</th><th class="n">R$</th><th></th></tr>
    ${lanc.map((l) => `<tr><td>${dataBR(l.data)}</td><td>${esc(l.fornecedor || l.descricao || '')}${l.recorrente ? ' <span class="st">fixa</span>' : ''}</td><td><small>${esc(rot[l.conta_dre])}</small></td><td class="n">${n2(l.valor)}</td><td><button class="link" data-x="${l.id}">excluir</button></td></tr>`).join('') || '<tr><td colspan="5" class="mut">Nenhum lançamento.</td></tr>'}
    <tr class="tot"><td colspan="3">Total</td><td class="n">${n2(lanc.reduce((a, l) => a + l.valor, 0))}</td><td></td></tr></table></div></section>
  <section class="c"><h3>Fornecedores</h3><p class="mut peq">A conta da DRE de cada fornecedor define onde o pagamento entra automaticamente.</p><div class="rolagem"><table class="tab"><tr><th>Fornecedor</th><th>Conta da DRE</th><th class="n">12 meses</th></tr>
    ${forn.map((f) => `<tr><td>${esc(f.nome)}<br><small class="mut">${esc(f.categoria || '')}</small></td><td><select data-f="${f.id}">${opcContas(f.conta_dre)}</select></td><td class="n">${n2(f.total_12m)}</td></tr>`).join('')}</table></div></section></div>`;
  $('#novo', el).onclick = () => {
    const c = janela('Novo lançamento', `<form id="fl"><label>Fornecedor<input name="fornecedor" list="lf" placeholder="Ex.: PLATLOG"><datalist id="lf">${forn.map((f) => `<option>${esc(f.nome)}</option>`).join('')}</datalist></label>
      <label>Descrição<input name="descricao"></label><div class="g3"><label>Data<input type="date" name="data" value="${competencia}-01"></label><label>Valor<input name="valor" inputmode="decimal" required></label>
      <label>Conta da DRE<select name="conta_dre">${opcContas('fornecedores')}</select></label></div><label class="linha"><input type="checkbox" name="recorrente"> Conta fixa (repete todo mês)</label><button class="btn">Salvar</button></form>`);
    c.querySelector('#fl').onsubmit = (e) => { e.preventDefault(); tentar(async () => {
      const f = Object.fromEntries(new FormData(e.target));
      const existente = forn.find((x) => x.nome === String(f.fornecedor).trim().toUpperCase());
      await api('POST', '/api/financeiro/lancamentos', { ...f, competencia, recorrente: !!f.recorrente, conta_dre: existente ? existente.conta_dre : f.conta_dre });
      c.fechar(); recarregar();
    }, e.submitter); };
  };
  $('#rec', el).onclick = (e) => tentar(async () => { const r = await api('POST', `/api/financeiro/recorrentes/${competencia}`); aviso(`${r.copiados} conta(s) fixa(s) copiadas.`); recarregar(); }, e.target);
  $$('[data-x]', el).forEach((b) => (b.onclick = () => tentar(async () => { await api('DELETE', `/api/financeiro/lancamentos/${b.dataset.x}`); recarregar(); }, b)));
  $$('[data-f]', el).forEach((s) => (s.onchange = () => tentar(async () => { const f = forn.find((x) => x.id === +s.dataset.f); await api('PUT', `/api/financeiro/fornecedores/${f.id}`, { ...f, conta_dre: s.value }); aviso('Conta atualizada.'); })));
}

async function taxas(el, { competencia }, recarregar) {
  const [tx, cp] = await Promise.all([api('GET', '/api/financeiro/taxas'), api('GET', `/api/financeiro/custo-pagamentos/${competencia}`)]);
  const NOMES = { ALELO: 'Alelo Refeição', CREDITO: 'Crédito', DEBITO: 'Débito', PIX: 'PIX', 'TICKET/VR': 'Ticket / VR', COMBINADO: 'Combinado', DINHEIRO: 'Dinheiro', FUNCIONARIO: 'Funcionário', NAO_GERA: 'Não gera financeiro' };
  const TIPO = { percentual: '% sobre a venda', mensal: 'R$ por mês', por_transacao: 'R$ por transação' };
  el.innerHTML = `<section class="kpis">${kpi('Custo total com meios de pagamento', brl(cp.total), `taxa efetiva ${pct(cp.taxa_efetiva)}`, 'destaque')}
    ${kpi('Taxas sobre vendas', brl(cp.linhas.reduce((a, l) => a + l.custo, 0)))}${kpi('Mensalidades (máquinas, TEF, planos)', brl(cp.mensal.reduce((a, t) => a + t.valor, 0)))}</section>
  <div class="grid2"><section class="c"><h3>Custo por forma de pagamento</h3><table class="tab"><tr><th>Forma</th><th class="n">Vendas</th><th class="n">Taxa</th><th class="n">Prazo</th><th class="n">Custo</th></tr>
    ${cp.linhas.map((l) => `<tr><td>${esc(NOMES[l.forma] || l.forma)}</td><td class="n">${n2(l.valor)}</td><td class="n">${l.taxa != null ? pct(l.taxa) : '—'}</td><td class="n">${l.prazo != null ? l.prazo + ' d' : '—'}</td><td class="n">${n2(l.custo)}</td></tr>`).join('')}</table></section>
  <section class="c"><h3>Quanto custa cada R$ 100</h3><div id="g"></div></section></div>
  <section class="c"><h3>Contratos, máquinas e taxas</h3><button class="btn" id="nova">+ Taxa / máquina</button><table class="tab"><tr><th>Nome</th><th>Forma</th><th>Tipo</th><th class="n">Valor</th><th class="n">Prazo</th><th></th></tr>
    ${tx.map((t) => `<tr><td>${esc(t.nome)}</td><td>${esc(NOMES[t.forma] || t.forma || '—')}</td><td>${TIPO[t.tipo]}</td><td class="n">${t.tipo === 'percentual' ? pct(t.valor) : brl(t.valor)}</td><td class="n">${t.prazo_dias ?? '—'}</td>
      <td><button class="link" data-e="${t.id}">editar</button> <button class="link" data-x="${t.id}">excluir</button></td></tr>`).join('')}</table>
    <p class="mut peq">Aluguel do pinpad/POS, mensalidade do TEF/SiTef, Alelo/Ticket/VR e o plano do Anota AI entram como "R$ por mês". A Alelo é a forma mais usada: confira a taxa do contrato.</p></section>`;
  barrasH($('#g', el), tx.filter((t) => t.tipo === 'percentual').sort((a, b) => b.valor - a.valor).map((t) => ({ rot: t.nome, valor: t.valor, texto: brl(t.valor), dica: `${t.nome}: custa ${brl(t.valor)} a cada R$ 100 (fica ${brl(100 - t.valor)})` })), { larguraRotulo: 170 });
  const form = (t = {}) => {
    const c = janela(t.id ? 'Editar' : 'Nova taxa / máquina', `<form id="ft"><label>Nome<input name="nome" value="${esc(t.nome || '')}" required></label>
      <div class="g3"><label>Tipo<select name="tipo">${Object.entries(TIPO).map(([k, r]) => `<option value="${k}" ${k === t.tipo ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label>Forma de pagamento<select name="forma"><option value="">—</option>${Object.entries(NOMES).map(([k, r]) => `<option value="${k}" ${k === t.forma ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label>Valor<input name="valor" inputmode="decimal" value="${t.valor ?? ''}" required></label><label>Prazo (dias)<input name="prazo_dias" inputmode="numeric" value="${t.prazo_dias ?? ''}"></label></div><button class="btn">Salvar</button></form>`);
    c.querySelector('#ft').onsubmit = (e) => { e.preventDefault(); tentar(async () => {
      const f = Object.fromEntries(new FormData(e.target));
      t.id ? await api('PUT', `/api/financeiro/taxas/${t.id}`, f) : await api('POST', '/api/financeiro/taxas', f);
      c.fechar(); recarregar();
    }, e.submitter); };
  };
  $('#nova', el).onclick = () => form();
  $$('[data-e]', el).forEach((b) => (b.onclick = () => form(tx.find((t) => t.id === +b.dataset.e))));
  $$('[data-x]', el).forEach((b) => (b.onclick = () => tentar(async () => { if (confirm('Excluir?')) { await api('DELETE', `/api/financeiro/taxas/${b.dataset.x}`); recarregar(); } }, b)));
}

async function impostos(el, { competencia }, recarregar) {
  const g = await api('GET', '/api/financeiro/guias');
  const hoje = new Date().toISOString().slice(0, 10), em7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const venc = (x) => String(x.vencimento || '').slice(0, 10);
  const abertas = g.filter((x) => !x.paga);
  el.innerHTML = `<section class="kpis">${kpi('Vencidas', abertas.filter((x) => venc(x) && venc(x) < hoje).length, '', abertas.some((x) => venc(x) && venc(x) < hoje) ? 'alerta' : '')}
    ${kpi('Vencem em 7 dias', brl(abertas.filter((x) => venc(x) >= hoje && venc(x) <= em7).reduce((a, x) => a + x.valor, 0)))}${kpi('A pagar', brl(abertas.reduce((a, x) => a + x.valor, 0)))}</section>
  <div class="acoes"><button class="btn" id="nova">+ Guia</button></div>
  <section class="c"><h3>Guias</h3><div class="rolagem"><table class="tab"><tr><th>Guia</th><th>Competência</th><th>Vencimento</th><th class="n">R$</th><th>Código de barras</th><th>Situação</th><th></th></tr>
    ${g.map((x) => `<tr><td><b>${esc(x.tipo)}</b></td><td>${esc(x.competencia)}</td><td>${dataBR(venc(x))}</td><td class="n">${n2(x.valor)}</td>
      <td>${x.codigo_barras ? `<button class="link" data-cb="${esc(x.codigo_barras)}">copiar</button>` : '—'}</td>
      <td>${x.paga ? '<span class="st ok">Paga</span>' : venc(x) && venc(x) < hoje ? '<span class="st er">Vencida</span>' : '<span class="st pe">A pagar</span>'}</td>
      <td>${x.paga ? '' : `<button class="link" data-p="${x.id}">✓ paga</button>`} <button class="link" data-r="${x.id}">repetir</button> <button class="link" data-x="${x.id}">excluir</button></td></tr>`).join('') || '<tr><td colspan="7" class="mut">Nenhuma guia.</td></tr>'}</table></div>
    <p class="mut peq">Na DRE, cada guia entra pela competência: DAS/ISS/ICMS em Impostos, INSS/FGTS em Salários + encargos, parcelamentos em Pagamentos de empréstimos.</p></section>`;
  $('#nova', el).onclick = () => {
    const c = janela('Nova guia', `<form id="fg"><div class="g3"><label>Tipo<select name="tipo">${['DAS', 'INSS', 'FGTS', 'ISS', 'ICMS', 'IPTU', 'DARF', 'PARCELAMENTO', 'TAXA'].map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label>Competência<input type="month" name="competencia" value="${competencia}"></label><label>Vencimento<input type="date" name="vencimento"></label></div>
      <label>Valor<input name="valor" inputmode="decimal" required></label><label>Código de barras<input name="codigo_barras" inputmode="numeric"></label><button class="btn">Salvar</button></form>`);
    c.querySelector('#fg').onsubmit = (e) => { e.preventDefault(); tentar(async () => { await api('POST', '/api/financeiro/guias', Object.fromEntries(new FormData(e.target))); c.fechar(); recarregar(); }, e.submitter); };
  };
  $$('[data-p]', el).forEach((b) => (b.onclick = () => tentar(async () => { await api('POST', `/api/financeiro/guias/${b.dataset.p}/paga`, { paga: true }); recarregar(); }, b)));
  $$('[data-r]', el).forEach((b) => (b.onclick = () => tentar(async () => { await api('POST', `/api/financeiro/guias/${b.dataset.r}/repetir`); aviso('Guia criada para o próximo mês.'); recarregar(); }, b)));
  $$('[data-x]', el).forEach((b) => (b.onclick = () => tentar(async () => { if (confirm('Excluir a guia?')) { await api('DELETE', `/api/financeiro/guias/${b.dataset.x}`); recarregar(); } }, b)));
  $$('[data-cb]', el).forEach((b) => (b.onclick = () => { navigator.clipboard.writeText(b.dataset.cb); aviso('Código copiado.'); }));
}
