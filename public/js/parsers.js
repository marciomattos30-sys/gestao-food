// Leitura dos arquivos exportados (roda no navegador; sem dependências).

const entidades = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const limpa = (h) => h.replace(/<[^>]+>/g, '').replace(/&(#?\w+);/g, (_, e) => entidades[e] ?? (e[0] === '#' ? String.fromCharCode(+e.slice(1)) : ' ')).replace(/\s+/g, ' ').trim();

/** Tabela HTML -> linhas de células (texto). */
export function tabelaHtml(html) {
  const sem = html.replace(/<!--[\s\S]*?-->/g, '');
  const linhas = [];
  for (const tr of sem.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    linhas.push((tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(limpa));
  }
  return linhas;
}

/**
 * Gcom · "Consulta Venda por Período (Analítico)" exportada em Excel (.xls que é HTML).
 * Usa o cabeçalho para achar as colunas (as linhas de dados têm 2 colunas a mais que o cabeçalho).
 */
export function parseGcomVendas(html) {
  const linhas = tabelaHtml(html);
  const iCab = linhas.findIndex((l) => l.includes('CLIENTE') && l.some((c) => /Formas de Pagamento/i.test(c)));
  if (iCab < 0) throw new Error('Não reconheci o relatório. Exporte "Consulta Venda por Período (Analítico)" em Excel.');
  const cab = linhas[iCab];
  const pos = (re) => cab.findIndex((c) => re.test(c));
  const col = { web: pos(/^N[º°o] WEB/i), data: pos(/DATA\s+VENDA/i), bruto: pos(/VALOR BRUTO/i), desc: pos(/VALOR DO\s+DESCONTO/i),
    total: pos(/^TOTAL VENDA/i), cliente: pos(/^CLIENTE$/i), forma: pos(/Formas de Pagamento/i), atend: pos(/^ATENDENTE$/i) };
  const vendas = [];
  for (const l of linhas.slice(iCab + 1)) {
    const off = l.length - cab.length;           // colunas extras no início (EMPRESA/UNIDADE agrupadas)
    if (off < 0) continue;
    const g = (i) => (i >= 0 ? l[i + off] : '');
    const data = g(col.data);
    if (!/^\d{2}\/\d{2}\/\d{4}/.test(data || '')) continue;
    vendas.push({ n_web: g(col.web), data, bruto: g(col.bruto), desconto: g(col.desc), total: g(col.total),
      cliente: g(col.cliente), forma: g(col.forma), atendente: g(col.atend) });
  }
  return vendas;
}

/** Decodifica o arquivo do Gcom (Windows-1252). */
export async function lerArquivoTexto(file, encoding = 'windows-1252') {
  const buf = await file.arrayBuffer();
  const utf = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (/charset=utf-8/i.test(utf.slice(0, 3000)) && !utf.includes('�')) return utf;
  return new TextDecoder(encoding).decode(buf);
}

/** Planilha (xlsx/xls/csv) -> linhas, usando SheetJS (carregado sob demanda). */
export async function lerPlanilha(file) {
  if (!window.XLSX) await new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = ok; s.onerror = () => erro(new Error('Não consegui carregar o leitor de planilhas.'));
    document.head.appendChild(s);
  });
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false, raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
}

const n = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Encontra a linha de cabeçalho e mapeia colunas por palavras-chave. */
export function mapearColunas(linhas, regras) {
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const cab = linhas[i].map(n);
    const m = {};
    for (const [campo, chaves] of Object.entries(regras)) m[campo] = cab.findIndex((c) => chaves.some((k) => c.includes(k)));
    const achados = Object.values(m).filter((x) => x >= 0).length;
    if (achados >= 3) return { linhaCab: i, col: m };
  }
  return null;
}

/** Anota AI · Relatório de Pedidos (Excel/CSV). */
export function parseAnota(linhas) {
  const map = mapearColunas(linhas, {
    numero: ['pedido', 'numero', 'nº', 'id'], data: ['data'], cliente: ['cliente', 'nome'],
    local: ['endereco', 'bairro', 'local', 'area', 'regiao', 'complemento'], entrega: ['forma de entrega', 'tipo de entrega', 'entrega'],
    origem: ['origem', 'canal'], valor: ['valor', 'total'], status: ['status', 'situacao'], entregador: ['entregador', 'motoboy'],
  });
  if (!map) throw new Error('Não reconheci as colunas do relatório do Anota AI.');
  const { linhaCab, col } = map;
  return linhas.slice(linhaCab + 1).map((l) => Object.fromEntries(Object.entries(col).map(([k, i]) => [k, i >= 0 ? l[i] : ''])))
    .filter((p) => p.numero && p.data);
}

/** Ponto (RHiD / ControlID) — exportação do extrato/resumo por funcionário, ou tabela colada. */
export function parsePonto(linhas) {
  const map = mapearColunas(linhas, {
    nome: ['nome', 'funcionario', 'colaborador'], faltas: ['falta'], abono: ['abono'],
    extra_0: ['extra 0', '0%d', 'extra   0'], extra_diurna: ['extra diurna', 'extras diurnas', 'he diurna'], atraso: ['atraso'],
  });
  if (!map) throw new Error('Não reconheci as colunas do ponto (precisa de Nome e pelo menos Faltas/Extras).');
  const { linhaCab, col } = map;
  return linhas.slice(linhaCab + 1).map((l) => Object.fromEntries(Object.entries(col).map(([k, i]) => [k, i >= 0 ? String(l[i] ?? '').trim() : ''])))
    .filter((p) => p.nome);
}

/** Texto colado (tabulações) -> linhas. */
export const linhasDeTexto = (t) => String(t || '').split(/\r?\n/).filter((x) => x.trim()).map((x) => x.split('\t'));
