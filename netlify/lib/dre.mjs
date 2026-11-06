// DRE no modelo da franquia Rei do Mate, montada automaticamente a partir das fontes.
import { q, one } from './db.mjs';

export const DRE_LINHAS = [
  // [chave, rótulo, grupo]
  ['venda_balcao', '(A) Venda Balcão', 'receita'],
  ['delivery_proprio', '(B) Delivery Próprio', 'receita'],
  ['delivery_terceiro', '(C) Delivery Terceiro (iFood, Rappi…)', 'receita'],
  ['fornecedores', 'Fornecedores', 'variavel'],
  ['frete', 'Frete', 'variavel'],
  ['impostos', 'Impostos', 'variavel'],
  ['royalties', 'Royalties', 'variavel'],
  ['fundo_promocao', 'Fundo de Promoção (RDM)', 'variavel'],
  ['taxas_delivery', 'Taxas Delivery', 'variavel'],
  ['custo_financeiro', 'Custo Financeiro Meios Pagto / Vouchers', 'variavel'],
  ['custo_logistico', 'Custo Logístico Delivery', 'variavel'],
  ['aluguel', 'Aluguel', 'operacional'],
  ['condominio', 'Condomínio', 'operacional'],
  ['fundo_shopping', 'Fundo de Promoção (Shopping)', 'operacional'],
  ['iptu', 'IPTU', 'operacional'],
  ['luz', 'Luz', 'operacional'],
  ['agua', 'Água', 'operacional'],
  ['telefone', 'Telefone / Internet', 'operacional'],
  ['salarios', 'Salários + encargos', 'operacional'],
  ['beneficios', 'Benefícios', 'operacional'],
  ['marketing', 'Marketing Local', 'operacional'],
  ['maquina_cafe', 'Aluguel Máquina Café', 'operacional'],
  ['sistema', 'Suporte sistema de Venda', 'operacional'],
  ['administrativo', 'Administrativo', 'operacional'],
  ['manutencao', 'Manutenção geral', 'operacional'],
  ['contador', 'Contador', 'operacional'],
  ['outros', 'Outros', 'operacional'],
  ['fornecedor_cigarros', 'Fornecedor cigarros', 'outras'],
  ['investimentos', 'Investimentos', 'outras'],
  ['emprestimos', 'Pagamentos Empréstimos', 'outras'],
];
export const CHAVES_DRE = DRE_LINHAS.map((l) => l[0]);

const ROYALTIES = 0.04, FUNDO = 0.01;
const NAO_RECEITA = ['FUNCIONARIO', 'NAO_GERA'];

