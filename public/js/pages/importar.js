import { api, esc, brl, n2, aviso, tentar, janela, $, $$ } from '../ui.js';
import { parseGcomVendas, lerArquivoTexto, lerPlanilha, parseAnota, parsePonto, linhasDeTexto } from '../parsers.js';

// Linhas da planilha "FORNECEDOR MENSAL" -> conta da DRE
const CONTA_PLANILHA = {
  PLATLOG: 'fornecedores', 'REI DO MATE': 'fornecedores', FROOTY: 'fornecedores', 'CENTRAL FOOD': 'fornecedores', 'TORTA MARIA': 'fornecedores',
  'COCA COLA': 'fornecedores', MERCADO: 'fornecedores', CAPACI: 'fornecedores', MILK: 'fornecedores', 'AGUA MIX': 'fornecedores', MARDORI: 'fornecedores',
  DUMIL: 'fornecedores', CAMPTORTAS: 'fornecedores', CITRO: 'fornecedores', EMBALAGEM: 'fornecedores', CAJULU: 'fornecedores', 'BOLOS MARCOS': 'fornecedores', SEARA: 'fornecedores',
  INTERNET: 'telefone', SALARIOS: 'salarios', VALES: 'salarios', FGTS: 'salarios', GPS: 'salarios', 'VR E VT': 'beneficios', EXTRA: 'salarios', BENEFICIOS: 'beneficios',
  MARKETING: 'marketing', 'MAQUINA DE CAFÉ': 'maquina_cafe', SISTEMA: 'sistema', ADMINISTRATIVO: 'administrativo', 'MANUTENÇÃO': 'manutencao', CONTADOR: 'contador',
  PROLABORE: 'outros', INVESTIMENTO: 'investimentos', EMPRESTIMO: 'emprestimos', SHOPPING: 'aluguel', ENERGIA: 'luz', IMPOSTOS: 'impostos', 'TAXA BANCARIA': 'outros', 'TARIFAS BANCOS': 'outros',
};
// RY (royalties) e FM (fundo) não entram: a DRE calcula 4% e 1% sozinha.

