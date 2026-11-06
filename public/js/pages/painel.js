import { api, esc, brl, n2, pct, kpi, tag, vazio, barrasH, colunas, dataBR } from '../ui.js';

export async function render(el, { competencia, nomeMes }) {
  const d = await api('GET', `/api/vendas/painel/${competencia}`);
  const tm = (x) => (x.cupons ? x.valor / x.cupons : 0);
  const total = { valor: d.loja.valor + d.delivery.valor, cupons: d.loja.cupons + d.delivery.cupons };
  if (!total.cupons) {
    el.innerHTML = `<h1>Visão geral · ${nomeMes}</h1>${vazio('Ainda não há vendas deste mês.', '<a class="btn" href="#/importar">Importar Gcom e Anota AI</a>')}`;
    return;
  }
  const dre = d.dre_resumo;
  el.innerHTML = `<h1>Visão geral · ${nomeMes}</h1>
  <section class="kpis">
    ${kpi('Vendas loja (Gcom)', brl(d.loja.valor), `${d.loja.cupons.toLocaleString('pt-BR')} cupons · TM ${brl(tm(d.loja))}`)}
    ${kpi('Delivery (Anota AI)', brl(d.delivery.valor), `${d.delivery.cupons} pedidos · TM ${brl(tm(d.delivery))}${d.cancelados ? ` · ${d.cancelados} cancelados` : ''}`)}
    ${kpi('Total', brl(total.valor), `${total.cupons.toLocaleString('pt-BR')} vendas · TM ${brl(tm(total))}`, 'destaque')}
    ${kpi('Delivery no total', pct(total.valor ? d.delivery.valor / total.valor * 100 : 0))}
    ${kpi('Desconto em folha', brl(d.desconto_folha), '<a href="#/fechamento">consumo + vales + quebras</a>')}
    ${dre ? kpi('Lucro líquido (DRE)', brl(dre.totais.lucro_liquido), pct(dre.pct.lucro_liquido) + ' da receita', dre.totais.lucro_liquido < 0 ? 'alerta' : '') : ''}
  </section>
  <section class="c"><h3>Vendas por dia</h3><div class="leg"><span><i style="background:var(--s0)"></i>Loja</span><span><i style="background:var(--s4)"></i>Delivery</span></div><div id="g-dias"></div></section>
  <div class="grid2">
    <section class="c"><h3>Vendas por forma de pagamento</h3><div id="g-formas"></div></section>
    ${dre ? `<section class="c"><h3>Para onde vai cada R$ 100 ${tag('DRE automática')}</h3><div id="g-dre"></div></section>` : ''}
    <section class="c"><h3>Delivery por local de entrega</h3><div id="g-locais"></div></section>
    <section class="c"><h3>Clientes que mais pedem</h3>${d.clientes.length ? `<table><tr><th>Cliente</th><th class="n">Pedidos</th><th class="n">TM</th><th class="n">Último</th></tr>
      ${d.clientes.map((c) => `<tr><td>${esc(c.cliente)}</td><td class="n">${c.pedidos}</td><td class="n">${n2(c.valor / c.pedidos)}</td><td class="n">${dataBR(c.ultimo)}</td></tr>`).join('')}</table>` : '<p class="mut">Importe os pedidos do Anota AI.</p>'}</section>
    <section class="c"><h3>Entregadores</h3>${d.entregadores.length ? `<table><tr><th>Entregador</th><th class="n">Entregas</th><th class="n">R$</th></tr>
      ${d.entregadores.map((c) => `<tr><td>${esc(c.entregador)}</td><td class="n">${c.pedidos}</td><td class="n">${n2(c.valor)}</td></tr>`).join('')}</table>` : '<p class="mut">O relatório do Anota AI não trouxe entregador.</p>'}</section>
  </div>`;

  // vendas por dia: loja e delivery lado a lado em colunas empilhadas visuais simples
  const [a, m] = competencia.split('-').map(Number);
  const nd = new Date(a, m, 0).getDate();
  const porDia = Array.from({ length: nd }, (_, i) => { const dd = `${competencia}-${String(i + 1).padStart(2, '0')}`; return { dd, loja: 0, del: 0 }; });
  for (const x of d.dias) { const p = porDia[+x.data.slice(8) - 1]; if (p) p[x.canal === 'loja' ? 'loja' : 'del'] += x.valor; }
  const alvo = el.querySelector('#g-dias');
  colunas(alvo, porDia.map((p, i) => ({ rot: String(i + 1), valor: p.loja + p.del, dica: `${dataBR(p.dd)} · loja ${brl(p.loja)} · delivery ${brl(p.del)}` })));
  // sobrepõe a parte do delivery (cor própria) — redesenha como barras do delivery por cima
  const svg = alvo.querySelector('svg'); const paths = svg.querySelectorAll('path.m');
  let k = 0;
  porDia.forEach((p) => {
    if (p.loja + p.del <= 0) return; const path = paths[k++]; if (!path || !p.del) return;
    const bb = path.getBBox(); const hDel = bb.height * (p.del / (p.loja + p.del));
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', bb.x); r.setAttribute('y', bb.y); r.setAttribute('width', bb.width); r.setAttribute('height', Math.max(1, hDel - 2)); r.setAttribute('rx', 3);
    r.setAttribute('fill', 'var(--s4)'); r.style.pointerEvents = 'none'; svg.appendChild(r);
  });

  const NOMES = { ALELO: 'Alelo Refeição', CREDITO: 'Crédito', DEBITO: 'Débito', PIX: 'PIX', COMBINADO: 'Combinado', FUNCIONARIO: 'Funcionário', NAO_GERA: 'Não gera financeiro', 'TICKET/VR': 'Ticket / VR', DINHEIRO: 'Dinheiro', OUTROS: 'Outros' };
  const tf = d.formas.reduce((s, f) => s + f.valor, 0);
  barrasH(el.querySelector('#g-formas'), d.formas.map((f) => ({ rot: NOMES[f.forma] || f.forma, valor: f.valor, texto: pct(f.valor / tf * 100), dica: `${NOMES[f.forma] || f.forma}: ${brl(f.valor)} · ${f.qtd} vendas` })));
  if (dre) {
    const t = dre.totais, r = t.receita || 1;
    const itens = [['Custo variável', t.custo_variavel], ['Despesas operacionais', t.despesa_operacional], ['Outras despesas', t.outras_despesas], ['Lucro líquido', t.lucro_liquido]];
    barrasH(el.querySelector('#g-dre'), itens.map(([rot, v]) => ({ rot, valor: Math.max(0, v / r * 100), texto: brl(v / r * 100), dica: `${rot}: ${brl(v)} (${pct(v / r * 100)})`, cor: rot === 'Lucro líquido' ? 'var(--ok)' : undefined })));
  }
  barrasH(el.querySelector('#g-locais'), d.locais.map((l) => ({ rot: l.local, valor: l.valor, texto: `${l.pedidos} · TM ${n2(l.valor / l.pedidos)}`, dica: `${l.local}: ${brl(l.valor)} em ${l.pedidos} pedidos` })), { larguraRotulo: 170 });
}
