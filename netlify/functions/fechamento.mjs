// /api/fechamento/* — importação do Gcom, consumo, vales, quebras, ponto e fechamento do mês.
import { q, one, HttpError } from '../lib/db.mjs';
import { json, roteador, num, competenciaValida } from '../lib/http.mjs';
import { exigir } from '../lib/auth.mjs';
import { nomeBase, ligarNome, nomeNoTexto, grupoForma, norm } from '../lib/nomes.mjs';

const area = (req) => exigir(req, 'fechamento');
const comp = (c) => { if (!competenciaValida(c)) throw new HttpError(400, 'Mês inválido (use AAAA-MM).'); return c; };
const isoData = (d) => {
  // aceita "30/10/2026 16:24:11", "30/10/2026" ou "2026-10-30"
  const s = String(d || '').trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}-03:00`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? s : null;
};

async function base(unidade_id) {
  const colaboradores = await q('SELECT id, nome FROM colaboradores WHERE unidade_id=$1', [unidade_id]);
  const apelidos = await q('SELECT colaborador_id, apelido FROM apelidos WHERE unidade_id=$1', [unidade_id]);
  return { colaboradores, apelidos };
}

export default roteador([
  /**
   * Importa a "Consulta Venda por Período (Analítico)" do Gcom (lida no navegador).
   * vendas: [{ n_web, data, cliente, forma, bruto, desconto, total, atendente }]
   * Alimenta: vendas por dia (loja), vendas por forma de pagamento e consumo de funcionários.
   */
  ['POST', '/api/fechamento/importar-gcom', async ({ req, body }) => {
    const s = await exigir(req, 'vendas');
    const vendas = Array.isArray(body.vendas) ? body.vendas : [];
    if (!vendas.length) throw new HttpError(400, 'Nenhuma venda encontrada no arquivo.');
    if (vendas.length > 30000) throw new HttpError(400, 'Arquivo grande demais. Importe um mês por vez.');
    const { colaboradores, apelidos } = await base(s.unidade_id);

    const porDia = new Map(), porForma = new Map(), meses = new Set();
    const consumo = []; const semLigacao = new Map();
    for (const v of vendas) {
      const iso = isoData(v.data); if (!iso) continue;
      const dia = iso.slice(0, 10), c = dia.slice(0, 7);
      meses.add(c);
      const total = num(v.total);
      const g = grupoForma(String(v.forma || ''));
      const d = porDia.get(dia) || { valor: 0, cupons: 0 }; d.valor += total; d.cupons += 1; porDia.set(dia, d);
      const kf = c + '|' + g; const f = porForma.get(kf) || { valor: 0, qtd: 0 }; f.valor += total; f.qtd += 1; porForma.set(kf, f);
      if (g === 'FUNCIONARIO') {
        const cliente = nomeBase(v.cliente);
        const lig = ligarNome(cliente, colaboradores, apelidos);
        if (!lig || lig.certeza === 'provavel') semLigacao.set(cliente, (semLigacao.get(cliente) || 0) + 1);
        consumo.push({ competencia: c, data: iso, n_web: String(v.n_web || iso + cliente), cliente_gcom: cliente,
          colaborador_id: lig && lig.certeza !== 'provavel' ? lig.id : null, bruto: num(v.bruto), desconto: num(v.desconto), total, atendente: v.atendente || null });
      }
    }
    // gravação em lote (poucas idas ao banco)
    if (consumo.length) await q(`INSERT INTO consumo (unidade_id, competencia, data, n_web, cliente_gcom, colaborador_id, bruto, desconto, total, atendente)
      SELECT $1, x.competencia, x.data::timestamptz, x.n_web, x.cliente_gcom, x.colaborador_id, x.bruto, x.desconto, x.total, x.atendente
        FROM json_to_recordset($2::json) AS x(competencia text, data text, n_web text, cliente_gcom text, colaborador_id int, bruto numeric, desconto numeric, total numeric, atendente text)
      ON CONFLICT (unidade_id, n_web) DO UPDATE SET total=EXCLUDED.total, bruto=EXCLUDED.bruto, desconto=EXCLUDED.desconto,
        colaborador_id=COALESCE(consumo.colaborador_id, EXCLUDED.colaborador_id)`, [s.unidade_id, JSON.stringify(consumo)]);
    const dias = [...porDia].map(([data, d]) => ({ data, valor: +d.valor.toFixed(2), cupons: d.cupons }));
    if (dias.length) await q(`INSERT INTO vendas_dia (unidade_id, data, canal, valor, cupons)
      SELECT $1, x.data::date, 'loja', x.valor, x.cupons FROM json_to_recordset($2::json) AS x(data text, valor numeric, cupons int)
      ON CONFLICT (unidade_id, data, canal) DO UPDATE SET valor=EXCLUDED.valor, cupons=EXCLUDED.cupons`, [s.unidade_id, JSON.stringify(dias)]);
    for (const c of meses) await q('DELETE FROM vendas_forma WHERE unidade_id=$1 AND competencia=$2', [s.unidade_id, c]);
    const formas = [...porForma].map(([k, f]) => { const [c, g] = k.split('|'); return { competencia: c, forma: g, valor: +f.valor.toFixed(2), qtd: f.qtd }; });
    if (formas.length) await q(`INSERT INTO vendas_forma (unidade_id, competencia, forma, valor, qtd)
      SELECT $1, x.competencia, x.forma, x.valor, x.qtd FROM json_to_recordset($2::json) AS x(competencia text, forma text, valor numeric, qtd int)`,
      [s.unidade_id, JSON.stringify(formas)]);
    const nConsumo = consumo.length;
    const sugestoes = [...semLigacao.keys()].map((nome) => {
      const lig = ligarNome(nome, colaboradores, apelidos);
      return { nome, vendas: semLigacao.get(nome), sugestao: lig?.id || null };
    });
    return json({
      ok: true, vendas: vendas.length, dias: porDia.size, meses: [...meses],
      total: [...porDia.values()].reduce((a, d) => a + d.valor, 0), consumo: nConsumo, sem_ligacao: sugestoes,
    });
  }],

  /** Fechamento do mês por colaborador. */
  ['GET', '/api/fechamento/mes/:comp', async ({ req, params }) => {
    const s = await area(req);
    const c = comp(params.comp);
    const linhas = await q(`
      SELECT co.id, co.nome, co.funcao,
        COALESCE((SELECT sum(total) FROM consumo WHERE colaborador_id=co.id AND competencia=$2),0)::float AS consumo,
        COALESCE((SELECT count(*) FROM consumo WHERE colaborador_id=co.id AND competencia=$2),0)::int AS qtd_consumo,
        COALESCE((SELECT sum(valor) FROM vales WHERE colaborador_id=co.id AND competencia=$2),0)::float AS vales,
        COALESCE((SELECT sum(valor) FROM quebras WHERE colaborador_id=co.id AND competencia=$2),0)::float AS quebras,
        p.faltas::float, p.abono::float, p.extra_0, p.extra_diurna, p.atraso
      FROM colaboradores co
      LEFT JOIN ponto p ON p.colaborador_id=co.id AND p.competencia=$2
      WHERE co.unidade_id=$1
        AND (co.admissao IS NULL OR to_char(co.admissao,'YYYY-MM') <= $2)
        AND (co.demissao IS NULL OR to_char(co.demissao,'YYYY-MM') >= $2)
      ORDER BY co.nome`, [s.unidade_id, c]);
    for (const l of linhas) l.total = +(l.consumo + l.vales + l.quebras).toFixed(2);
    const sem = await q(`SELECT cliente_gcom AS nome, count(*)::int AS vendas, sum(total)::float AS total
      FROM consumo WHERE unidade_id=$1 AND competencia=$2 AND colaborador_id IS NULL GROUP BY cliente_gcom ORDER BY 3 DESC`, [s.unidade_id, c]);
    const tot = linhas.reduce((a, l) => ({ consumo: a.consumo + l.consumo, vales: a.vales + l.vales, quebras: a.quebras + l.quebras, total: a.total + l.total }), { consumo: 0, vales: 0, quebras: 0, total: 0 });
    return json({ competencia: c, linhas, sem_ligacao: sem, totais: tot });
  }],

  ['GET', '/api/fechamento/detalhe/:comp/:colab', async ({ req, params }) => {
    const s = await area(req);
    const c = comp(params.comp), id = Number(params.colab);
    return json({
      consumo: await q('SELECT id, data, n_web, total::float, desconto::float, atendente FROM consumo WHERE unidade_id=$1 AND competencia=$2 AND colaborador_id=$3 ORDER BY data', [s.unidade_id, c, id]),
      vales: await q('SELECT id, data, valor::float, obs FROM vales WHERE unidade_id=$1 AND competencia=$2 AND colaborador_id=$3 ORDER BY data', [s.unidade_id, c, id]),
      quebras: await q('SELECT id, data, valor::float, descricao FROM quebras WHERE unidade_id=$1 AND competencia=$2 AND colaborador_id=$3 ORDER BY data', [s.unidade_id, c, id]),
    });
  }],

  ['POST', '/api/fechamento/vales', async ({ req, body }) => {
    const s = await area(req);
    const itens = Array.isArray(body.itens) ? body.itens : [body];
    for (const v of itens) {
      const c = comp(v.competencia);
      const col = await one('SELECT id FROM colaboradores WHERE id=$1 AND unidade_id=$2', [Number(v.colaborador_id), s.unidade_id]);
      if (!col) throw new HttpError(400, 'Colaborador inválido.');
      if (!(num(v.valor) > 0)) throw new HttpError(400, 'Valor do vale inválido.');
      await q('INSERT INTO vales (unidade_id, competencia, data, colaborador_id, valor, obs) VALUES ($1,$2,$3,$4,$5,$6)',
        [s.unidade_id, c, v.data || null, col.id, num(v.valor), v.obs || null]);
    }
    return json({ ok: true, lancados: itens.length });
  }],
  ['DELETE', '/api/fechamento/vales/:id', async ({ req, params }) => {
    const s = await area(req);
    await q('DELETE FROM vales WHERE id=$1 AND unidade_id=$2', [Number(params.id), s.unidade_id]);
    return json({ ok: true });
  }],

  ['POST', '/api/fechamento/quebras', async ({ req, body }) => {
    const s = await area(req);
    const itens = Array.isArray(body.itens) ? body.itens : [body];
    for (const v of itens) {
      const c = comp(v.competencia);
      if (!(num(v.valor) > 0)) throw new HttpError(400, 'Valor da quebra inválido.');
      const col = v.colaborador_id ? await one('SELECT id FROM colaboradores WHERE id=$1 AND unidade_id=$2', [Number(v.colaborador_id), s.unidade_id]) : null;
      await q('INSERT INTO quebras (unidade_id, competencia, data, colaborador_id, valor, descricao) VALUES ($1,$2,$3,$4,$5,$6)',
        [s.unidade_id, c, v.data || null, col?.id || null, num(v.valor), v.descricao || null]);
    }
    return json({ ok: true, lancados: itens.length });
  }],
  ['DELETE', '/api/fechamento/quebras/:id', async ({ req, params }) => {
    const s = await area(req);
    await q('DELETE FROM quebras WHERE id=$1 AND unidade_id=$2', [Number(params.id), s.unidade_id]);
    return json({ ok: true });
  }],

  /**
   * Lê a Movimentação de Caixa do Gcom (texto copiado) e sugere as quebras:
   * SANGRIA com nome de funcionário na observação. Ignora compras e VT/VR.
   */
  ['POST', '/api/fechamento/caixa/analisar', async ({ req, body }) => {
    const s = await area(req);
    const { colaboradores, apelidos } = await base(s.unidade_id);
    const out = [];
    for (const linha of String(body.texto || '').split(/\r?\n/)) {
      const cols = linha.split('\t').map((x) => x.trim());
      const iTipo = cols.findIndex((x) => /^(SANGRIA|REFOR[CÇ]O|ABERTURA)$/i.test(x));
      if (iTipo < 0 || !/^SANGRIA$/i.test(cols[iTipo])) continue;
      const data = cols.find((x) => /^\d{2}\/\d{2}\/\d{4}$/.test(x));
      const valor = num(cols[iTipo - 1]);
      const obs = cols[iTipo + 1] || '';
      const O = norm(obs);
      if (/^(VT|VR)\b|VT E VR|VT VR|COMPRA|COMPRAR/.test(O)) continue;
      const lig = nomeNoTexto(obs, colaboradores, apelidos);
      const [d, m, a] = (data || '').split('/');
      out.push({ data: data ? `${a}-${m}-${d}` : null, competencia: data ? `${a}-${m}` : null, valor, descricao: obs, colaborador_id: lig?.id || null, certeza: lig?.certeza || 'sem' });
    }
    return json(out);
  }],

  ['PUT', '/api/fechamento/ponto', async ({ req, body }) => {
    const s = await area(req);
    const c = comp(body.competencia);
    for (const p of body.itens || []) {
      const col = await one('SELECT id FROM colaboradores WHERE id=$1 AND unidade_id=$2', [Number(p.colaborador_id), s.unidade_id]);
      if (!col) continue;
      await q(`INSERT INTO ponto (unidade_id, competencia, colaborador_id, faltas, abono, extra_0, extra_diurna, atraso)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (unidade_id, competencia, colaborador_id) DO UPDATE SET faltas=EXCLUDED.faltas, abono=EXCLUDED.abono,
                 extra_0=EXCLUDED.extra_0, extra_diurna=EXCLUDED.extra_diurna, atraso=EXCLUDED.atraso`,
        [s.unidade_id, c, col.id, num(p.faltas), num(p.abono), p.extra_0 || null, p.extra_diurna || null, p.atraso || null]);
    }
    return json({ ok: true });
  }],

  /**
   * Ponto (ControlID / RHiD): linhas já resumidas por funcionário, vindas da exportação
   * do "Extrato por Período" ou da folha colada. [{ nome, faltas, abono, extra_0, extra_diurna, atraso }]
   */
  ['POST', '/api/fechamento/importar-ponto', async ({ req, body }) => {
    const s = await area(req);
    const c = comp(body.competencia);
    const { colaboradores, apelidos } = await base(s.unidade_id);
    const ok = [], sem = [];
    for (const p of body.linhas || []) {
      const lig = ligarNome(p.nome, colaboradores, apelidos);
      if (!lig) { sem.push(p.nome); continue; }
      await q(`INSERT INTO ponto (unidade_id, competencia, colaborador_id, faltas, abono, extra_0, extra_diurna, atraso)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (unidade_id, competencia, colaborador_id) DO UPDATE SET faltas=EXCLUDED.faltas, abono=EXCLUDED.abono,
                 extra_0=EXCLUDED.extra_0, extra_diurna=EXCLUDED.extra_diurna, atraso=EXCLUDED.atraso`,
        [s.unidade_id, c, lig.id, num(p.faltas), num(p.abono), p.extra_0 || null, p.extra_diurna || null, p.atraso || null]);
      ok.push(p.nome);
    }
    return json({ ok: true, importados: ok.length, sem_ligacao: sem });
  }],

  ['POST', '/api/fechamento/ligar', async ({ req, body }) => {
    // liga um nome do Gcom a um colaborador e cria o apelido
    const s = await area(req);
    const col = await one('SELECT id FROM colaboradores WHERE id=$1 AND unidade_id=$2', [Number(body.colaborador_id), s.unidade_id]);
    if (!col) throw new HttpError(400, 'Colaborador inválido.');
    const ap = nomeBase(body.nome);
    await q(`INSERT INTO apelidos (unidade_id, colaborador_id, apelido) VALUES ($1,$2,$3)
             ON CONFLICT (unidade_id, apelido) DO UPDATE SET colaborador_id=EXCLUDED.colaborador_id`, [s.unidade_id, col.id, ap]);
    const r = await q('UPDATE consumo SET colaborador_id=$3 WHERE unidade_id=$1 AND cliente_gcom=$2 RETURNING id', [s.unidade_id, ap, col.id]);
    return json({ ok: true, ligadas: r.length });
  }],
]);

export const config = { path: '/api/fechamento/*' };
