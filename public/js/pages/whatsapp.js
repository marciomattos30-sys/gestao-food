export async function render(el) {
  el.innerHTML = `<h1>WhatsApp (Anota AI)</h1>
  <section class="c"><h3>Atendimento pelo robô do Anota AI</h3>
    <p>O robô do Anota AI atende os clientes no WhatsApp e recebe os pedidos. Quando o cliente pede para falar com uma pessoa, ele aparece em <b>Chamados atendentes</b>.</p>
    <div class="acoes"><a class="btn" href="https://admin.anota.ai/main/bot/call-attendant" target="_blank" rel="noopener">💬 Abrir chamados de atendente</a>
      <a class="btn sec" href="https://admin.anota.ai/main/orders" target="_blank" rel="noopener">Pedidos</a>
      <a class="btn sec" href="https://admin.anota.ai/main/bot/customer-feedback" target="_blank" rel="noopener">Feedback de clientes</a></div>
    <p class="mut peq">Etapa 1 (agora): atalhos para o Anota AI. Etapa 2: ver e responder as conversas aqui, com a ficha do cliente (local, pedidos, ticket médio) e o Chef sugerindo a resposta — depende de o Anota AI liberar o acesso às conversas pela API.</p></section>
  <section class="c"><h3>Dicas de uso</h3><ul><li>Deixe o som de notificação ligado no Anota AI no computador do caixa.</li>
    <li>Use o <a href="#/cardapio">Chef</a> para tirar dúvidas de produto antes de responder.</li><li>Pedidos cancelados não entram nas vendas do painel.</li></ul></section>`;
}
