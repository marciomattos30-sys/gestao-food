// /api/vendas/* — delivery (Anota AI) e painel de vendas.
import { q, one, HttpError } from '../lib/db.mjs';
import { json, roteador, num, competenciaValida } from '../lib/http.mjs';
import { exigir } from '../lib/auth.mjs';
import { montarDRE } from '../lib/dre.mjs';

const comp = (c) => { if (!competenciaValida(c)) throw new HttpError(400, 'Mês inválido.'); return c; };
const dataIso = (d) => {
  const s = String(d || '').trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
};
const cancelado = (st) => /cancel/i.test(String(st || ''));

export default roteador([
  /** Pedidos do Anota AI (Relatório de Pedidos em Excel/CSV, lido no navegador). */
  ['POST', '/api/vendas/importar-anota', async ({ req, body }) => {
    const s = await exigir(req, 'vendas');
    const pedidos = (Array.isArray(body.pedidos) ? body.pedidos : []).map((p) => ({
      numero: String(p.numero || '').replace('#', '').trim(), data: dataIso(p.data), cliente: p.cliente || null,
      local: p.local || null, entrega: p.entrega || null, origem: p.origem || null, valor: num(p.valor),
      status: p.status || null, entregador: p.entregador || null,
    })).filter((p) => p.numero && p.data);
    if (!pedidos.length) throw new HttpError(400, 'Nenhum pedido reconhecido. Confira as colunas Número, Data e Valor.');
    await q(`INSERT INTO pedidos_delivery (unidade_id, numero, data, cliente, local, entrega, origem, valor, status, entregador)
      SELECT $1, x.numero, x.data::date, x.cliente, x.local, x.entrega, x.origem, x.valor, x.status, x.entregador
        FROM json_to_recordset($2::json) AS x(numero text, data text, cliente text, local text, entrega text, origem text, valor numeric, status text, entregador text)
      ON CONFLICT (unidade_id, numero) DO UPDATE SET data=EXCLUDED.data, cliente=EXCLUDED.cliente, local=EXCLUDED.local, entrega=EXCLUDED.entrega,
        origem=EXCLUDED.origem, valor=EXCLUDED.valor, status=EXCLUDED.status, entregador=EXCLUDED.entregador`,
      [s.unidade_id, JSON.stringify(pedidos)]);
    // recalcula o delivery por dia
    const dias = [...new Set(pedidos.map((p) => p.data))];
    await q(`DELETE FROM vendas_dia WHERE unidade_id=$1 AND canal='delivery' AND data = ANY($2::date[])`, [s.unidade_id, dias]);
    await q(`INSERT INTO vendas_dia (unidade_id, data, canal, valor, cupons)
      SELECT unidade_id, data, 'delivery', sum(valor), count(*) FROM pedidos_delivery
       WHERE unidade_id=$1 AND data = ANY($2::date[]) AND (status IS NULL OR status !~* 'cancel') GROUP BY unidade_id, data`, [s.unidade_id, dias]);
    const validos = pedidos.filter((p) => !cancelado(p.status));
    return json({ ok: true, pedidos: pedidos.length, cancelados: pedidos.length - validos.length, total: validos.reduce((a, p) => a + p.valor, 0),
      pdv: validos.filter((p) => /pdv|balc/i.test(p.origem || '')).length });
  }],

  /** Painel do mês: loja (Gcom) + delivery (Anota AI). */
  ['GET', '/api/vendas/painel/:comp', async ({ req, params }) => {
    const s = await exigir(req, 'painel');
    const c = comp(params.comp);
    const dias = await q(`SELECT to_char(data,'YYYY-MM-DD') AS data, canal, valor::float, cupons FROM vendas_dia
      WHERE unidade_id=$1 AND to_char(data,'YYYY-MM')=$2 ORDER BY data`, [s.unidade_id, c]);
    const formas = await q('SELECT forma, valor::float, qtd FROM vendas_forma WHERE unidade_id=$1 AND competencia=$2 ORDER BY valor DESC', [s.unidade_id, c]);
    const base = `FROM pedidos_delivery WHERE unidade_id=$1 AND to_char(data,'YYYY-MM')=$2 AND (status IS NULL OR status !~* 'cancel')`;
    const locais = await q(`SELECT COALESCE(NULLIF(local,''), entrega, 'Não informado') AS local, count(*)::int AS pedidos, sum(valor)::float AS valor ${base} GROUP BY 1 ORDER BY 3 DESC LIMIT 15`, [s.unidade_id, c]);
    const clientes = await q(`SELECT cliente, count(*)::int AS pedidos, sum(valor)::float AS valor, max(data) AS ultimo ${base} AND cliente IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 10`, [s.unidade_id, c]);
    const entregadores = await q(`SELECT entregador, count(*)::int AS pedidos, sum(valor)::float AS valor ${base} AND entregador IS NOT NULL AND entregador<>'' GROUP BY 1 ORDER BY 2 DESC`, [s.unidade_id, c]);
    const canc = await one(`SELECT count(*)::int AS n FROM pedidos_delivery WHERE unidade_id=$1 AND to_char(data,'YYYY-MM')=$2 AND status ~* 'cancel'`, [s.unidade_id, c]);
    const tot = (canal) => dias.filter((d) => d.canal === canal).reduce((a, d) => ({ valor: a.valor + d.valor, cupons: a.cupons + d.cupons }), { valor: 0, cupons: 0 });
    const loja = tot('loja'), delivery = tot('delivery');
    const fech = await one(`SELECT COALESCE((SELECT sum(total) FROM consumo WHERE unidade_id=$1 AND competencia=$2),0)
      + COALESCE((SELECT sum(valor) FROM vales WHERE unidade_id=$1 AND competencia=$2),0)
      + COALESCE((SELECT sum(valor) FROM quebras WHERE unidade_id=$1 AND competencia=$2),0) AS v`, [s.unidade_id, c]);
    let dre = null;
    if (s.papel !== 'equipe') { try { dre = await montarDRE(s.unidade_id, c); } catch (e) { console.error(e); } }
    return json({ competencia: c, loja, delivery, cancelados: canc.n, dias, formas, locais, clientes, entregadores, desconto_folha: Number(fech.v), dre_resumo: dre && { totais: dre.totais, pct: dre.pct } });
  }],
]);

export const config = { path: '/api/vendas/*' };
