## Objetivo

Na tela **Regras de Aprovação**:
1. Permitir definir se a regra se aplica a **Compras**, **Vendas** ou **Ambos**.
2. Adicionar botão de **edição** em cada regra (hoje só dá para ativar/desativar/excluir).

## O que muda

### 1. Filtro de tipo de documento (compra/venda/ambos)

- Aproveitar a coluna `doc_type` que já existe em `approval_rules` (valores: `purchase`, `sales`, `both`).
- Adicionar um **Select** no formulário da regra: "Tipo de Documento" → Compra / Venda / Ambos (padrão: Ambos).
- No card da regra, exibir um badge com o tipo (Compra, Venda, Ambos).
- Na engine de matching (`useExpenses.ts` → `findMatchingRule`): filtrar regras onde `doc_type = <tipo da despesa>` OR `doc_type = 'both'` OR `doc_type IS NULL` (compat com regras antigas).

### 2. Botão de edição da regra

- Adicionar ícone de lápis no `RuleCard`, ao lado do switch e do excluir.
- Refatorar `CreateRuleModal` para virar **`RuleFormModal`** (modo create/edit). Recebe `rule?: ApprovalRule` opcional; quando informado, pré-preenche campos e título vira "Editar Regra".
- No `useApprovalRules`, adicionar `updateRule(id, input)`:
  - Atualiza `approval_rules` (nome, prioridade, critérios, doc_type).
  - Substitui os níveis: `delete` em `approval_rule_levels where rule_id = id` e `insert` dos novos níveis.
  - Refresh ao final.

### 3. Auditoria

Registrar em `audit_log` ações `create_rule`, `update_rule`, `delete_rule` e `toggle_rule` (já gera log nas demais telas — seguir o mesmo padrão de `logAuditAction`).

## Arquivos afetados

- `src/hooks/useApprovalRules.ts` — adicionar campo `doc_type` no tipo `ApprovalRule` / `CreateRuleInput`, persistir no create, novo `updateRule`, logs de auditoria.
- `src/hooks/useExpenses.ts` — filtrar regras por `doc_type` no `findMatchingRule` usando o `docType` recebido pelo hook.
- `src/pages/ApprovalRules.tsx` — Select de tipo no modal, badge no card, botão editar, lógica de abrir o modal em modo edição.

Sem necessidade de migração (coluna já existe).