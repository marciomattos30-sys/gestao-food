-- Gestão Food · esquema do banco (Postgres / Neon)
-- Idempotente: pode rodar várias vezes (POST /api/setup).

CREATE TABLE IF NOT EXISTS empresas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  cnpj TEXT,
  ie TEXT,
  endereco TEXT,
  criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS unidades (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES empresas(id),
  nome TEXT NOT NULL,
  gcom_marca TEXT,            -- id da marca no cardápio Gcom (Rei do Mate = 88)
  gcom_loja TEXT,             -- id_etb_gcom da loja (Bradesco = 3787)
  meta_cmv NUMERIC DEFAULT 33,
  criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  empresa_id INT NOT NULL REFERENCES empresas(id),
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'equipe' CHECK (papel IN ('admin','gerente','equipe')),
  totp_secret TEXT,           -- criptografado (AES-256-GCM)
  totp_ativo BOOLEAN DEFAULT false,
  trocar_senha BOOLEAN DEFAULT false,
  ativo BOOLEAN DEFAULT true,
  tentativas INT DEFAULT 0,
  bloqueado_ate TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usuario_unidades (
  usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
  unidade_id INT REFERENCES unidades(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, unidade_id)
);

CREATE TABLE IF NOT EXISTS sessoes (
  token_hash TEXT PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  unidade_id INT REFERENCES unidades(id),
  etapa TEXT NOT NULL DEFAULT 'ok' CHECK (etapa IN ('2fa','ok')),
  expira_em TIMESTAMPTZ NOT NULL,
  ip TEXT, ua TEXT,
  criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aparelhos_confiaveis (
  token_hash TEXT PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS acessos_log (
  id SERIAL PRIMARY KEY,
  usuario_id INT,
  email TEXT,
  evento TEXT NOT NULL,
  detalhe TEXT,
  ip TEXT, ua TEXT,
  em TIMESTAMPTZ DEFAULT now()
);

-- ---------- Equipe ----------
CREATE TABLE IF NOT EXISTS funcoes (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES unidades(id),
  nome TEXT NOT NULL,
  UNIQUE (unidade_id, nome)
);

CREATE TABLE IF NOT EXISTS colaboradores (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES unidades(id),
  nome TEXT NOT NULL,
  funcao TEXT,
  entrada TEXT, saida TEXT,
  admissao DATE,
  demissao DATE,
  ficha JSONB DEFAULT '{}'::jsonb,   -- cadastro de admissão (dados pessoais: acesso restrito)
  criado_em TIMESTAMPTZ DEFAULT now()
);

-- nomes alternativos (cliente no Gcom, primeiro nome na sangria etc.) -> colaborador
CREATE TABLE IF NOT EXISTS apelidos (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES unidades(id),
  colaborador_id INT NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  apelido TEXT NOT NULL,
  UNIQUE (unidade_id, apelido)
);

-- ---------- Fechamento mensal ----------
CREATE TABLE IF NOT EXISTS consumo (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES unidades(id),
  competencia TEXT NOT NULL,          -- AAAA-MM
  data TIMESTAMPTZ,
  n_web TEXT,
  cliente_gcom TEXT,
  colaborador_id INT REFERENCES colaboradores(id) ON DELETE SET NULL,
  bruto NUMERIC DEFAULT 0, desconto NUMERIC DEFAULT 0, total NUMERIC DEFAULT 0,
  atendente TEXT,
  UNIQUE (unidade_id, n_web)
);

CREATE TABLE IF NOT EXISTS vales (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES unidades(id),
  competencia TEXT NOT NULL,
  data DATE,
  colaborador_id INT REFERENCES colaboradores(id) ON DELETE CASCADE,
  valor NUMERIC NOT NULL,
  obs TEXT
);

CREATE TABLE IF NOT EXISTS quebras (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES unidades(id),
  competencia TEXT NOT NULL,
  data DATE,
  colaborador_id INT REFERENCES colaboradores(id) ON DELETE SET NULL,
  valor NUMERIC NOT NULL,
  descricao TEXT
);

CREATE TABLE IF NOT EXISTS ponto (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES unidades(id),
  competencia TEXT NOT NULL,
  colaborador_id INT NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  faltas NUMERIC DEFAULT 0, abono NUMERIC DEFAULT 0,
  extra_0 TEXT, extra_diurna TEXT, atraso TEXT,
  UNIQUE (unidade_id, competencia, colaborador_id)
);

-- ---------- Vendas ----------
CREATE TABLE IF NOT EXISTS vendas_dia (
  unidade_id INT NOT NULL REFERENCES unidades(id),
  data DATE NOT NULL,
  canal TEXT NOT NULL CHECK (canal IN ('loja','delivery')),
  valor NUMERIC DEFAULT 0,
  cupons INT DEFAULT 0,
  PRIMARY KEY (unidade_id, data, canal)
);

CREATE TABLE IF NOT EXISTS vendas_forma (
  unidade_id INT NOT NULL REFERENCES unidades(id),
  competencia TEXT NOT NULL,
  forma TEXT NOT NULL,
  valor NUMERIC DEFAULT 0,
  qtd INT DEFAULT 0,
  PRIMARY KEY (unidade_id, competencia, forma)
);

CREATE TABLE IF NOT EXISTS pedidos_delivery (
  unidade_id INT NOT NULL REFERENCES unidades(id),
  numero TEXT NOT NULL,
  data DATE,
  cliente TEXT,
  local TEXT,
  entrega TEXT,
  origem TEXT,
  valor NUMERIC DEFAULT 0,
  status TEXT,
  entregador TEXT,
  PRIMARY KEY (unidade_id, numero)
);

-- ---------- Cardápio ----------
CREATE TABLE IF NOT EXISTS produtos (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES unidades(id),
  ext_id TEXT,
  categoria TEXT,
  nome TEXT NOT NULL,
  descricao TEXT,
  foto TEXT,
  opcoes JSONB DEFAULT '[]'::jsonb,
  ficha JSONB DEFAULT '{}'::jsonb,    -- receita: ingredientes, passo a passo, ponto de atenção, custo
  preco NUMERIC,
  ativo BOOLEAN DEFAULT true,
  UNIQUE (unidade_id, ext_id)
);

-- ---------- Financeiro ----------
CREATE TABLE IF NOT EXISTS fornecedores (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES unidades(id),
  nome TEXT NOT NULL,
  categoria TEXT,
  conta_dre TEXT NOT NULL DEFAULT 'outros',
  cnpj TEXT,
  prazo_dias INT,
  UNIQUE (unidade_id, nome)
);

CREATE TABLE IF NOT EXISTS lancamentos (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES unidades(id),
  competencia TEXT NOT NULL,
  data DATE,
  fornecedor_id INT REFERENCES fornecedores(id) ON DELETE SET NULL,
  descricao TEXT,
  valor NUMERIC NOT NULL,
  conta_dre TEXT NOT NULL,
  origem TEXT DEFAULT 'manual',
  recorrente BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS taxas (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES unidades(id),
  nome TEXT NOT NULL,                 -- ex.: Alelo Refeição, Crédito, Aluguel pinpad, Plano Anota AI
  forma TEXT,                         -- liga com vendas_forma (ALELO, CREDITO, DEBITO, PIX, TICKET/VR...)
  tipo TEXT NOT NULL CHECK (tipo IN ('percentual','mensal','por_transacao')),
  valor NUMERIC NOT NULL,
  prazo_dias INT
);

CREATE TABLE IF NOT EXISTS guias (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES unidades(id),
  tipo TEXT NOT NULL,                 -- DAS, INSS, FGTS, ISS, ICMS, IPTU, DARF, PARCELAMENTO
  competencia TEXT NOT NULL,
  vencimento DATE,
  valor NUMERIC NOT NULL,
  codigo_barras TEXT,
  paga BOOLEAN DEFAULT false,
  pago_em DATE
);

CREATE TABLE IF NOT EXISTS dre_ajustes (
  unidade_id INT NOT NULL REFERENCES unidades(id),
  competencia TEXT NOT NULL,
  linha TEXT NOT NULL,
  valor NUMERIC,
  travado BOOLEAN DEFAULT false,
  PRIMARY KEY (unidade_id, competencia, linha)
);

-- ---------- Checklist e documentos ----------
CREATE TABLE IF NOT EXISTS checklist_modelos (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES unidades(id),
  nome TEXT NOT NULL,
  quando TEXT,
  itens JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{texto, tipo:'sim'|'numero'|'texto', min, max, foto:bool}]
  ativo BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS checklist_execucoes (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES unidades(id),
  modelo_id INT NOT NULL REFERENCES checklist_modelos(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  respostas JSONB NOT NULL DEFAULT '{}'::jsonb,
  usuario_id INT REFERENCES usuarios(id),
  concluido_em TIMESTAMPTZ,
  UNIQUE (modelo_id, data)
);

CREATE TABLE IF NOT EXISTS pendencias (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES unidades(id),
  descricao TEXT NOT NULL,
  origem TEXT,
  status TEXT DEFAULT 'aberta' CHECK (status IN ('aberta','resolvida')),
  criado_em TIMESTAMPTZ DEFAULT now(),
  resolvido_em TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS documentos (
  id SERIAL PRIMARY KEY,
  unidade_id INT NOT NULL REFERENCES unidades(id),
  pasta TEXT NOT NULL,
  nome TEXT NOT NULL,
  numero TEXT,
  validade DATE,
  arquivo_key TEXT,
  arquivo_nome TEXT,
  arquivo_tipo TEXT,
  criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_consumo_comp ON consumo (unidade_id, competencia);
CREATE INDEX IF NOT EXISTS ix_lanc_comp ON lancamentos (unidade_id, competencia);
CREATE INDEX IF NOT EXISTS ix_pedidos_data ON pedidos_delivery (unidade_id, data);