export async function render(el, { competencia, nomeMes, pode }) {
  el.innerHTML = `<h1>Importar dados</h1><p class="mut">Traga os relatórios do Gcom, do Anota AI e do ponto. Cada importação pode ser repetida: o que já existe é atualizado, sem duplicar.</p>
  <div class="grid2">
    <section class="c"><h3>1 · Vendas da loja (Gcom)</h3><p class="mut">Gcom › Vendas › <b>Consulta Venda por Período (Analítico)</b> › exportar Excel. Alimenta vendas por dia, formas de pagamento e o consumo de funcionários.</p>
      <input type="file" id="f-gcom" accept=".xls,.htm,.html"><div id="r-gcom"></div></section>
    <section class="c"><h3>2 · Delivery (Anota AI)</h3><p class="mut">Anota AI › Relatórios › <b>Relatório de pedidos</b> › baixar Excel ou CSV do mês.</p>
      <input type="file" id="f-anota" accept=".xlsx,.xls,.csv"><div id="r-anota"></div></section>
    ${pode('fechamento') ? `<section class="c"><h3>3 · Ponto (RHiD / ControlID)</h3><p class="mut">RHiD › relatório do mês por funcionário (faltas, abono, extras, atraso) em Excel/CSV — ou copie a tabela e cole abaixo. Mês: <b>${esc(nomeMes)}</b>.</p>
      <input type="file" id="f-ponto" accept=".xlsx,.xls,.csv"><textarea id="t-ponto" rows="3" placeholder="…ou cole aqui a tabela (Nome, Dia Falta, Abono, Extra 0%D, Extra Diurna)"></textarea>
      <button class="btn sec" id="b-ponto">Importar ponto colado</button><div id="r-ponto"></div></section>
    <section class="c"><h3>4 · Quebras (movimentação de caixa do Gcom)</h3><p class="mut">Copie a movimentação de caixa do mês e cole abaixo. O sistema separa as <b>sangrias com nome de funcionário</b> (ignora compras e VT/VR).</p>
      <textarea id="t-caixa" rows="4" placeholder="Cole aqui as linhas da movimentação de caixa"></textarea><button class="btn sec" id="b-caixa">Analisar</button><div id="r-caixa"></div></section>` : ''}
    ${pode('financeiro') ? `<section class="c"><h3>5 · Histórico de fornecedores (planilha DRE LOJAS)</h3><p class="mut">Aba <b>FORNECEDOR MENSAL</b>. Lança os pagamentos de cada mês nas contas da DRE (para CMV e histórico).</p>
      <input type="file" id="f-forn" accept=".xlsx,.xlsm,.xls"><div id="r-forn"></div></section>` : ''}
  </div>`;

  $('#f-gcom').onchange = (e) => tentar(async () => {
    const file = e.target.files[0]; if (!file) return;
    $('#r-gcom').innerHTML = '<p class="mut">Lendo…</p>';
    const vendas = parseGcomVendas(await lerArquivoTexto(file));
    const r = await api('POST', '/api/fechamento/importar-gcom', { vendas });
    $('#r-gcom').innerHTML = `<p class="ok-msg">✓ ${r.vendas.toLocaleString('pt-BR')} vendas · ${brl(r.total)} · ${r.dias} dias · ${r.consumo} vendas a funcionário.</p>
      ${r.sem_ligacao.length ? `<p class="alerta">${r.sem_ligacao.length} nome(s) de funcionário para ligar à equipe. <a href="#/fechamento">Ligar agora</a></p>` : ''}`;
  });

  $('#f-anota').onchange = (e) => tentar(async () => {
    const file = e.target.files[0]; if (!file) return;
    const pedidos = parseAnota(await lerPlanilha(file));
    const r = await api('POST', '/api/vendas/importar-anota', { pedidos });
    $('#r-anota').innerHTML = `<p class="ok-msg">✓ ${r.pedidos} pedidos (${r.cancelados} cancelados) · ${brl(r.total)}.</p>
      ${r.pdv ? `<p class="alerta">${r.pdv} pedidos vieram do "Balcão (PDV)". Confira se eles também foram lançados no Gcom, para não somar duas vezes.</p>` : ''}`;
  });

  const enviarPonto = async (linhas) => {
    const r = await api('POST', '/api/fechamento/importar-ponto', { competencia, linhas: parsePonto(linhas) });
    $('#r-ponto').innerHTML = `<p class="ok-msg">✓ ${r.importados} funcionário(s) importados para ${esc(nomeMes)}.</p>${r.sem_ligacao.length ? `<p class="alerta">Sem correspondência na equipe: ${r.sem_ligacao.map(esc).join(', ')}. Cadastre em Equipe ou adicione o nome alternativo.</p>` : ''}`;
  };
  if ($('#f-ponto')) {
    $('#f-ponto').onchange = (e) => tentar(async () => { const f = e.target.files[0]; if (f) await enviarPonto(await lerPlanilha(f)); });
    $('#b-ponto').onclick = (e) => tentar(() => enviarPonto(linhasDeTexto($('#t-ponto').value)), e.target);
    $('#b-caixa').onclick = (e) => tentar(async () => {
      const [lista, equipe] = await Promise.all([api('POST', '/api/fechamento/caixa/analisar', { texto: $('#t-caixa').value }), api('GET', '/api/equipe/colaboradores?todos=1')]);
      if (!lista.length) { $('#r-caixa').innerHTML = '<p class="mut">Nenhuma sangria com nome de funcionário encontrada.</p>'; return; }
      const opc = (sel) => `<option value="">— sem dono —</option>` + equipe.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
      $('#r-caixa').innerHTML = `<table><tr><th></th><th>Data</th><th>Observação</th><th class="n">R$</th><th>Funcionário</th></tr>
        ${lista.map((x, i) => `<tr><td><input type="checkbox" data-i="${i}" ${x.colaborador_id ? 'checked' : ''}></td><td>${esc(x.data?.split('-').reverse().join('/'))}</td><td>${esc(x.descricao)}</td><td class="n">${n2(x.valor)}</td><td><select data-s="${i}">${opc(x.colaborador_id)}</select></td></tr>`).join('')}</table>
        <button class="btn" id="b-lancar">Lançar quebras marcadas</button>`;
      $('#b-lancar').onclick = (ev) => tentar(async () => {
        const itens = lista.map((x, i) => ({ ...x, colaborador_id: +$(`[data-s="${i}"]`).value || null })).filter((x, i) => $(`[data-i="${i}"]`).checked);
        if (!itens.length) return aviso('Marque pelo menos uma.', 'erro');
        await api('POST', '/api/fechamento/quebras', { itens });
        aviso(`${itens.length} quebra(s) lançadas.`); $('#r-caixa').innerHTML = `<p class="ok-msg">✓ ${itens.length} quebra(s) lançadas.</p>`;
      }, ev.target);
    }, e.target);
  }

  if ($('#f-forn')) $('#f-forn').onchange = (e) => tentar(async () => {
    const file = e.target.files[0]; if (!file) return;
    if (!window.XLSX) await lerPlanilha(new File([''], 'x.csv'));
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets['FORNECEDOR MENSAL'];
    if (!ws) throw new Error('Não encontrei a aba FORNECEDOR MENSAL.');
    const L = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const blocos = L.map((l, i) => [i, l[0]]).filter(([i, n]) => typeof n === 'string' && L[i + 2]?.[0] === 'PLATLOG');
    const corpo = janela('Importar histórico de fornecedores', `<label>Loja da planilha<select id="bl">${blocos.map(([i, n]) => `<option value="${i}">${esc(n)}</option>`).join('')}</select></label>
      <label>A partir de<input type="month" id="desde" value="${competencia.slice(0, 4)}-01"></label><button class="btn" id="ok">Importar</button>`);
    corpo.querySelector('#ok').onclick = (ev) => tentar(async () => {
      const ini = +corpo.querySelector('#bl').value, desde = corpo.querySelector('#desde').value;
      const cab = L[1]; const itens = [];
      for (let r = ini + 2; r < L.length && L[r]?.[0] !== 'TOTAL'; r++) {
        const nome = String(L[r]?.[0] || '').trim(); const contaDre = CONTA_PLANILHA[nome];
        if (!nome || !contaDre) continue;
        cab.forEach((cod, j) => {
          if (typeof cod !== 'number' || cod > 1300 || j === 0) return;   // colunas de mês: 126 = jan/26, 1025 = out/25
          const mm = Math.floor(cod / 100), aa = cod % 100; const c = `20${String(aa).padStart(2, '0')}-${String(mm).padStart(2, '0')}`;
          const v = Number(L[r][j]); if (c < desde || !v) return;
          itens.push({ competencia: c, fornecedor: contaDre === 'fornecedores' || ['contador', 'sistema', 'maquina_cafe', 'telefone'].includes(contaDre) ? nome : null, descricao: nome, valor: v, conta_dre: contaDre, origem: 'planilha' });
        });
      }
      const porMes = {}; for (const it of itens) (porMes[it.competencia] ||= []).push(it);
      for (const lote of Object.values(porMes)) await api('POST', '/api/financeiro/lancamentos', { itens: lote, substituir: 'planilha' });
      corpo.fechar(); $('#r-forn').innerHTML = `<p class="ok-msg">✓ ${itens.length} lançamentos importados desde ${esc(desde)}.</p><p class="mut">Pode importar de novo: os meses enviados são substituídos.</p>`;
    }, ev.target);
  });
}
