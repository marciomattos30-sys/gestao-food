// /api/financeiro/* — fornecedores, contas/lançamentos, taxas e máquinas, guias de impostos, CMV e DRE.
import { q, one, HttpError } from '../lib/db.mjs';
import { json, roteador, num, competenciaValida } from '../lib/http.mjs';
import { exigir } from '../lib/auth.mjs';
import { montarDRE, CHAVES_DRE, DRE_LINHAS } from '../lib/dre.mjs';

const area = (req) => exigir(req, 'financeiro');
const comp = (c) => { if (!competenciaValida(c)) throw new HttpError(400, 'Mês inválido (AAAA-MM).'); return c; };
const conta = (c) => { if (!CHAVES_DRE.includes(c)) throw new HttpError(400, 'Conta da DRE inválida.'); return c; };
const TIPOS_GUIA = ['DAS', 'INSS', 'FGTS', 'ISS', 'ICMS', 'IPTU', 'DARF', 'PARCELAMENTO', 'TAXA'];
const proximoMes = (c) => { const [a, m] = c.split('-').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`; };
const somaMes = (d) => { if (!d) return null; const x = new Date(d + 'T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() + 1); return x.toISOString().slice(0, 10); };

export default roteador([
  ['GET', '/api/financeiro/contas-dre', async ({ req }) => { await area(req); return json(DRE_LINHAS.map(([k, r, g]) => ({ chave: k, rotulo: r, grupo: g }))); }],

  // ---------- Fornecedores ----------
  ['GET', '/api/financeiro/fornecedores', async ({ req }) => {
    const s = await area(req);
    return json(await q(`SELECT f.*, COALESCE((SELECT sum(valor) FROM lancamentos l WHERE l.fornecedor_id=f.id AND l.competencia >= to_char(now() - interval '11 months','YYYY-MM')),0)::float AS total_12m
      FROM fornecedores f WHERE unidade_id=$1 ORDER BY total_12m DESC, nome`, [s.unidade_id]));
  }],
  ['POST', '/api/financeiro/fornecedores', async ({ req, body }) => {
    const s = await area(req);
    if (!body.nome) throw new HttpError(400, 'Informe o nome.');
    try {
      const f = await one('INSERT INTO fornecedores (unidade_id, nome, categoria, conta_dre, cnpj, prazo_dias) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [s.unidade_id, String(body.nome).trim().toUpperCase(), body.categoria || null, conta(body.conta_dre || 'fornecedores'), body.cnpj || null, body.prazo_dias || null]);
      return json({ ok: true, id: f.id });
    } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'Fornecedor já cadastrado.'); }
  }],
  ['PUT', '/api/financeiro/fornecedores/:id', async ({ req, params, body }) => {
    const s = await area(req);
    await q('UPDATE fornecedores SET categoria=$3, conta_dre=$4, cnpj=$5, prazo_dias=$6 WHERE id=$1 AND unidade_id=$2',
      [Number(params.id), s.unidade_id, body.categoria || null, conta(body.conta_dre), body.cnpj || null, body.prazo_dias || null]);
    return json({ ok: true });
  }],

  // ---------- Lançamentos (contas pagas / a pagar) ----------
  ['GET', '/api/financeiro/lancamentos/:comp', async ({ req, params }) => {
    const s = await area(req);
    return json(await q(`SELECT l.id, l.data, l.descricao, l.valor::float, l.conta_dre, l.origem, l.recorrente, f.nome AS fornecedor
      FROM lancamentos l LEFT JOIN fornecedores f ON f.id=l.fornecedor_id WHERE l.unidade_id=$1 AND l.competencia=$2 ORDER BY l.data NULLS LAST, l.id`,
      [s.unidade_id, comp(params.comp)]));
  }],
  ['POST', '/api/financeiro/lancamentos', async ({ req, body }) => {
    const s = await area(req);
    const itens = Array.isArray(body.itens) ? body.itens : [body];
    if (body.substituir === 'planilha') {
      // reimportação da planilha: troca os lançamentos de origem "planilha" dos meses enviados
      const meses = [...new Set(itens.map((l) => comp(l.competencia)))];
      await q(`DELETE FROM lancamentos WHERE unidade_id=$1 AND origem='planilha' AND competencia = ANY($2::text[])`, [s.unidade_id, meses]);
    }
    for (const l of itens) {
      let f = null;
      if (l.fornecedor) {
        const nome = String(l.fornecedor).trim().toUpperCase();
        f = await one('SELECT id, conta_dre FROM fornecedores WHERE unidade_id=$1 AND nome=$2', [s.unidade_id, nome]);
        if (!f && l.criar_fornecedor !== false) f = await one(`INSERT INTO fornecedores (unidade_id, nome, conta_dre) VALUES ($1,$2,$3) RETURNING id, conta_dre`, [s.unidade_id, nome, conta(l.conta_dre || 'outros')]);
      }
      const v = num(l.valor);
      if (!v) continue;
      await q('INSERT INTO lancamentos (unidade_id, competencia, data, fornecedor_id, descricao, valor, conta_dre, origem, recorrente) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [s.unidade_id, comp(l.competencia), l.data || null, f?.id || null, l.descricao || null, v, conta(l.conta_dre || f?.conta_dre || 'outros'), l.origem || 'manual', !!l.recorrente]);
    }
    return json({ ok: true });
  }],
  ['DELETE', '/api/financeiro/lancamentos/:id', async ({ req, params }) => {
    const s = await area(req);
    await q('DELETE FROM lancamentos WHERE id=$1 AND unidade_id=$2', [Number(params.id), s.unidade_id]);
    return json({ ok: true });
  }],
  ['POST', '/api/financeiro/recorrentes/:comp', async ({ req, params }) => {
    // copia as contas marcadas como recorrentes do mês anterior para o mês informado
    const s = await area(req);
    const c = comp(params.comp);
    const [a, m] = c.split('-').map(Number);
    const ant = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
    const r = await q(`INSERT INTO lancamentos (unidade_id, competencia, data, fornecedor_id, descricao, valor, conta_dre, origem, recorrente)
      SELECT unidade_id, $2, CASE WHEN data IS NULL THEN NULL ELSE (data + interval '1 month')::date END, fornecedor_id, descricao, valor, conta_dre, 'recorrente', true
        FROM lancamentos WHERE unidade_id=$1 AND competencia=$3 AND recorrente
         AND NOT EXISTS (SELECT 1 FROM lancamentos x WHERE x.unidade_id=$1 AND x.competencia=$2 AND x.recorrente AND x.descricao IS NOT DISTINCT FROM lancamentos.descricao AND x.fornecedor_id IS NOT DISTINCT FROM lancamentos.fornecedor_id)
      RETURNING id`, [s.unidade_id, c, ant]);
    return json({ ok: true, copiados: r.length });
  }],

  // ---------- Taxas e máquinas ----------
  ['GET', '/api/financeiro/taxas', async ({ req }) => {
    const s = await area(req);
    return json(await q('SELECT id, nome, forma, tipo, valor::float, prazo_dias FROM taxas WHERE unidade_id=$1 ORDER BY tipo, nome', [s.unidade_id]));
  }],
  ['POST', '/api/financeiro/taxas', async ({ req, body }) => {
    const s = await area(req);
    if (!body.nome || !['percentual', 'mensal', 'por_transacao'].includes(body.tipo)) throw new HttpError(400, 'Preencha nome e tipo.');
    await q('INSERT INTO taxas (unidade_id, nome, forma, tipo, valor, prazo_dias) VALUES ($1,$2,$3,$4,$5,$6)',
      [s.unidade_id, body.nome, body.forma || null, body.tipo, num(body.valor), body.prazo_dias === '' ? null : body.prazo_dias ?? null]);
    return json({ ok: true });
  }],
  ['PUT', '/api/financeiro/taxas/:id', async ({ req, params, body }) => {
    const s = await area(req);
    await q('UPDATE taxas SET nome=$3, forma=$4, tipo=$5, valor=$6, prazo_dias=$7 WHERE id=$1 AND unidade_id=$2',
      [Number(params.id), s.unidade_id, body.nome, body.forma || null, body.tipo, num(body.valor), body.prazo_dias === '' ? null : body.prazo_dias ?? null]);
    return json({ ok: true });
  }],
  ['DELETE', '/api/financeiro/taxas/:id', async ({ req, params }) => {
    const s = await area(req);
    await q('DELETE FROM taxas WHERE id=$1 AND unidade_id=$2', [Number(params.id), s.unidade_id]);
    return json({ ok: true });
  }],
  ['GET', '/api/financeiro/custo-pagamentos/:comp', async ({ req, params }) => {
    const s = await area(req);
    const c = comp(params.comp);
    const formas = await q('SELECT forma, valor::float, qtd FROM vendas_forma WHERE unidade_id=$1 AND competencia=$2 ORDER BY valor DESC', [s.unidade_id, c]);
    const taxas = await q('SELECT nome, forma, tipo, valor::float, prazo_dias FROM taxas WHERE unidade_id=$1', [s.unidade_id]);
    const linhas = formas.map((f) => {
      const tp = taxas.find((t) => t.tipo === 'percentual' && t.forma === f.forma);
      const tt = taxas.find((t) => t.tipo === 'por_transacao' && t.forma === f.forma);
      const custo = (tp ? f.valor * tp.valor / 100 : 0) + (tt ? f.qtd * tt.valor : 0);
      return { ...f, taxa: tp?.valor ?? null, prazo: tp?.prazo_dias ?? null, custo: +custo.toFixed(2) };
    });
    const mensal = taxas.filter((t) => t.tipo === 'mensal');
    const total = linhas.reduce((a, l) => a + l.custo, 0) + mensal.reduce((a, t) => a + t.valor, 0);
    const vendas = formas.filter((f) => !['FUNCIONARIO', 'NAO_GERA'].includes(f.forma)).reduce((a, f) => a + f.valor, 0);
    return json({ linhas, mensal, total: +total.toFixed(2), vendas, taxa_efetiva: vendas ? +(total / vendas * 100).toFixed(2) : 0 });
  }],

  // ---------- Guias de impostos ----------
  ['GET', '/api/financeiro/guias', async ({ req }) => {
    const s = await area(req);
    return json(await q(`SELECT id, tipo, competencia, vencimento, valor::float, codigo_barras, paga, pago_em FROM guias
      WHERE unidade_id=$1 AND (NOT paga OR pago_em >= current_date - 60) ORDER BY paga, vencimento`, [s.unidade_id]));
  }],
  ['POST', '/api/financeiro/guias', async ({ req, body }) => {
    const s = await area(req);
    if (!TIPOS_GUIA.includes(body.tipo)) throw new HttpError(400, 'Tipo de guia inválido.');
    await q('INSERT INTO guias (unidade_id, tipo, competencia, vencimento, valor, codigo_barras) VALUES ($1,$2,$3,$4,$5,$6)',
      [s.unidade_id, body.tipo, comp(body.competencia), body.vencimento || null, num(body.valor), (body.codigo_barras || '').replace(/[^\d]/g, '') || null]);
    return json({ ok: true });
  }],
  ['POST', '/api/financeiro/guias/:id/paga', async ({ req, params, body }) => {
    const s = await area(req);
    await q('UPDATE guias SET paga=$3, pago_em=CASE WHEN $3 THEN current_date ELSE NULL END WHERE id=$1 AND unidade_id=$2', [Number(params.id), s.unidade_id, body.paga !== false]);
    return json({ ok: true });
  }],
  ['POST', '/api/financeiro/guias/:id/repetir', async ({ req, params }) => {
    const s = await area(req);
    const g = await one('SELECT * FROM guias WHERE id=$1 AND unidade_id=$2', [Number(params.id), s.unidade_id]);
    if (!g) throw new HttpError(404, 'Guia não encontrada.');
    const venc = g.vencimento ? somaMes(new Date(g.vencimento).toISOString().slice(0, 10)) : null;
    await q('INSERT INTO guias (unidade_id, tipo, competencia, vencimento, valor) VALUES ($1,$2,$3,$4,$5)', [s.unidade_id, g.tipo, proximoMes(g.competencia), venc, g.valor]);
    return json({ ok: true });
  }],
  ['DELETE', '/api/financeiro/guias/:id', async ({ req, params }) => {
    const s = await area(req);
    await q('DELETE FROM guias WHERE id=$1 AND unidade_id=$2', [Number(params.id), s.unidade_id]);
    return json({ ok: true });
  }],

  // ---------- CMV ----------
  ['GET', '/api/financeiro/cmv/:ano', async ({ req, params }) => {
    const s = await area(req);
    const ano = String(params.ano).replace(/\D/g, '').slice(0, 4);
    const meses = await q(`SELECT competencia, sum(valor)::float AS compras FROM lancamentos WHERE unidade_id=$1 AND conta_dre='fornecedores' AND competencia LIKE $2 GROUP BY 1 ORDER BY 1`, [s.unidade_id, ano + '-%']);
    const forn = await q(`SELECT COALESCE(f.nome,'(sem fornecedor)') AS fornecedor, sum(l.valor)::float AS valor FROM lancamentos l LEFT JOIN fornecedores f ON f.id=l.fornecedor_id
      WHERE l.unidade_id=$1 AND l.conta_dre='fornecedores' AND l.competencia LIKE $2 GROUP BY 1 ORDER BY 2 DESC`, [s.unidade_id, ano + '-%']);
    const receita = await q(`SELECT competencia, sum(valor)::float AS v FROM vendas_forma WHERE unidade_id=$1 AND competencia LIKE $2 AND forma NOT IN ('FUNCIONARIO','NAO_GERA') GROUP BY 1`, [s.unidade_id, ano + '-%']);
    const del = await q(`SELECT to_char(data,'YYYY-MM') AS competencia, sum(valor)::float AS v FROM vendas_dia WHERE unidade_id=$1 AND canal='delivery' AND to_char(data,'YYYY') = $2 GROUP BY 1`, [s.unidade_id, ano]);
    const R = {}; for (const r of [...receita, ...del]) R[r.competencia] = (R[r.competencia] || 0) + r.v;
    const meta = await one('SELECT meta_cmv::float FROM unidades WHERE id=$1', [s.unidade_id]);
    return json({ meta: meta.meta_cmv, meses: meses.map((m) => ({ ...m, receita: R[m.competencia] || 0, pct: R[m.competencia] ? +(m.compras / R[m.competencia] * 100).toFixed(1) : null })), fornecedores: forn });
  }],

  // ---------- DRE ----------
  ['GET', '/api/financeiro/dre/:comp', async ({ req, params }) => {
    const s = await area(req);
    return json(await montarDRE(s.unidade_id, comp(params.comp)));
  }],
  ['PUT', '/api/financeiro/dre/:comp', async ({ req, params, body }) => {
    // ajuste manual e/ou trava de uma linha
    const s = await area(req);
    const c = comp(params.comp), linha = conta(body.linha);
    const atual = await one('SELECT travado FROM dre_ajustes WHERE unidade_id=$1 AND competencia=$2 AND linha=$3', [s.unidade_id, c, linha]);
    if (atual?.travado && body.travado !== false) throw new HttpError(400, 'Linha travada. Destrave para alterar.');
    await q(`INSERT INTO dre_ajustes (unidade_id, competencia, linha, valor, travado) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (unidade_id, competencia, linha) DO UPDATE SET valor=EXCLUDED.valor, travado=EXCLUDED.travado`,
      [s.unidade_id, c, linha, body.valor === null || body.valor === undefined || body.valor === '' ? null : num(body.valor), !!body.travado]);
    return json({ ok: true });
  }],
  ['POST', '/api/financeiro/dre/:comp/travar', async ({ req, params }) => {
    // trava todas as linhas com o valor atual (fechamento do mês)
    const s = await area(req);
    const c = comp(params.comp);
    const d = await montarDRE(s.unidade_id, c);
    for (const l of d.linhas) await q(`INSERT INTO dre_ajustes (unidade_id, competencia, linha, valor, travado) VALUES ($1,$2,$3,$4,true)
      ON CONFLICT (unidade_id, competencia, linha) DO UPDATE SET valor=EXCLUDED.valor, travado=true`, [s.unidade_id, c, l.chave, l.valor]);
    return json({ ok: true });
  }],
]);

export const config = { path: '/api/financeiro/*' };
