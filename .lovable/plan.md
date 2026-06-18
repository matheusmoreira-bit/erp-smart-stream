# Item 1 — Adiantamentos a Fornecedor

Adicionar funcionalidade de adiantamentos avulsos a fornecedor, espelhando o padrão já existente em **Despesas (Expenses)**: criação → aprovação → integração SAP.

## Decisões já confirmadas
- **Escopo:** apenas adiantamento a fornecedor (não colaborador), apenas avulso (sem vínculo a PO nesta v1).
- **Doc SAP:** `PurchaseDownPaymentInvoices` (Down Payment Invoice).
- **Fluxo de aprovação:** mesmo motor das `approval_rules` já existentes, com `doc_type = 'purchase'`.

## Modelo de dados (nova tabela)

`public.advance_payments`
- `supplier_card_code` (CardCode SAP), `supplier_name`, `supplier_cnpj`
- `company_db`, `amount` (numeric), `currency` (3 letras, default da moeda escolhida — sem forçar BRL)
- `due_date`, `remarks`
- `requester_id` (auth.uid), `requester_name`, `requester_email`
- `status`: `draft | pending | approved | rejected | integrating | integrated | failed`
- `current_approval_level`, `total_approval_levels`
- `sap_doc_entry`, `sap_doc_num`, `sap_integration_status`, `sap_integration_error`, `sap_integrated_at`
- timestamps padrão

`public.advance_payment_attachments` (mesma forma da `expense_attachments`, bucket `expense-attachments` reaproveitado em pasta `advances/{id}/`).

Aprovações reaproveitam `approval_history` com `entity_type = 'advance_payment'` (mesma tabela já usada para expenses/PagCorp).

**RLS:**
- `SELECT/UPDATE/DELETE`: dono (`requester_id = auth.uid()`) **ou** aprovador atual **ou** admin.
- `INSERT`: qualquer usuário autenticado (`requester_id = auth.uid()`).
- GRANT `authenticated` + `service_role`.

## UI

Nova rota `/adiantamentos` (link no MainMenu, ao lado de Despesas):

**Listagem** — mesmo layout de `Expenses.tsx` (cards/tabela, filtros por status/empresa, busca, badges de status com as cores já usadas).

**Modal "Novo Adiantamento"** (novo componente `CreateAdvanceModal.tsx`):
- Empresa (combobox de `companies` ativas)
- Fornecedor — `SapSearchCombobox` mostrando **Nome + CNPJ** (TaxId do BP) para evitar duplicatas
- Valor + Moeda (select BRL/USD/EUR; preserva o código ao longo do fluxo)
- Data prevista
- Observação/justificativa (textarea)
- Anexos (drag&drop, mesmo padrão do CreateExpenseModal)
- Botões: Salvar Rascunho / Enviar para Aprovação

**Modal de detalhe/aprovação** — reaproveita o padrão de `ExpenseDetailModal` (timeline de aprovação, ações Aprovar/Reprovar, comentário).

Página de **Aprovações** existente passa a listar adiantamentos pendentes junto com os demais documentos (filtro de tipo).

## Edge function `advance-to-sap`

Nova função, baseada em `expense-to-sap`:
1. Valida usuário/sessão SAP (reutiliza `requireUserOrSapSession` e `getSapCredentials`).
2. Login SAP por `company_db`.
3. Monta payload `PurchaseDownPaymentInvoices`:
   ```
   { CardCode, DocDate, DocDueDate, DocCurrency, DocumentLines: [{
       ItemCode/AccountCode, LineTotal: amount, ... }],
     Comments: remarks, U_RequesterEmail }
   ```
4. POST `/b1s/v2/PurchaseDownPaymentInvoices`.
5. Upload de anexos (mesmo helper `ensureSapDocumentAttachmentLinked` já existente).
6. Persiste `sap_doc_entry`, `sap_doc_num`, status `integrated` / `failed` + mensagem real do SAP.

**Disparo:** ao bater no último nível de aprovação, chama `advance-to-sap` automaticamente (mesmo padrão das expenses).

## Itens fora deste plano (próximos)
- Item 2 (Observação fixa ao trocar de card) — quick fix isolado.
- Item 3 (Troca de senha sem senha atual + lote) — ajusta `ChangePasswordDialog` e `sap-multi-password`.
- Item 4 (Mapa de Relações) — componente visual reutilizável.
- Item 5 (Toggle ERP Flow x SAP em Pedidos) — flag de origem na listagem.

## Pontos abertos para confirmar antes de codar

1. **Linha do DownPaymentInvoice** — SAP exige itens ou conta contábil. Opções:
   - (a) Linha única com **conta contábil padrão de adiantamento** (configurável por empresa em `system_credentials` → ex.: `dpm_account_code`).
   - (b) Linha com **ItemCode genérico** ("ADIANT") cadastrado no SAP.
   - (c) Usuário escolhe item/conta na criação.
   Recomendo **(a)** — adiantamento normalmente não tem item; usa conta contábil.

2. **Nível de aprovação** — uso as `approval_rules` existentes filtradas por `doc_type='purchase'` e critério por valor, ou crio um doc_type novo `advance`?
   Recomendo **reutilizar `purchase`** para não fragmentar regras.

3. **Moeda multi-FX** — quando moeda ≠ moeda local da empresa SAP, o SAP exige `DocRate`. Busco automaticamente a taxa do dia via `SBOBobService_GetCurrencyRate` ou deixo campo manual?
   Recomendo **automático** (consulta `SBOBobService_GetCurrencyRate` no momento da integração).
