import { api, esc, aviso, tentar, janela, dataBR, $, $$ } from '../ui.js';

const FICHA = [
  ['Dados pessoais', [['nascimento', 'Data de nascimento', 'date'], ['celular', 'Celular', 'tel'], ['email', 'E-mail', 'email'], ['cpf', 'CPF'], ['rg', 'RG'], ['pis', 'PIS'],
    ['endereco', 'Endereço (rua, nº, bairro, cidade)'], ['cep', 'CEP'], ['estado_civil', 'Estado civil'], ['escolaridade', 'Grau de instrução']]],
  ['Contrato', [['vinculo', 'Vínculo (CLT, experiência, intermitente…)'], ['salario', 'Salário (R$)'], ['jornada', 'Jornada (ex.: 8h/dia · 44h/sem)'], ['folga', 'Folga fixa (dia da semana)'],
    ['experiencia', 'Prazo de experiência'], ['vt', 'Vale-transporte (R$/dia)']]],
  ['Saúde e segurança alimentar', [['aso_validade', 'ASO — validade', 'date'], ['manipulador_validade', 'Carteira de manipulador / Boas Práticas — validade', 'date'], ['uniforme', 'Tamanho do uniforme']]],
  ['Pagamento', [['banco', 'Banco'], ['agencia', 'Agência'], ['conta', 'Conta']]],
];

export async function render(el, ctx) {
  const todos = location.hash.includes('todos=1');
  const [lista, funcoes] = await Promise.all([api('GET', `/api/equipe/colaboradores${todos ? '?todos=1' : ''}`), api('GET', '/api/equipe/funcoes')]);
  el.innerHTML = `<h1>Equipe</h1>
  <div class="acoes"><button class="btn" id="novo">+ Colaborador</button><button class="btn sec" id="fun">Funções</button>
    <a class="btn sec" href="#/equipe${todos ? '' : '?todos=1'}">${todos ? 'Só ativos' : 'Mostrar desligados'}</a></div>
  <section class="c"><div class="rolagem"><table class="tab"><tr><th>Nome</th><th>Função</th><th>Horário</th><th>Admissão</th><th>Situação</th><th>Nomes alternativos (Gcom / caixa)</th><th></th></tr>
  ${lista.map((c) => `<tr><td><b>${esc(c.nome)}</b></td><td>${esc(c.funcao || '')}</td><td>${esc([c.entrada, c.saida].filter(Boolean).join('–'))}</td><td>${dataBR(c.admissao)}</td>
    <td>${c.ativo ? '<span class="st ok">Ativo</span>' : `<span class="st er">Desligado ${dataBR(c.demissao)}</span>`}</td>
    <td>${c.apelidos.map((a) => `<span class="chip-n">${esc(a.apelido)} <button data-xa="${a.id}" aria-label="remover">×</button></span>`).join(' ')}</td>
    <td><button class="link" data-ed="${c.id}">editar</button></td></tr>`).join('') || '<tr><td colspan="7" class="mut">Nenhum colaborador. Cadastre a equipe para fechar o mês.</td></tr>'}</table></div></section>
  <p class="mut peq">Para desligar alguém, informe a data de demissão: o histórico continua nos meses anteriores.</p>`;

  const recarregar = () => render(el, ctx);
  $('#novo', el).onclick = () => editar(null);
  $$('[data-ed]', el).forEach((b) => (b.onclick = () => tentar(async () => editar(await api('GET', `/api/equipe/colaboradores/${b.dataset.ed}`)))));
  $$('[data-xa]', el).forEach((b) => (b.onclick = () => tentar(async () => { await api('DELETE', `/api/equipe/apelidos/${b.dataset.xa}`); recarregar(); })));
  $('#fun', el).onclick = () => {
    const c = janela('Funções', `<div>${funcoes.map((f) => `<span class="chip-n">${esc(f.nome)} <button data-xf="${f.id}">×</button></span>`).join(' ')}</div>
      <div class="linha-form"><input id="nf" placeholder="Nova função"><button class="btn" id="af">Adicionar</button></div>`);
    c.querySelector('#af').onclick = (e) => tentar(async () => { await api('POST', '/api/equipe/funcoes', { nome: c.querySelector('#nf').value }); c.fechar(); recarregar(); }, e.target);
    $$('[data-xf]', c).forEach((b) => (b.onclick = () => tentar(async () => { await api('DELETE', `/api/equipe/funcoes/${b.dataset.xf}`); c.fechar(); recarregar(); })));
  };

  function editar(col) {
    const f = col?.ficha || {};
    const c = janela(col ? col.nome : 'Novo colaborador', `<form id="fc">
      <label>Nome completo<input name="nome" value="${esc(col?.nome || '')}" required></label>
      <div class="g3"><label>Função<select name="funcao"><option value=""></option>${funcoes.map((x) => `<option ${x.nome === col?.funcao ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>
      <label>Entrada<input type="time" name="entrada" value="${esc(col?.entrada || '')}"></label><label>Saída<input type="time" name="saida" value="${esc(col?.saida || '')}"></label>
      <label>Admissão<input type="date" name="admissao" value="${col?.admissao ? String(col.admissao).slice(0, 10) : ''}"></label>
      <label>Demissão<input type="date" name="demissao" value="${col?.demissao ? String(col.demissao).slice(0, 10) : ''}"></label></div>
      ${col ? `<label>Adicionar nome alternativo (como aparece no Gcom ou na sangria)<input name="apelido" placeholder="Ex.: LEVI LUTHER CURPETINO"></label>` : ''}
      <details><summary>Ficha de admissão (acesso restrito)</summary>${FICHA.map(([sec, campos]) => `<h4>${sec}</h4><div class="g3">${campos.map(([k, rot, tipo]) => `<label>${rot}<input name="f_${k}" type="${tipo || 'text'}" value="${esc(f[k] || '')}"></label>`).join('')}</div>`).join('')}</details>
      <div class="acoes"><button class="btn">Salvar</button>${col ? '<button type="button" class="btn sec perigo" id="del">Excluir</button>' : ''}</div></form>`, { largura: 760 });
    c.querySelector('#fc').onsubmit = (e) => { e.preventDefault(); tentar(async () => {
      const fd = Object.fromEntries(new FormData(e.target));
      const ficha = Object.fromEntries(Object.entries(fd).filter(([k, v]) => k.startsWith('f_') && v).map(([k, v]) => [k.slice(2), v]));
      const dados = { nome: fd.nome, funcao: fd.funcao, entrada: fd.entrada, saida: fd.saida, admissao: fd.admissao, demissao: fd.demissao, ficha };
      if (col) {
        await api('PUT', `/api/equipe/colaboradores/${col.id}`, dados);
        if (fd.apelido) await api('POST', '/api/equipe/apelidos', { colaborador_id: col.id, apelido: fd.apelido });
      } else await api('POST', '/api/equipe/colaboradores', dados);
      c.fechar(); aviso('Salvo.'); recarregar();
    }, e.submitter); };
    const del = c.querySelector('#del');
    if (del) del.onclick = () => tentar(async () => { if (!confirm('Excluir este colaborador?')) return; await api('DELETE', `/api/equipe/colaboradores/${col.id}`); c.fechar(); recarregar(); }, del);
  }
}
