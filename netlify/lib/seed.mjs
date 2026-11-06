// Dados iniciais de uma unidade nova (modelo Rei do Mate). Tudo pode ser editado depois.
import { q } from './db.mjs';

export const FUNCOES = ['Atendente', 'Barista', 'Caixa', 'Cozinha', 'Auxiliar de cozinha', 'Entregador', 'Gerente', 'Financeiro'];

// conta_dre usa as chaves de DRE_LINHAS (netlify/lib/dre.mjs)
export const FORNECEDORES = [
  ['PLATLOG', 'Insumos da franquia', 'fornecedores'], ['REI DO MATE', 'Produtos da franquia', 'fornecedores'],
  ['FROOTY', 'Açaí e polpas', 'fornecedores'], ['MERCADO', 'Compras de mercado', 'fornecedores'],
  ['COCA COLA', 'Bebidas', 'fornecedores'], ['MARDORI', 'Alimentos', 'fornecedores'],
  ['EMBALAGEM', 'Embalagens', 'fornecedores'], ['MILK', 'Laticínios', 'fornecedores'],
  ['AGUA MIX', 'Água', 'fornecedores'], ['SEARA', 'Frios e congelados', 'fornecedores'],
  ['GCOM', 'Sistema de vendas', 'sistema'], ['ANOTA AI', 'Sistema de delivery', 'sistema'],
  ['MAQUINA DE CAFÉ', 'Aluguel', 'maquina_cafe'], ['CONTADOR', 'Contabilidade', 'contador'],
  ['INTERNET', 'Telefone / internet', 'telefone'],
];

export const TAXAS = [
  ['Alelo Refeição', 'ALELO', 'percentual', 6.5, 30], ['Crédito', 'CREDITO', 'percentual', 3.0, 30],
  ['Débito', 'DEBITO', 'percentual', 1.5, 1], ['PIX', 'PIX', 'percentual', 0.99, 0],
  ['Ticket / VR', 'TICKET/VR', 'percentual', 6.0, 30],
  ['Anota AI · Pix online', 'ANOTA_PIX', 'percentual', 0.99, 1], ['Anota AI · crédito online', 'ANOTA_CREDITO', 'percentual', 3.49, 30],
  ['Plano Anota AI (START Fase III)', null, 'mensal', 309.98, null],
];

export const CHECKLISTS = [
  ['Abertura', 'todo dia · 06:30', [
    { texto: 'Conferir fundo de caixa (abertura no Gcom)', tipo: 'sim' },
    { texto: 'Ligar a máquina de café e fazer a purga', tipo: 'sim' },
    { texto: 'Conferir validade dos produtos expostos', tipo: 'sim', foto: true },
    { texto: 'Higienizar bancadas e liquidificadores', tipo: 'sim' },
    { texto: 'Equipe com uniforme, touca e avental', tipo: 'sim' },
  ]],
  ['Temperaturas', '08h · 11h · 14h · 17h', [
    { texto: 'Geladeira de laticínios (°C)', tipo: 'numero', min: 0, max: 5 },
    { texto: 'Freezer de polpas e açaí (°C)', tipo: 'numero', max: -18 },
    { texto: 'Estufa de salgados (°C)', tipo: 'numero', min: 60 },
  ]],
  ['Fechamento', 'todo dia · 19:00', [
    { texto: 'Fechar o caixa no Gcom e conferir sangrias', tipo: 'sim' },
    { texto: 'Lavar liquidificadores, jarras e bicos de vapor', tipo: 'sim' },
    { texto: 'Guardar e etiquetar sobras com data', tipo: 'sim', foto: true },
    { texto: 'Desligar equipamentos (exceto refrigeração)', tipo: 'sim' },
    { texto: 'Observações do dia', tipo: 'texto' },
  ]],
  ['Recebimento de mercadoria', 'a cada entrega', [
    { texto: 'Fornecedor e nº da nota', tipo: 'texto' },
    { texto: 'Temperatura dos refrigerados (°C)', tipo: 'numero', max: 7 },
    { texto: 'Embalagens íntegras e dentro da validade', tipo: 'sim', foto: true },
  ]],
];

export async function semearUnidade(unidade_id) {
  for (const f of FUNCOES) await q('INSERT INTO funcoes (unidade_id, nome) VALUES ($1,$2) ON CONFLICT DO NOTHING', [unidade_id, f]);
  for (const [n, c, d] of FORNECEDORES) await q('INSERT INTO fornecedores (unidade_id, nome, categoria, conta_dre) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [unidade_id, n, c, d]);
  const tx = await q('SELECT count(*)::int AS n FROM taxas WHERE unidade_id=$1', [unidade_id]);
  if (!tx[0].n) for (const [n, f, t, v, p] of TAXAS) await q('INSERT INTO taxas (unidade_id, nome, forma, tipo, valor, prazo_dias) VALUES ($1,$2,$3,$4,$5,$6)', [unidade_id, n, f, t, v, p]);
  const ck = await q('SELECT count(*)::int AS n FROM checklist_modelos WHERE unidade_id=$1', [unidade_id]);
  if (!ck[0].n) for (const [n, w, itens] of CHECKLISTS) await q('INSERT INTO checklist_modelos (unidade_id, nome, quando, itens) VALUES ($1,$2,$3,$4)', [unidade_id, n, w, JSON.stringify(itens)]);
}
