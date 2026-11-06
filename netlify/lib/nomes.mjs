// Normalização e ligação de nomes (Gcom / sangria / folha) -> colaborador.
export const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/\*/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** "ALYANI DE SOUZA - RICO MATE" -> "ALYANI DE SOUZA" */
export const nomeBase = (s) => norm(String(s || '').split(' - ')[0]);

const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);
const tokens = (s) => norm(s).split(' ').filter((t) => t && !PARTICULAS.has(t));

/**
 * Procura o colaborador para um nome.
 * 1) apelido cadastrado (exato)  2) nome igual  3) mesmo primeiro nome + 2 palavras em comum
 * 4) só o primeiro nome, se for único na equipe.
 * Retorna { id, certeza: 'apelido'|'exato'|'provavel' } ou null.
 */
export function ligarNome(nome, colaboradores, apelidos) {
  const n = nomeBase(nome);
  if (!n) return null;
  const ap = apelidos.find((a) => norm(a.apelido) === n);
  if (ap) return { id: ap.colaborador_id, certeza: 'apelido' };
  const exato = colaboradores.find((c) => norm(c.nome) === n);
  if (exato) return { id: exato.id, certeza: 'exato' };
  const t = tokens(n);
  if (!t.length) return null;
  const cands = colaboradores.filter((c) => {
    const ct = tokens(c.nome);
    if (ct[0] !== t[0]) return false;
    const comuns = t.filter((x) => ct.includes(x)).length;
    return t.length === 1 ? true : comuns >= Math.min(2, t.length);
  });
  if (cands.length === 1) return { id: cands[0].id, certeza: 'provavel' };
  return null;
}

/** Acha um nome de colaborador dentro de um texto livre (observação da sangria). */
export function nomeNoTexto(texto, colaboradores, apelidos) {
  const T = ' ' + norm(texto) + ' ';
  for (const a of apelidos) if (T.includes(' ' + norm(a.apelido) + ' ')) return { id: a.colaborador_id, certeza: 'apelido' };
  // nome + sobrenome primeiro (mais específico), depois só o primeiro nome se único
  for (const c of colaboradores) {
    const t = tokens(c.nome);
    if (t.length >= 2 && T.includes(' ' + t[0] + ' ' + t[1] + ' ')) return { id: c.id, certeza: 'provavel' };
  }
  const porPrimeiro = new Map();
  for (const c of colaboradores) { const f = tokens(c.nome)[0]; if (f) porPrimeiro.set(f, [...(porPrimeiro.get(f) || []), c]); }
  for (const [f, lista] of porPrimeiro) if (lista.length === 1 && T.includes(' ' + f + ' ')) return { id: lista[0].id, certeza: 'provavel' };
  return null;
}

/** Classifica a forma de pagamento do Gcom em grupos. */
export function grupoForma(fp) {
  const f = norm(fp);
  if (!f) return 'OUTROS';
  if (fp.includes(',')) return 'COMBINADO';
  if (f.includes('NAO GERA FINANCEIRO')) return f.includes('FUNCIONARIO') ? 'FUNCIONARIO' : 'NAO_GERA';
  if (f.includes('ALELO')) return 'ALELO';
  if (f.includes('TICKET') || f.includes('VR SMART') || f.includes('SODEXO') || f.includes('PLUXEE')) return 'TICKET/VR';
  if (f.includes('PIX')) return 'PIX';
  if (f === 'DINHEIRO') return 'DINHEIRO';
  if (/ELECTRON|MAESTRO|DEBITO/.test(f)) return 'DEBITO';
  if (/VISA|MASTER|AMEX|ELO|HIPER|DINERS|CREDITO/.test(f)) return 'CREDITO';
  return 'OUTROS';
}
