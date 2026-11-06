# Gestão Food

Sistema de gestão para cafeterias e restaurantes. Primeiro cliente: **Rei do Mate · Bradesco Matriz**.

Funciona como app (PWA): instala no celular e no computador pelo navegador.

## O que tem na versão 0.1
| Área | O que faz |
|---|---|
| **Acesso** | Login, verificação em 2 etapas (obrigatória para Administrador/Gerente), bloqueio após 5 tentativas, escolha de unidade, histórico de acessos |
| **Visão geral** | Vendas loja (Gcom) + delivery (Anota AI), ticket médio, vendas por dia e por forma de pagamento, locais de entrega, clientes, entregadores, lucro da DRE |
| **Importar dados** | Gcom (Consulta Venda por Período), Anota AI (Relatório de pedidos), ponto RHiD/ControlID (arquivo ou colado), quebras (movimentação de caixa colada), histórico de fornecedores (planilha DRE LOJAS) |
| **Fechamento da equipe** | Consumo + vales + quebras + ponto por funcionário, ligação de nomes do Gcom (lembra nos meses seguintes), planilha para o DP |
| **Financeiro** | DRE automática no modelo da franquia (com fonte de cada linha, ajuste e trava), compras e CMV, contas e fornecedores, máquinas e taxas, guias de impostos |
| **Equipe** | Cadastro único de colaboradores, funções, nomes alternativos, ficha de admissão |
| **Cardápio e Chef** | Cardápio importado do app da franquia (Gcom), fichas técnicas, Chef (IA) por texto e voz |
| **Checklist e documentos** | Checklists do dia com pendências automáticas, modelos editáveis, documentos com validade |
| **WhatsApp** | Atalhos para o atendimento do Anota AI (etapa 1) |

## Como publicar (passo a passo)

### 1. GitHub
1. Crie um repositório **privado** chamado `gestao-food`.
2. No PowerShell, dentro desta pasta:
   ```powershell
   git init
   git add .
   git commit -m "Gestão Food 0.1"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/gestao-food.git
   git push -u origin main
   ```

### 2. Netlify
1. **Add new site → Import an existing project** → escolha o repositório `gestao-food`.
2. Não precisa mudar nada no build (o `netlify.toml` já configura).
3. Em **Data & storage › Database**, crie o banco (Netlify Database). A conexão é automática.
4. Em **Site configuration → Environment variables**, crie:

| Variável | Valor |
|---|---|
| `APP_SECRET` | um texto aleatório com 40+ caracteres (guarde com cuidado; protege os segredos da verificação em 2 etapas) |
| `SETUP_KEY` | uma senha de instalação com 12+ caracteres (usada só no primeiro acesso) |
| `ANTHROPIC_API_KEY` | chave da Anthropic para o Chef (opcional; sem ela o Chef fica desligado) |
| `CHEF_MODEL` | opcional, padrão `claude-haiku-4-5` |

5. Faça um novo deploy (**Deploys → Trigger deploy**).

### 3. Primeiro acesso
1. Abra o endereço do site. Aparece a tela **Instalação**.
2. Digite a `SETUP_KEY`, os dados da empresa e o seu usuário.
3. Entre, ative a verificação em 2 etapas e comece por **Equipe** (cadastre os funcionários) e **Importar dados**.

## Para o desenvolvedor
- **Front-end:** `public/`, em HTML, CSS e JavaScript em módulos, sem etapa de build.
  - O código das telas fica em `public/js/pages/`.
  - A leitura de arquivos (Gcom, Anota AI, ponto) fica em `public/js/parsers.js`.
- **API:** `netlify/functions/*.mjs`, Functions v2, uma por área.
  - Bibliotecas comuns em `netlify/lib/`.
  - A DRE é montada em `netlify/lib/dre.mjs`.
- **Banco:** Postgres (Neon), com o esquema em `db/schema.sql`.
  - O esquema é idempotente e é aplicado pelo `POST /api/setup`.
  - Para atualizar as tabelas depois de mudar o esquema, chame o setup de novo com a `SETUP_KEY`.
- **Arquivos (documentos):** Netlify Blobs, na loja `documentos`.
- **Segurança:**
  - As senhas usam scrypt e o segredo da verificação em 2 etapas é criptografado com AES-256-GCM.
  - A sessão usa cookie HttpOnly.
  - Toda escrita exige o cabeçalho `x-gf: 1` (proteção contra CSRF).
  - As permissões são conferidas no servidor (`netlify/lib/auth.mjs`).
- **Testes:**
  - `npm install` e depois `npm test`. Usa um Postgres em memória (PGlite) e cobre login, 2 etapas, importação real do Gcom, fechamento, DRE, checklist e permissões.
  - Telas locais: `node tests/dev-server.mjs` → http://localhost:8888 (chave de instalação: `chave-local-123`).

## Próximos passos
- Fichas técnicas da franquia (Extranet) → CMV teórico.
- Notas fiscais de compra (XML) por item.
- Conexão por API com Gcom, Anota AI e RHiD, quando os fornecedores liberarem.
- Conciliação com extrato do banco (OFX) e das adquirentes.
- Conversas do WhatsApp dentro do app.
