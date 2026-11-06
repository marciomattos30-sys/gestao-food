// /api/checklist/* e /api/documentos/* — checklist diário, pendências e documentos com validade.
import { getStore } from '@netlify/blobs';
import { q, one, HttpError } from '../lib/db.mjs';
import { json, roteador, num } from '../lib/http.mjs';
import { exigir } from '../lib/auth.mjs';
import { novoToken } from '../lib/security.mjs';

const hojeSP = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const PASTAS = ['Loja', 'Higiene e segurança alimentar', 'Equipe', 'Fiscal', 'Franquia'];
const TIPOS_ARQ = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_ARQ = 8 * 1024 * 1024;
let _store = null;
export const setStore = (s) => { _store = s; };
const store = () => _store || getStore({ name: 'documentos', consistency: 'strong' });

/** Confere a resposta de um item contra o padrão. */
function foraDoPadrao(item, resp) {
  if (resp === undefined || resp === null || resp === '') return false;
  if (item.tipo === 'sim') return resp === false || resp === 'nao';
  if (item.tipo === 'numero') {
    const v = num(resp);
    return (item.min !== undefined && v < item.min) || (item.max !== undefined && v > item.max);
  }
  return false;
}

export default roteador([
  ['GET', '/api/checklist/hoje', async ({ req, url }) => {
    const s = await exigir(req, 'checklist');
    const data = url.searchParams.get('data') || hojeSP();
    const modelos = await q(`SELECT m.id, m.nome, m.quando, m.itens, e.respostas, e.concluido_em, u.nome AS por
      FROM checklist_modelos m LEFT JOIN checklist_execucoes e ON e.modelo_id=m.id AND e.data=$2 LEFT JOIN usuarios u ON u.id=e.usuario_id
      WHERE m.unidade_id=$1 AND m.ativo ORDER BY m.id`, [s.unidade_id, data]);
    const pend = await q(`SELECT id, descricao, origem, criado_em FROM pendencias WHERE unidade_id=$1 AND status='aberta' ORDER BY criado_em DESC`, [s.unidade_id]);
    return json({ data, modelos, pendencias: pend });
  }],
  ['PUT', '/api/checklist/execucao/:modelo', async ({ req, params, body }) => {
    const s = await exigir(req, 'checklist');
    const m = await one('SELECT id, nome, itens FROM checklist_modelos WHERE id=$1 AND unidade_id=$2', [Number(params.modelo), s.unidade_id]);
    if (!m) throw new HttpError(404, 'Checklist não encontrado.');
    const data = body.data || hojeSP();
    const resp = body.respostas && typeof body.respostas === 'object' ? body.respostas : {};
    const ant = await one('SELECT respostas FROM checklist_execucoes WHERE modelo_id=$1 AND data=$2', [m.id, data]);
    const completo = m.itens.every((it, i) => it.tipo === 'texto' || (resp[i] !== undefined && resp[i] !== ''));
    await q(`INSERT INTO checklist_execucoes (unidade_id, modelo_id, data, respostas, usuario_id, concluido_em) VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (modelo_id, data) DO UPDATE SET respostas=EXCLUDED.respostas, usuario_id=EXCLUDED.usuario_id, concluido_em=EXCLUDED.concluido_em`,
      [s.unidade_id, m.id, data, JSON.stringify(resp), s.id, completo ? new Date().toISOString() : null]);
    // abre pendência para item que passou a ficar fora do padrão
    const novas = [];
    m.itens.forEach((it, i) => {
      const antes = ant?.respostas?.[i];
      if (foraDoPadrao(it, resp[i]) && !(antes !== undefined && foraDoPadrao(it, antes) && String(antes) === String(resp[i]))) {
        novas.push(`${m.nome}: ${it.texto} — ${it.tipo === 'numero' ? resp[i] + ' (fora do padrão)' : 'não conforme'}`);
      }
    });
    for (const d of novas) await q('INSERT INTO pendencias (unidade_id, descricao, origem) VALUES ($1,$2,$3)', [s.unidade_id, d, `Checklist ${data}`]);
    return json({ ok: true, concluido: completo, pendencias_abertas: novas.length });
  }],
  ['POST', '/api/checklist/pendencias/:id/resolver', async ({ req, params }) => {
    const s = await exigir(req, 'checklist');
    await q(`UPDATE pendencias SET status='resolvida', resolvido_em=now() WHERE id=$1 AND unidade_id=$2`, [Number(params.id), s.unidade_id]);
    return json({ ok: true });
  }],
  ['GET', '/api/checklist/modelos', async ({ req }) => {
    const s = await exigir(req, 'checklist');
    return json(await q('SELECT * FROM checklist_modelos WHERE unidade_id=$1 ORDER BY id', [s.unidade_id]));
  }],
  ['POST', '/api/checklist/modelos', async ({ req, body }) => {
    const s = await exigir(req, 'financeiro'); // gerente/admin edita modelos
    const itens = (body.itens || []).filter((i) => i && i.texto).map((i) => ({
      texto: String(i.texto).slice(0, 200), tipo: ['sim', 'numero', 'texto'].includes(i.tipo) ? i.tipo : 'sim',
      ...(i.min !== undefined && i.min !== '' ? { min: num(i.min) } : {}), ...(i.max !== undefined && i.max !== '' ? { max: num(i.max) } : {}), foto: !!i.foto,
    }));
    if (!body.nome || !itens.length) throw new HttpError(400, 'Informe o nome e pelo menos um item.');
    if (body.id) await q('UPDATE checklist_modelos SET nome=$3, quando=$4, itens=$5, ativo=$6 WHERE id=$1 AND unidade_id=$2', [Number(body.id), s.unidade_id, body.nome, body.quando || null, JSON.stringify(itens), body.ativo !== false]);
    else await q('INSERT INTO checklist_modelos (unidade_id, nome, quando, itens) VALUES ($1,$2,$3,$4)', [s.unidade_id, body.nome, body.quando || null, JSON.stringify(itens)]);
    return json({ ok: true });
  }],

  // ---------- Documentos ----------
  ['GET', '/api/documentos', async ({ req }) => {
    const s = await exigir(req, 'documentos');
    const docs = await q(`SELECT id, pasta, nome, numero, validade, arquivo_nome, (arquivo_key IS NOT NULL) AS tem_arquivo,
      CASE WHEN validade IS NULL THEN NULL ELSE (validade - current_date) END AS dias FROM documentos WHERE unidade_id=$1 ORDER BY pasta, validade NULLS LAST, nome`, [s.unidade_id]);
    return json({ pastas: PASTAS, documentos: docs });
  }],
  ['POST', '/api/documentos', async ({ req }) => {
    const s = await exigir(req, 'documentos');
    const fd = await req.formData();
    const pasta = String(fd.get('pasta') || ''), nome = String(fd.get('nome') || '').trim();
    if (!PASTAS.includes(pasta) || !nome) throw new HttpError(400, 'Informe pasta e nome do documento.');
    const arq = fd.get('arquivo');
    let key = null, an = null, at = null;
    if (arq && typeof arq === 'object' && arq.size) {
      if (arq.size > MAX_ARQ) throw new HttpError(400, 'Arquivo maior que 8 MB.');
      if (!TIPOS_ARQ.includes(arq.type)) throw new HttpError(400, 'Envie PDF ou foto (JPG, PNG, WEBP).');
      key = `u${s.unidade_id}/${novoToken()}`;
      await store().set(key, await arq.arrayBuffer(), { metadata: { tipo: arq.type, nome: arq.name } });
      an = String(arq.name).slice(0, 120); at = arq.type;
    }
    const val = String(fd.get('validade') || '');
    await q('INSERT INTO documentos (unidade_id, pasta, nome, numero, validade, arquivo_key, arquivo_nome, arquivo_tipo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [s.unidade_id, pasta, nome, String(fd.get('numero') || '') || null, /^\d{4}-\d{2}-\d{2}$/.test(val) ? val : null, key, an, at]);
    return json({ ok: true });
  }],
  ['GET', '/api/documentos/:id/arquivo', async ({ req, params }) => {
    const s = await exigir(req, 'documentos');
    const d = await one('SELECT arquivo_key, arquivo_nome, arquivo_tipo FROM documentos WHERE id=$1 AND unidade_id=$2', [Number(params.id), s.unidade_id]);
    if (!d?.arquivo_key) throw new HttpError(404, 'Arquivo não encontrado.');
    const data = await store().get(d.arquivo_key, { type: 'arrayBuffer' });
    if (!data) throw new HttpError(404, 'Arquivo não encontrado.');
    return new Response(data, { headers: { 'content-type': d.arquivo_tipo || 'application/octet-stream',
      'content-disposition': `inline; filename="${encodeURIComponent(d.arquivo_nome || 'documento')}"`, 'cache-control': 'private, no-store' } });
  }],
  ['DELETE', '/api/documentos/:id', async ({ req, params }) => {
    const s = await exigir(req, 'financeiro');
    const d = await one('SELECT arquivo_key FROM documentos WHERE id=$1 AND unidade_id=$2', [Number(params.id), s.unidade_id]);
    if (d?.arquivo_key) await store().delete(d.arquivo_key);
    await q('DELETE FROM documentos WHERE id=$1 AND unidade_id=$2', [Number(params.id), s.unidade_id]);
    return json({ ok: true });
  }],
]);

export const config = { path: ['/api/checklist/*', '/api/documentos', '/api/documentos/*'] };
