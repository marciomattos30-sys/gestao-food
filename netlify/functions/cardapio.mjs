// /api/cardapio/* — cardápio (importado do app Gcom da franquia), fichas técnicas e o Chef (IA).
import { q, one, HttpError } from '../lib/db.mjs';
import { json, roteador, num } from '../lib/http.mjs';
import { exigir } from '../lib/auth.mjs';
import { norm } from '../lib/nomes.mjs';

const API_GCOM = 'https://gcom-pwa-cardapio-api-br.azurewebsites.net/api/CardapioPadrao/Lojas';

function mapearGcom(dados) {
  const out = [];
  for (const card of dados || []) for (const g of card.GRUPOS || []) for (const s of g.SUBGRUPOS || []) for (const it of s.ITENS || []) {
    const foto = it.URL_IMG_PROD && /^https:\/\//.test(it.URL_IMG_PROD) ? it.URL_IMG_PROD : null;
    out.push({
      ext_id: String(it.CD_EXT || `${it.ID_GRU}-${it.ID_SUB_GRU}-${it.ID_SEQ_PRO_GRU}`),
      categoria: s.NM_SUB_GRU, nome: it.NM_PRO_CARDAPIO, descricao: (it.DESC_PROD || '').trim() || null, foto,
      opcoes: (it.CUSTOM || []).map((c) => ({ grupo: c.NM_CUSTOM, min: c.QT_MIN_PER, max: c.QT_MAX_PER, itens: (c.OPC_CUSTOM || []).map((o) => o.NM_OPC) })),
      preco: it.PR_UN || null,
    });
  }
  return out;
}

export default roteador([
  ['GET', '/api/cardapio/produtos', async ({ req }) => {
    const s = await exigir(req, 'cardapio');
    return json(await q('SELECT id, categoria, nome, descricao, foto, opcoes, ficha, preco::float, ativo FROM produtos WHERE unidade_id=$1 ORDER BY categoria, nome', [s.unidade_id]));
  }],

  ['POST', '/api/cardapio/importar-gcom', async ({ req }) => {
    const s = await exigir(req, 'financeiro'); // gerente/admin
    const un = await one('SELECT gcom_marca FROM unidades WHERE id=$1', [s.unidade_id]);
    const marca = String(un?.gcom_marca || '').replace(/\D/g, '');
    if (!marca) throw new HttpError(400, 'Informe o código da marca no Gcom em Configurações > Unidade.');
    const r = await fetch(`${API_GCOM}/${marca}/CardapioPadrao`, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new HttpError(502, 'O cardápio do Gcom não respondeu. Tente mais tarde.');
    const produtos = mapearGcom((await r.json()).data);
    if (!produtos.length) throw new HttpError(502, 'O cardápio do Gcom veio vazio.');
    await q(`INSERT INTO produtos (unidade_id, ext_id, categoria, nome, descricao, foto, opcoes, preco)
      SELECT $1, x.ext_id, x.categoria, x.nome, x.descricao, x.foto, x.opcoes, x.preco
        FROM json_to_recordset($2::json) AS x(ext_id text, categoria text, nome text, descricao text, foto text, opcoes jsonb, preco numeric)
      ON CONFLICT (unidade_id, ext_id) DO UPDATE SET categoria=EXCLUDED.categoria, nome=EXCLUDED.nome, descricao=EXCLUDED.descricao,
        foto=EXCLUDED.foto, opcoes=EXCLUDED.opcoes, preco=COALESCE(produtos.preco, EXCLUDED.preco)`, [s.unidade_id, JSON.stringify(produtos)]);
    return json({ ok: true, produtos: produtos.length, categorias: new Set(produtos.map((p) => p.categoria)).size });
  }],

  ['PUT', '/api/cardapio/produtos/:id', async ({ req, params, body }) => {
    const s = await exigir(req, 'financeiro');
    const r = await q(`UPDATE produtos SET preco=$3, ficha=COALESCE($4::jsonb, ficha), ativo=COALESCE($5, ativo), descricao=COALESCE($6, descricao)
      WHERE id=$1 AND unidade_id=$2 RETURNING id`,
      [Number(params.id), s.unidade_id, body.preco === '' || body.preco == null ? null : num(body.preco),
        body.ficha ? JSON.stringify(body.ficha) : null, body.ativo ?? null, body.descricao ?? null]);
    if (!r.length) throw new HttpError(404, 'Produto não encontrado.');
    return json({ ok: true });
  }],

  /** Chef: responde dúvidas sobre os produtos usando o cardápio e as fichas cadastradas. */
  ['POST', '/api/cardapio/chef', async ({ req, body }) => {
    const s = await exigir(req, 'chef');
    const pergunta = String(body.pergunta || '').slice(0, 600).trim();
    if (!pergunta) throw new HttpError(400, 'Faça uma pergunta.');
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new HttpError(503, 'O Chef ainda não foi ligado (falta a chave de IA na Netlify).');
    const prods = await q('SELECT id, categoria, nome, descricao, foto, opcoes, ficha FROM produtos WHERE unidade_id=$1 AND ativo', [s.unidade_id]);
    const contexto = prods.map((p) => {
      const op = (p.opcoes || []).map((o) => `${o.grupo}: ${o.itens.join(', ')}`).join(' | ');
      const f = p.ficha && Object.keys(p.ficha).length ? ` | FICHA: ${JSON.stringify(p.ficha)}` : '';
      return `- [${p.categoria}] ${p.nome}${p.descricao ? ': ' + p.descricao.replace(/\s+/g, ' ') : ''}${op ? ' | ' + op : ''}${f}`;
    }).join('\n');
    const historico = (Array.isArray(body.historico) ? body.historico : []).slice(-6)
      .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
    const sistema = `Você é o Chef, assistente da equipe de uma cafeteria (franquia Rei do Mate). Responda em português do Brasil,
curto e prático, como um colega experiente no balcão. Use SOMENTE as informações do cardápio e das fichas abaixo.
Se a pergunta pedir quantidade, gramatura ou modo de preparo e isso não estiver na ficha, diga que a ficha técnica ainda não foi
cadastrada e oriente a consultar o manual da franquia — nunca invente medidas. Ao listar passos, numere-os.
CARDÁPIO:
${contexto || '(cardápio ainda não importado)'}`;
    const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
    const r = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.CHEF_MODEL || 'claude-haiku-4-5', max_tokens: 700, system: sistema,
        messages: [...historico, { role: 'user', content: pergunta }] }),
    });
    if (!r.ok) { console.error('chef', r.status, await r.text()); throw new HttpError(502, 'O Chef não conseguiu responder agora. Tente de novo.'); }
    const d = await r.json();
    const resposta = (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    const T = norm(pergunta + ' ' + resposta);
    const citados = prods.filter((p) => norm(p.nome).length > 3 && T.includes(norm(p.nome)))
      .sort((a, b) => b.nome.length - a.nome.length).slice(0, 3).map((p) => ({ id: p.id, nome: p.nome, foto: p.foto, descricao: p.descricao }));
    return json({ resposta, produtos: citados });
  }],
]);

export const config = { path: '/api/cardapio/*' };
