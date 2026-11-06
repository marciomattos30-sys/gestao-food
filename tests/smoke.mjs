// Teste de ponta a ponta das funções com um Postgres em memória (PGlite).
// Uso: npm test   (opcional: GCOM_XLS=/caminho/ConsultaVendaPorPeriodo.xls)
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { setExecutor } from '../netlify/lib/db.mjs';
import { codigoTotp } from '../netlify/lib/security.mjs';
import { parseGcomVendas } from '../public/js/parsers.js';

process.env.GF_TEST = '1';
process.env.APP_SECRET = 'teste-teste-teste-teste-teste-teste-1234';
process.env.SETUP_KEY = 'chave-de-instalacao-123';

const pg = new PGlite();
setExecutor(async (text, params) => (await pg.query(text, params)).rows);

const mods = {};
for (const m of ['setup', 'auth', 'admin', 'equipe', 'fechamento', 'vendas', 'cardapio', 'financeiro', 'checklist']) {
  mods[m] = (await import(`../netlify/functions/${m}.mjs`)).default;
}
const mem = new Map();
(await import('../netlify/functions/checklist.mjs')).setStore({
  set: async (k, v) => mem.set(k, v), get: async (k) => mem.get(k), delete: async (k) => mem.delete(k),
});

let jar = '';
async function api(metodo, caminho, body, extra = {}) {
  const mod = caminho.split('/')[2] === 'documentos' ? 'checklist' : caminho.split('/')[2];
  const headers = { 'x-gf': '1', cookie: jar, ...(extra.headers || {}) };
  let b;
  if (body instanceof FormData) b = body; else if (body) { b = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  const r = await mods[mod](new Request('http://x' + caminho, { method: metodo, headers, body: b }));
  const sc = r.headers.get('set-cookie');
  if (sc) for (const c of sc.split(/,(?=\s*gf_)/)) { const [kv] = c.trim().split(';'); const [k] = kv.split('='); jar = jar.split('; ').filter((x) => x && !x.startsWith(k + '=')).concat(kv).join('; '); }
  const t = r.headers.get('content-type') || '';
  const d = t.includes('json') ? await r.json() : await r.text();
  return { s: r.status, d };
}
let falhas = 0;
const ok = (cond, msg, extra) => { console.log((cond ? '✓ ' : '✗ ') + msg + (cond ? '' : ' → ' + JSON.stringify(extra).slice(0, 300))); if (!cond) falhas++; };

// ---------- instalação e login ----------
let r = await api('POST', '/api/setup', { empresa: 'Rei do Mate', unidade: 'Bradesco Matriz', nome: 'Márcio', email: 'admin@teste.com', senha: 'senha12345' }, { headers: { 'x-setup-key': 'errada-errada-errada' } });
ok(r.s === 403, 'setup recusa chave errada');
r = await api('POST', '/api/setup', { empresa: 'Rei do Mate', unidade: 'Bradesco Matriz', nome: 'Márcio', email: 'admin@teste.com', senha: 'senha12345' }, { headers: { 'x-setup-key': 'chave-de-instalacao-123' } });
ok(r.s === 200, 'setup instala', r.d);
r = await api('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'errada' });
ok(r.s === 401, 'senha errada recusada');
r = await api('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'senha12345' }, { headers: {} });
ok(r.s === 200 && r.d.etapa === 'ok', 'login ok');
r = await api('GET', '/api/auth/me');
ok(r.s === 200 && r.d.unidade_id && r.d.precisa_configurar_2fa, 'me + exige configurar 2FA', r.d);
r = await api('POST', '/api/auth/2fa/iniciar');
const segredo = r.d.segredo;
r = await api('POST', '/api/auth/2fa/ativar', { codigo: codigoTotp(segredo) });
ok(r.s === 200, '2FA ativado');
r = await api('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'senha12345' });
ok(r.d.etapa === '2fa', 'login pede código');
r = await api('GET', '/api/vendas/painel/2026-10');
ok(r.s === 401, 'sem código não acessa dados');
r = await api('POST', '/api/auth/2fa', { codigo: codigoTotp(segredo), confiar: true });
ok(r.s === 200, 'código aceito');
r = await api('POST', '/api/equipe/funcoes', { nome: 'X' }, { headers: { 'x-gf': '' } });
ok(r.s === 403, 'escrita sem cabeçalho do app recusada (CSRF)');

// ---------- equipe ----------
const nomes = ['Alyani Nascimento de Souza', 'Andressa Cristina Gomes Nogueira da Silva', 'Bruna Araújo de Oliveira', 'Eduardo da Silva Jorge',
  'Henrique de Freitas Andrade', 'Levi Luther Teixeira Cupertino', 'Mariane da Gama de Oliveira', 'Raphael Barbosa dos Santos', 'Shirley Ribeiro Lima', 'THAIS DA CRUZ SANTOS'];
for (const n of nomes) await api('POST', '/api/equipe/colaboradores', { nome: n, funcao: 'Atendente', admissao: '2025-01-10' });
r = await api('GET', '/api/equipe/colaboradores');
ok(r.d.length === 10, '10 colaboradores');
const id = (p) => r.d.find((c) => c.nome.startsWith(p)).id;
const ids = { levi: id('Levi'), raphael: id('Raphael'), thais: id('THAIS') };

// ---------- importação Gcom ----------
const xls = process.env.GCOM_XLS || '/mnt/user-data/uploads/Downloads/ConsultaVendaPorPeriodo (19).xls';
if (fs.existsSync(xls)) {
  const html = new TextDecoder('windows-1252').decode(fs.readFileSync(xls));
  const vendas = parseGcomVendas(html);
  ok(vendas.length === 4567, `parser Gcom leu ${vendas.length} vendas`);
  r = await api('POST', '/api/fechamento/importar-gcom', { vendas });
  ok(r.s === 200 && Math.abs(r.d.total - 130453.57) < 0.02 && r.d.consumo === 120, `importou R$ ${r.d.total?.toFixed(2)} e ${r.d.consumo} consumos`, r.d);
  console.log('   nomes para ligar:', r.d.sem_ligacao.map((x) => x.nome).join(' | '));
  r = await api('POST', '/api/fechamento/ligar', { nome: 'LEVI LUTHER CURPETINO - APARTAMENTO', colaborador_id: ids.levi });
  ok(r.d.ligadas === 11, 'ligou Levi (11 vendas)', r.d);
} else console.log('(sem arquivo do Gcom — pulando importação real)');

// ---------- vales, quebras, caixa ----------
await api('POST', '/api/fechamento/vales', { itens: [{ competencia: '2026-10', data: '2026-10-20', colaborador_id: ids.thais, valor: 600 }, { competencia: '2026-10', data: '2026-10-20', colaborador_id: ids.raphael, valor: 150 }] });
const caixa = [
  'SP\tRBRAM\tBRADESCO MATRIZ\tCAIXANFCE1\t08/10/2026\t156,81 \t SANGRIA\t THAIS QUEBRA ESPREMEDOR DE LIMAO \t\t\t',
  'SP\tRBRAM\tBRADESCO MATRIZ\tCAIXANFCE1\t08/10/2026\t13,50 \t SANGRIA\t QUEBRA COPO 300 ML LEVI \t\t\t',
  'SP\tRBRAM\tBRADESCO MATRIZ\tCAIXANFCE1\t08/10/2026\t50,00 \t SANGRIA\t COMPRAR BANANA \t\t\t',
  'SP\tRBRAM\tBRADESCO MATRIZ\tCAIXANFCE1\t19/10/2026\t32,20 \t SANGRIA\t VT E VR GEOVANA \t\t\t',
  'SP\tRBRAM\tBRADESCO MATRIZ\tCAIXANFCE1\t08/10/2026\t13,50 \t REFORÇO\t COPO 300 ML LEVI \t\t\t',
].join('\n');
r = await api('POST', '/api/fechamento/caixa/analisar', { texto: caixa });
ok(r.d.length === 2 && r.d[0].colaborador_id === ids.thais && r.d[1].colaborador_id === ids.levi, 'caixa: 2 quebras com nome, ignora compra/VT/reforço', r.d);
await api('POST', '/api/fechamento/quebras', { itens: r.d });
r = await api('GET', '/api/fechamento/mes/2026-10');
const th = r.d.linhas.find((l) => l.id === ids.thais);
ok(r.s === 200 && th.quebras === 156.81 && th.vales === 600, 'fechamento do mês (Thais: vale 600, quebra 156,81)', th);
console.log(`   total a descontar: R$ ${r.d.totais.total.toFixed(2)} · sem ligação: ${r.d.sem_ligacao.length}`);
r = await api('POST', '/api/fechamento/importar-ponto', { competencia: '2026-10', linhas: [{ nome: 'THAIS DA CRUZ SANTOS*', faltas: '2', extra_0: '01:10', extra_diurna: '01:10' }, { nome: 'Fulano Inexistente', faltas: '1' }] });
ok(r.d.importados === 1 && r.d.sem_ligacao.length === 1, 'ponto importado com ligação de nome', r.d);

// ---------- delivery e painel ----------
r = await api('POST', '/api/vendas/importar-anota', { pedidos: [
  { numero: '#28366', data: '06/10/2026', cliente: 'Milena', local: 'Amarelo 3º', entrega: 'Retirada', origem: 'link', valor: 'R$ 40,80', status: 'Finalizado' },
  { numero: '#28365', data: '06/10/2026', cliente: 'Aline', local: 'Vermelho 1º', entrega: 'Entrega', origem: 'site', valor: '43,30', status: 'Finalizado' },
  { numero: '#28364', data: '07/10/2026', cliente: 'Aline', entrega: 'Entrega', origem: 'Balcão (PDV)', valor: '37,20', status: 'Cancelado' }] });
ok(r.s === 200 && r.d.cancelados === 1 && Math.abs(r.d.total - 84.1) < 0.01, 'Anota AI importado (sem cancelados)', r.d);
r = await api('GET', '/api/vendas/painel/2026-10');
ok(r.s === 200 && r.d.delivery.cupons === 2 && r.d.loja.cupons > 4000, 'painel: loja + delivery', { loja: r.d.loja, delivery: r.d.delivery });

// ---------- financeiro / DRE ----------
await api('POST', '/api/financeiro/lancamentos', { itens: [
  { competencia: '2026-10', fornecedor: 'PLATLOG', valor: '25119,00' }, { competencia: '2026-10', fornecedor: 'MERCADO', valor: '13851' },
  { competencia: '2026-10', fornecedor: 'CONTADOR', valor: '798', recorrente: true }, { competencia: '2026-10', descricao: 'Folha', valor: '36267.61', conta_dre: 'salarios' }] });
await api('POST', '/api/financeiro/guias', { tipo: 'DAS', competencia: '2026-10', vencimento: '2026-11-20', valor: '7830' });
r = await api('GET', '/api/financeiro/dre/2026-10');
const L = Object.fromEntries(r.d.linhas.map((l) => [l.chave, l]));
ok(r.s === 200 && L.fornecedores.valor === 38970 && L.impostos.valor === 7830 && L.contador.valor === 798, 'DRE automática (fornecedores, DAS, recorrentes)', L.fornecedores);
console.log(`   receita R$ ${r.d.totais.receita} · royalties ${L.royalties.valor} · custo meios pagto ${L.custo_financeiro.valor} · lucro ${r.d.totais.lucro_liquido} (${r.d.pct.lucro_liquido}%)`);
r = await api('POST', '/api/financeiro/recorrentes/2026-11');
ok(r.d.copiados === 1, 'contas recorrentes copiadas para o mês seguinte');
r = await api('POST', '/api/financeiro/dre/2026-10/travar');
r = await api('PUT', '/api/financeiro/dre/2026-10', { linha: 'contador', valor: 1 , travado: true});
ok(r.s === 400, 'linha travada não muda');
r = await api('GET', '/api/financeiro/custo-pagamentos/2026-10');
ok(r.s === 200 && r.d.total > 0, `custo dos meios de pagamento R$ ${r.d.total} (${r.d.taxa_efetiva}%)`);

// ---------- checklist e documentos ----------
r = await api('GET', '/api/checklist/hoje');
const temp = r.d.modelos.find((m) => m.nome === 'Temperaturas');
r = await api('PUT', `/api/checklist/execucao/${temp.id}`, { respostas: { 0: '4', 1: '-14', 2: '65' } });
ok(r.d.concluido && r.d.pendencias_abertas === 1, 'checklist: freezer -14 °C abre pendência', r.d);
const fd = new FormData(); fd.set('pasta', 'Loja'); fd.set('nome', 'Licença sanitária'); fd.set('validade', '2027-03-15');
fd.set('arquivo', new File([new Uint8Array([37, 80, 68, 70])], 'licenca.pdf', { type: 'application/pdf' }));
r = await api('POST', '/api/documentos', fd);
ok(r.s === 200, 'documento enviado', r.d);
r = await api('GET', '/api/documentos');
ok(r.d.documentos[0]?.tem_arquivo, 'documento listado com arquivo');

// ---------- permissões ----------
r = await api('POST', '/api/admin/usuarios', { nome: 'Equipe', email: 'eq@teste.com', papel: 'equipe', unidades: [1] });
const senhaEq = r.d.senha_provisoria;
jar = '';
r = await api('POST', '/api/auth/login', { email: 'eq@teste.com', senha: senhaEq });
ok(r.d.etapa === 'ok', 'equipe entra (sem 2FA obrigatória)');
r = await api('GET', '/api/financeiro/dre/2026-10');
ok(r.s === 403, 'equipe NÃO vê a DRE');
r = await api('GET', '/api/fechamento/mes/2026-10');
ok(r.s === 403, 'equipe NÃO vê o fechamento');
r = await api('GET', '/api/checklist/hoje');
ok(r.s === 200, 'equipe vê o checklist');
for (let i = 0; i < 5; i++) await api('POST', '/api/auth/login', { email: 'eq@teste.com', senha: 'errada123' });
r = await api('POST', '/api/auth/login', { email: 'eq@teste.com', senha: senhaEq });
ok(r.s === 429, 'bloqueio após 5 tentativas');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
