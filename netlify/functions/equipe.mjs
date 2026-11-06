// /api/equipe/* — colaboradores (cadastro único), funções e apelidos.
import { q, one, HttpError } from '../lib/db.mjs';
import { json, roteador } from '../lib/http.mjs';
import { exigir } from '../lib/auth.mjs';
import { norm } from '../lib/nomes.mjs';

const area = (req) => exigir(req, 'equipe');
const dataOuNull = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

export default roteador([
  ['GET', '/api/equipe/colaboradores', async ({ req, url }) => {
    const s = await area(req);
    const todos = url.searchParams.get('todos') === '1';
    const rows = await q(`SELECT c.id, c.nome, c.funcao, c.entrada, c.saida, c.admissao, c.demissao,
        (c.demissao IS NULL OR c.demissao > current_date) AS ativo,
        COALESCE((SELECT json_agg(json_build_object('id',a.id,'apelido',a.apelido)) FROM apelidos a WHERE a.colaborador_id=c.id),'[]') AS apelidos
      FROM colaboradores c WHERE c.unidade_id=$1 ${todos ? '' : 'AND (c.demissao IS NULL OR c.demissao > current_date)'}
      ORDER BY c.nome`, [s.unidade_id]);
    return json(rows);
  }],
  ['GET', '/api/equipe/colaboradores/:id', async ({ req, params }) => {
    const s = await area(req);
    const c = await one('SELECT * FROM colaboradores WHERE id=$1 AND unidade_id=$2', [Number(params.id), s.unidade_id]);
    if (!c) throw new HttpError(404, 'Colaborador não encontrado.');
    return json(c);
  }],
  ['POST', '/api/equipe/colaboradores', async ({ req, body }) => {
    const s = await area(req);
    if (!String(body.nome || '').trim()) throw new HttpError(400, 'Informe o nome.');
    const c = await one(`INSERT INTO colaboradores (unidade_id, nome, funcao, entrada, saida, admissao, demissao, ficha)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [s.unidade_id, body.nome.trim(), body.funcao || null, body.entrada || null, body.saida || null,
        dataOuNull(body.admissao), dataOuNull(body.demissao), JSON.stringify(body.ficha || {})]);
    return json({ ok: true, id: c.id });
  }],
  ['PUT', '/api/equipe/colaboradores/:id', async ({ req, params, body }) => {
    const s = await area(req);
    const r = await q(`UPDATE colaboradores SET nome=COALESCE($3,nome), funcao=$4, entrada=$5, saida=$6, admissao=$7, demissao=$8,
        ficha=COALESCE($9::jsonb, ficha) WHERE id=$1 AND unidade_id=$2 RETURNING id`,
      [Number(params.id), s.unidade_id, body.nome || null, body.funcao || null, body.entrada || null, body.saida || null,
        dataOuNull(body.admissao), dataOuNull(body.demissao), body.ficha ? JSON.stringify(body.ficha) : null]);
    if (!r.length) throw new HttpError(404, 'Colaborador não encontrado.');
    return json({ ok: true });
  }],
  ['DELETE', '/api/equipe/colaboradores/:id', async ({ req, params }) => {
    const s = await area(req);
    // Não apaga histórico: só permite excluir quem não tem lançamentos.
    const usado = await one(`SELECT (SELECT count(*) FROM consumo WHERE colaborador_id=$1)+(SELECT count(*) FROM vales WHERE colaborador_id=$1)
      +(SELECT count(*) FROM quebras WHERE colaborador_id=$1) AS n`, [Number(params.id)]);
    if (Number(usado.n) > 0) throw new HttpError(400, 'Este colaborador tem lançamentos. Informe a data de demissão em vez de excluir.');
    await q('DELETE FROM colaboradores WHERE id=$1 AND unidade_id=$2', [Number(params.id), s.unidade_id]);
    return json({ ok: true });
  }],

  ['POST', '/api/equipe/apelidos', async ({ req, body }) => {
    const s = await area(req);
    const c = await one('SELECT id FROM colaboradores WHERE id=$1 AND unidade_id=$2', [Number(body.colaborador_id), s.unidade_id]);
    if (!c) throw new HttpError(404, 'Colaborador não encontrado.');
    const ap = norm(String(body.apelido || '').split(' - ')[0]);
    if (!ap) throw new HttpError(400, 'Informe o nome alternativo.');
    await q(`INSERT INTO apelidos (unidade_id, colaborador_id, apelido) VALUES ($1,$2,$3)
             ON CONFLICT (unidade_id, apelido) DO UPDATE SET colaborador_id=EXCLUDED.colaborador_id`, [s.unidade_id, c.id, ap]);
    // religa o consumo já importado com esse nome
    await q(`UPDATE consumo SET colaborador_id=$3 WHERE unidade_id=$1 AND colaborador_id IS NULL
             AND cliente_gcom = $2`, [s.unidade_id, ap, c.id]);
    return json({ ok: true });
  }],
  ['DELETE', '/api/equipe/apelidos/:id', async ({ req, params }) => {
    const s = await area(req);
    await q('DELETE FROM apelidos WHERE id=$1 AND unidade_id=$2', [Number(params.id), s.unidade_id]);
    return json({ ok: true });
  }],

  ['GET', '/api/equipe/funcoes', async ({ req }) => {
    const s = await area(req);
    return json(await q('SELECT id, nome FROM funcoes WHERE unidade_id=$1 ORDER BY nome', [s.unidade_id]));
  }],
  ['POST', '/api/equipe/funcoes', async ({ req, body }) => {
    const s = await area(req);
    if (!String(body.nome || '').trim()) throw new HttpError(400, 'Informe a função.');
    await q('INSERT INTO funcoes (unidade_id, nome) VALUES ($1,$2) ON CONFLICT DO NOTHING', [s.unidade_id, body.nome.trim()]);
    return json({ ok: true });
  }],
  ['DELETE', '/api/equipe/funcoes/:id', async ({ req, params }) => {
    const s = await area(req);
    await q('DELETE FROM funcoes WHERE id=$1 AND unidade_id=$2', [Number(params.id), s.unidade_id]);
    return json({ ok: true });
  }],
]);

export const config = { path: '/api/equipe/*' };
