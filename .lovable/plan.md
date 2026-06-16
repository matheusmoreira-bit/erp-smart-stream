# Expansão: Módulos de Itens e Fornecedores

Adicionar dois módulos na área de Cadastros, totalmente no backend Lovable Cloud (Supabase), reaproveitando padrão visual atual (shadcn + Tailwind + páginas em `src/pages` + hooks em `src/hooks`).

---

## 1. Módulo Itens (Item-base + Variantes)

### Tabelas novas
- `item_base`
  - `tipo` (`item_tipo` enum: `produto` | `servico`)
  - `ncm` (texto, só dígitos; obrigatório se `produto`)
  - `codigo_servico` (texto, ex.: `1.05`; obrigatório se `servico`)
  - `grupo`, `unidade` (texto)
  - Restrições: `CHECK` garantindo NCM 8 dígitos quando produto / codigo_servico quando serviço; índices únicos parciais `(tipo, ncm)` e `(tipo, codigo_servico)`.
- `item_variante`
  - `item_base_id` FK
  - `sequencial` int
  - `descricao` texto
  - `codigo_completo` texto único
  - Único `(item_base_id, sequencial)`

### Geração atômica do código (servidor)
- Função `create_item_variante(p_item_base_id uuid, p_descricao text)` (`SECURITY DEFINER`, `plpgsql`):
  - `LOCK TABLE item_variante IN SHARE ROW EXCLUSIVE` (ou `SELECT ... FOR UPDATE` no `item_base`).
  - `next_seq = COALESCE(MAX(sequencial),0) + 1` para aquele `item_base_id`.
  - Monta `codigo_completo`:
    - Produto: `'P' || ncm || '.' || lpad(next_seq::text, 3, '0')`
    - Serviço: `'S' || codigo_servico || '.' || lpad(next_seq::text, 4, '0')`
  - Insere e retorna a linha. Em caso de `unique_violation`, retry (loop com limite).
- Função `preview_next_codigo(p_item_base_id uuid)` para mostrar o código previsto na UI antes de salvar.

### RLS / GRANT
- RLS habilitado nas duas tabelas.
- Leitura: `authenticated`. Escrita: `authenticated` (todos os usuários logados podem cadastrar). `GRANT` para `authenticated` e `service_role`.
- Auditoria via `insert_audit_log` em criar/editar.

### UI — `src/pages/Items.tsx` (substitui SAP-only) ou novo `src/pages/cadastros/Itens.tsx`
- Listagem: tabela com `codigo_completo`, descrição, tipo, grupo, unidade. Busca server-side por código e descrição (ILIKE em `item_variante.descricao` + `codigo_completo`).
- Modal "Novo item" em 2 passos:
  1. Tipo + chave fiscal (NCM/Código de Serviço) → `lookup` no `item_base`. Se existe → reaproveita (mostra grupo/unidade somente leitura). Se não → form de criação do item-base.
  2. Descrição da variante + preview do `codigo_completo` (via `preview_next_codigo`). Salvar chama `create_item_variante`.
- Botão "Nova variante" em cada linha agrupada por `item_base` (atalho para Passo 2).
- Validações zod:
  - NCM: `/^\d{8}$/`
  - Código de Serviço: `/^\d+(\.\d+)+$/`
  - Descrição: 1–255 chars.

---

## 2. Módulo Fornecedores

### Tabela `fornecedores`
- `tipo_pessoa` (`pj` | `pf`)
- `cnpj` texto (somente dígitos, único quando não nulo) / `cpf` texto (único quando não nulo)
- `razao_social`, `nome_fantasia`, `tipo_estabelecimento` (matriz/filial), `situacao_cadastral`, `data_inicio_atividade`
- `natureza_juridica_id`, `natureza_juridica_descricao`
- `porte`, `capital_social numeric`
- `cnae_principal_codigo`, `cnae_principal_descricao`
- `cnaes_secundarios jsonb`
- `logradouro`, `numero`, `complemento`, `bairro`, `cep`, `municipio`, `municipio_ibge`, `uf`, `pais`
- `telefone1`, `telefone2`, `email`
- `inscricao_estadual`
- `simples_nacional bool`
- `socios jsonb`
- `created_by uuid` (default `auth.uid()`)
- Índices únicos parciais: `(cnpj) WHERE cnpj IS NOT NULL`, `(cpf) WHERE cpf IS NOT NULL`.

### RLS / GRANT
- `authenticated` lê/escreve; `service_role` ALL. Auditoria em insert/update.
- Sem campos bancários nem de pagamento.

### Edge Function `cnpj-lookup`
- Recebe `{ cnpj }`, normaliza, valida 14 dígitos.
- Antes de chamar API, consulta `fornecedores` para detectar duplicado e retorna `{ exists: true, id }`.
- Caso contrário, `fetch('https://publica.cnpj.ws/cnpj/' + digits)`. Trata 429 (rate limit) e 404. Retorna JSON cru + payload normalizado já mapeado.
- CORS via `npm:@supabase/supabase-js@2/cors`. Verifica JWT do chamador.

### UI — `src/pages/cadastros/Fornecedores.tsx`
- Listagem: razão social/nome, CNPJ/CPF, município/UF, situação.
- Modal "Novo fornecedor":
  - Escolha PJ/PF.
  - PJ: input CNPJ + botão "Buscar dados" → chama edge function. Se duplicado, mostra toast com link "Abrir cadastro". Caso ok, popula form editável (todos os campos do mapeamento). Salvar grava em `fornecedores`.
  - PF: form manual (CPF, nome, endereço, contato). Checa duplicidade por CPF antes de salvar.
- Validações zod: CNPJ 14 dígitos, CPF 11 dígitos, email opcional válido, CEP 8 dígitos.

---

## 3. Navegação / Menu
- Adicionar entradas "Itens" e "Fornecedores" no `MainMenu` sob seção Cadastros.
- Rotas em `src/App.tsx`:
  - `/cadastros/itens`
  - `/cadastros/fornecedores`
- Proteger com o wrapper de auth existente (não admin-only).

---

## 4. Arquivos a criar/editar
**Migração SQL** (uma só): cria enums, tabelas, índices, funções `create_item_variante`, `preview_next_codigo`, RLS e GRANTs.

**Edge function nova**: `supabase/functions/cnpj-lookup/index.ts`.

**Frontend**:
- `src/pages/cadastros/Itens.tsx`
- `src/pages/cadastros/Fornecedores.tsx`
- `src/components/items/ItemBaseStep.tsx`
- `src/components/items/ItemVarianteStep.tsx`
- `src/components/fornecedores/FornecedorPjForm.tsx`
- `src/components/fornecedores/FornecedorPfForm.tsx`
- `src/hooks/useItensCadastro.ts`
- `src/hooks/useFornecedores.ts`
- Editar `src/App.tsx` (rotas) e `src/components/MainMenu.tsx` (links).

---

## 5. Critérios de aceite cobertos
- Código gerado exatamente `P{NCM}.{3}` / `S{cod}.{4}` via função SQL.
- Sequencial atômico (transação + retry em unique violation).
- Busca por código e qualquer descrição.
- CNPJ via edge function com mapeamento completo.
- Unicidade CNPJ/CPF no banco + checagem antes de salvar.
- PF com form manual.
- Nenhum campo bancário/pagamento.

Confirma para eu executar?