/** Monta a DRE do mês com a fonte de cada linha. */
export async function montarDRE(unidade_id, comp) {
  const v = {}; const fonte = {};
  const set = (k, valor, f) => { v[k] = +(Number(valor) || 0).toFixed(2); fonte[k] = f; };

  const formas = await q('SELECT forma, valor::float, qtd FROM vendas_forma WHERE unidade_id=$1 AND competencia=$2', [unidade_id, comp]);
  const lojaReceita = formas.filter((f) => !NAO_RECEITA.includes(f.forma)).reduce((a, f) => a + f.valor, 0);
  const del = await one(`SELECT COALESCE(sum(valor),0)::float AS v, COALESCE(sum(cupons),0)::int AS n FROM vendas_dia
                          WHERE unidade_id=$1 AND canal='delivery' AND to_char(data,'YYYY-MM')=$2`, [unidade_id, comp]);
  const loja = await one(`SELECT COALESCE(sum(cupons),0)::int AS n FROM vendas_dia WHERE unidade_id=$1 AND canal='loja' AND to_char(data,'YYYY-MM')=$2`, [unidade_id, comp]);
  set('venda_balcao', lojaReceita, formas.length ? 'Gcom (vendas, sem consumo de funcionário)' : 'Gcom — importar vendas');
  set('delivery_proprio', del.v, del.v ? 'Anota AI (pedidos)' : 'Anota AI — importar pedidos');
  set('delivery_terceiro', 0, 'Sem integração iFood');

  const lanc = await q('SELECT conta_dre, sum(valor)::float AS v FROM lancamentos WHERE unidade_id=$1 AND competencia=$2 GROUP BY conta_dre', [unidade_id, comp]);
  const L = Object.fromEntries(lanc.map((r) => [r.conta_dre, r.v]));
  const guias = await q('SELECT tipo, sum(valor)::float AS v FROM guias WHERE unidade_id=$1 AND competencia=$2 GROUP BY tipo', [unidade_id, comp]);
  const G = Object.fromEntries(guias.map((r) => [r.tipo, r.v]));

  for (const [k] of DRE_LINHAS) if (!(k in v)) set(k, L[k] || 0, L[k] ? 'Lançamentos / contas a pagar' : '—');

  const impGuias = (G.DAS || 0) + (G.ISS || 0) + (G.ICMS || 0);
  if (impGuias) set('impostos', impGuias + (L.impostos || 0), 'Guias DAS/ISS/ICMS');
  const encargos = (G.INSS || 0) + (G.FGTS || 0);
  if (encargos) set('salarios', (L.salarios || 0) + encargos, 'Folha + guias INSS/FGTS');
  if (G.PARCELAMENTO) set('emprestimos', (L.emprestimos || 0) + G.PARCELAMENTO, 'Parcelas + parcelamentos de impostos');
  const outrasGuias = (G.IPTU || 0) + (G.DARF || 0) + (G.TAXA || 0);
  if (outrasGuias) set('administrativo', (L.administrativo || 0) + outrasGuias, 'Contas a pagar + IPTU/DARF/taxas');

  const base = v.venda_balcao + v.delivery_proprio + v.delivery_terceiro;
  set('royalties', base * ROYALTIES, 'Cálculo: 4% da receita');
  set('fundo_promocao', base * FUNDO, 'Cálculo: 1% da receita');

  // Custo dos meios de pagamento: % por forma + mensalidades + lançamentos
  const taxas = await q('SELECT forma, tipo, valor::float FROM taxas WHERE unidade_id=$1', [unidade_id]);
  let custoFin = L.custo_financeiro || 0;
  for (const f of formas) {
    const t = taxas.find((x) => x.tipo === 'percentual' && x.forma === f.forma);
    if (t) custoFin += f.valor * t.valor / 100;
    const tt = taxas.find((x) => x.tipo === 'por_transacao' && x.forma === f.forma);
    if (tt) custoFin += f.qtd * tt.valor;
  }
  custoFin += taxas.filter((x) => x.tipo === 'mensal').reduce((a, x) => a + x.valor, 0);
  set('custo_financeiro', custoFin, 'Taxas das máquinas, vouchers e Anota AI');

  // Ajustes manuais / travas
  const aj = await q('SELECT linha, valor::float, travado FROM dre_ajustes WHERE unidade_id=$1 AND competencia=$2', [unidade_id, comp]);
  const travas = {};
  for (const a of aj) { if (a.valor !== null) { v[a.linha] = a.valor; fonte[a.linha] = 'Ajuste manual'; } travas[a.linha] = a.travado; }

  const soma = (g) => DRE_LINHAS.filter((l) => l[2] === g).reduce((a, l) => a + v[l[0]], 0);
  const receita = soma('receita');
  const variavel = soma('variavel'), operacional = soma('operacional'), outras = soma('outras');
  const pct = (x) => (receita ? +(x / receita * 100).toFixed(2) : 0);
  const ativos = await one(`SELECT count(*)::int AS n FROM colaboradores WHERE unidade_id=$1
    AND (admissao IS NULL OR to_char(admissao,'YYYY-MM') <= $2) AND (demissao IS NULL OR to_char(demissao,'YYYY-MM') >= $2)`, [unidade_id, comp]);

  const linhas = DRE_LINHAS.map(([k, rot, g]) => ({ chave: k, rotulo: rot, grupo: g, valor: v[k], pct: pct(v[k]), fonte: fonte[k], travado: !!travas[k] }));
  const totais = {
    receita, receita_base_royalties: base, custo_variavel: variavel, lucro_bruto: receita - variavel,
    despesa_operacional: operacional, lucro_operacional: receita - variavel - operacional,
    outras_despesas: outras, lucro_liquido: receita - variavel - operacional - outras,
  };
  for (const k in totais) totais[k] = +totais[k].toFixed(2);
  const pendentes = linhas.filter((l) => l.fonte && l.fonte.includes('importar')).map((l) => l.rotulo);
  return {
    competencia: comp, linhas, totais, pct: Object.fromEntries(Object.entries(totais).map(([k, x]) => [k, pct(x)])),
    indicadores: { cupons: loja.n + del.n, funcionarios: ativos.n }, pendentes,
  };
}
