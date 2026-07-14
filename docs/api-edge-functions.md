# API Reference — Edge Functions

Este documento descreve todas as Supabase Edge Functions do projeto (`supabase/functions/*`), exceto pastas utilitárias prefixadas com `_` (ex.: `_shared`), que contêm apenas código compartilhado (auth, watcher-lock, sap-fetch, etc.) e não são invocáveis via HTTP diretamente.

## Base URL e convenções

- **Base URL**: `${VITE_SUPABASE_URL}/functions/v1/<nome-da-funcao>`
- **Client-side (recomendado)**: `supabase.functions.invoke("<nome>", { body, headers })`, usando o client já configurado com a `anon key` do projeto.
- **Content-Type**: `application/json` para a maioria das funções. Algumas (upload de anexos) usam `multipart/form-data`.
- **CORS**: todas as funções respondem `OPTIONS` com `Access-Control-Allow-Origin: *` e liberam os headers customizados que utilizam (`x-sap-session`, `x-sap-route`, `x-sap-user`, `x-company-db`, `idempotency-key`, `x-api-key`, etc.). Nenhuma função restringe origem.
- **Autenticação — dois modelos coexistem no projeto**:
  1. **JWT do Lovable Cloud** (`Authorization: Bearer <access_token>`) — usado por admins e por telas que autenticam via Supabase Auth. Validado com `requireUser`/`requireAdmin` (client anon + `auth.getUser()` + RPC `has_role`).
  2. **Sessão SAP B1** — a maior parte do app não usa Supabase Auth; o usuário loga direto no SAP Service Layer. A sessão é repassada via headers `x-sap-session`, `x-sap-route`, `x-sap-user`, `x-company-db`, validados no backend por `validateSapSession` (que reconfirma a sessão contra o próprio SAP) e `requireUserOrSapSession` / `requireAdminOrSapAdmin` (helpers em `_shared/auth.ts`).
  - Muitas funções aceitam **qualquer um dos dois** (`requireUserOrSapSession*`), delegando a autorização fina (dono do documento, aprovador designado, admin) à lógica de negócio.
  - Funções de **cron/watcher** (sufixo `-watcher`, `-sync`, `-dispatch`, `-digest`) normalmente não exigem JWT — são chamadas pelo `pg_cron` com a `service_role key` interna e protegidas por lock (`tryWatcherLock`/`releaseWatcherLock`) contra execuções concorrentes.
  - `external-approvals-api` usa uma chave própria (`X-API-Key`) para consumo por sistemas externos.
- **Formato padrão de erro**: a grande maioria devolve `{ "error": "mensagem" }` (algumas incluem `stage`, `requestId`, `details`). Um subconjunto (ex.: `expense-approval-action`) usa camada de *stages* para depuração granular. Ver Apêndice.
- **Idempotência**: `expense-approval-action` suporta o header `Idempotency-Key` (ou `x-idempotency-key`) para evitar duplo processamento de aprovações.

## Índice

1. [SAP B1](#sap-b1)
2. [Despesas / Expenses](#despesas--expenses)
3. [Aprovações](#aprovações)
4. [NF Entrada](#nf-entrada)
5. [PagCorp](#pagcorp)
6. [Omie](#omie)
7. [Synapse](#synapse)
8. [Auditoria / Audit Console](#auditoria--audit-console)
9. [IdP / Usuários](#idp--usuários)
10. [Notificações (Email/WhatsApp)](#notificações-emailwhatsapp)
11. [Integrações auxiliares (CNPJ, MasterTax, Backup)](#integrações-auxiliares-cnpj-mastertax-backup)
12. [AI / Assistentes](#ai--assistentes)
13. [APIs externas (external-approvals-api)](#apis-externas-external-approvals-api)
14. [Outros](#outros)
15. [Apêndice — erros comuns e formato padrão](#apêndice--erros-comuns-e-formato-padrão)

---

## SAP B1

### `sap-b1-proxy`

**Invocação**: `supabase.functions.invoke("sap-b1-proxy", { body })`

**Objetivo**: Proxy central para login/consultas/ações no SAP Service Layer e nas HANA Views (via webhook n8n), incluindo cache de aprovações (`APPROVALS_CACHE_KEY`) e emissão de token assinado (`x-sap-auth-token`) para autenticar chamadas subsequentes das outras funções sem reenviar a senha.

**Método**: `POST` (multiplexado por `action` no corpo). `OPTIONS` para preflight.

**Autenticação**: `Authorization: Bearer <JWT Lovable Cloud>` obrigatório em `requireAuth` (via `auth.getUser()`); não aceita chamada anônima.

**Entrada** (JSON, varia por `action`, ex.: `login`, `query`, `hanaView`, etc.):
```ts
{ action: string; companyDb?: string; endpoint?: string; params?: Record<string, unknown>; body?: unknown }
```

**Exemplo de request**:
```ts
const { data, error } = await supabase.functions.invoke("sap-b1-proxy", {
  body: { action: "login", companyDb: "SBO_ANAGAMING" },
});
```

**Exemplo de response**:
```json
{ "sessionId": "xxxx", "routeId": "yyyy", "sapAuthToken": "base64.sig" }
```

**Erros**: `401` (`UNAUTHORIZED`, sem JWT válido), `500` (erro de proxy/SAP).

**Efeitos colaterais**: nenhuma escrita direta em tabela própria além de cache em memória (`Map` local, TTL 5 min); consulta SAP Service Layer e HANA views (webhook n8n).

**Segredos/env vars**: `SAP_DEFAULT_BASE_URL`, `HANA_VIEWS_URL`, `SAP_MIDDLEWARE_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`.

---

### `sap-cancel-purchase-order`

**Invocação**: `supabase.functions.invoke("sap-cancel-purchase-order", { body })`

**Objetivo**: Cancela um ou mais Pedidos de Compra (Purchase Orders) diretamente no SAP B1 via Service Layer, revertendo a despesa correspondente para `pendente_aprovacao`.

**Método**: `POST`.

**Autenticação**: Nenhuma validação de JWT/SAP session explícita no código (função interna, chamada por telas administrativas); usa lock otimista via `sap_integration_locked_at` para evitar corrida.

**Entrada**:
```ts
{ companyDb: string; docEntries: number[]; reason?: string }
```

**Exemplo de request**:
```ts
await supabase.functions.invoke("sap-cancel-purchase-order", {
  body: { companyDb: "SBO_ANAGAMING", docEntries: [1234], reason: "Erro de lançamento" },
});
```

**Exemplo de response** (sempre HTTP 200, sucesso ou erro reportado no corpo):
```json
{ "success": true, "results": [{ "docEntry": 1234, "status": 204, "ok": true, "body": "" }] }
```

**Erros**: a função sempre responde `200`; falhas de negócio vêm em `{ success: false, error }`.

**Efeitos colaterais**: `PurchaseOrders(...)/Cancel` no SAP; atualiza `expenses` (status, limpa `sap_doc_entry/doc_num`); grava `audit_log` via RPC `insert_audit_log`.

**Segredos**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, credenciais SAP em `system_credentials`.

---

### `sap-change-password`

**Invocação**: `supabase.functions.invoke("sap-change-password", { body, headers })`

**Objetivo**: Troca em lote a senha do próprio usuário SAP em todas as empresas configuradas, usando credenciais administrativas por empresa (ou fallback de ambiente).

**Método**: `POST`.

**Autenticação**: `requireUserOrSapSession` — exige JWT Lovable OU sessão SAP válida; só permite alterar a **própria** senha (`UserCode` da sessão).

**Entrada**: `{ newPassword: string, companies?: string[] }` (ver corpo completo no arquivo).

**Erros**: `401` sem sessão válida; `500` falha de login administrativo/SAP.

**Efeitos colaterais**: `PATCH /Users` no SAP para cada empresa.

**Segredos**: `SAP_DEFAULT_BASE_URL`, `SAP_FALLBACK_ADMIN_USERNAME`, `SAP_FALLBACK_ADMIN_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`.

---

### `sap-users-admin`

**Invocação**: `supabase.functions.invoke("sap-users-admin", { body })`

**Objetivo**: CRUD administrativo de usuários SAP B1 (criar, atualizar, bloquear/desbloquear, redefinir senha) usando credenciais admin por empresa.

**Método**: `POST`.

**Autenticação**: `requireAdmin` (rotas administrativas) ou `requireAdminOrSapSession` conforme ação — exige admin Cloud ou sessão SAP de superusuário/admin mapeado.

**Entrada**: `{ action: "create"|"update"|"lock"|"unlock"|"resetPassword"|..., companyDb, userCode, ...campos }`.

**Erros**: `401`/`403` (auth), `500` (falha SAP).

**Efeitos colaterais**: `POST/PATCH /Users` no SAP Service Layer.

**Segredos**: `SAP_DEFAULT_BASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`.

---

### `sap-user-profile-sync`

**Objetivo**: Consulta o cadastro do usuário SAP em todas as empresas ativas (`erp_type='sap'`) para pré-popular o perfil intercompany do usuário logado.

**Método**: `POST`. **Autenticação**: `requireUser` (JWT Lovable Cloud obrigatório — função de back-office).

**Entrada**: `{ userCode: string }` (implícito pelo contexto — consulta todas as empresas).

**Efeitos colaterais**: apenas leitura no SAP; nenhuma escrita adicional documentada além do payload de retorno.

**Segredos**: `SAP_DEFAULT_BASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

---

### `sap-po-cache-sync`

**Objetivo**: Sincronização incremental (cron) de `PurchaseOrders` do SAP para `sap_purchase_order_cache`, usado por telas de PagCorp/Financial Review sem round-trip ao SAP a cada consulta.

**Método**: `POST`/`GET` (chamado por `pg_cron`). **Autenticação**: nenhuma explícita — protegida por `tryWatcherLock`/`isTestCompanyDb`; login SAP feito com o usuário técnico `apiuser` (`loadCreds` rejeita qualquer outro username).

**Efeitos colaterais**: upsert em `sap_purchase_order_cache`.

**Segredos**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

---

### `sap-vendor-payment-cache-sync`

**Objetivo**: Sincroniza `VendorPayments` (baixas a fornecedores) para `sap_vendor_payment_cache`, incluindo `PaymentInvoices` em `invoice_links` para cruzar Pagamento ↔ NF sem nova consulta ao SAP.

**Método/Auth**: idêntico ao `sap-po-cache-sync` (cron + lock + `apiuser`).

**Efeitos colaterais**: upsert em `sap_vendor_payment_cache`.

---

### `sap-nf-entrada-sync`

**Objetivo**: Cron incremental que consulta `PurchaseInvoices` no Service Layer (filtro `UpdateDate` > cursor salvo) e faz upsert em `sap_nf_entrada_cache`, incluindo `DocEntry` do PO base de cada linha.

**Método/Auth**: cron + `tryWatcherLock` + `isTestCompanyDb`; sem JWT.

**Efeitos colaterais**: upsert `sap_nf_entrada_cache`; atualiza cursor em `sap_nf_entrada_sync_state`.

---

### `sap-sl-cache-refresh`

**Objetivo**: Atualiza cache diário (TTL 24h) de `Users`, `ApprovalTemplates` e `ApprovalStages` (com seus aprovadores) do Service Layer, para acelerar telas de configuração de aprovação.

**Método**: `POST`/cron. **Autenticação**: nenhuma explícita (uso interno/cron).

**Efeitos colaterais**: grava em tabela de cache (`sap_cache` ou equivalente).

---

## Despesas / Expenses

### `expense-mutation`

**Invocação**: `supabase.functions.invoke("expense-mutation", { body, headers })`

**Objetivo**: Centraliza todas as gravações em `expenses`/`expense_items`/`expense_attachments`/`expense_approval_log` (create, update, submit, cancel, anexos, log de decisão), pois o RLS não pode confiar em `auth.uid()` (login é via SAP).

**Método**: `POST` (405 para outros métodos).

**Autenticação**: `identifyCaller` — tenta JWT Cloud (`requireUser` + RPC `has_role`) e sessão SAP (`validateSapSession` + RPC `is_sap_user_admin`); qualquer uma habilita chamadas, mas cada ação valida posse/dono (`isOwner`) ou admin/superuser.

**Entrada** — `{ action: "create"|"update"|"submit"|"cancel"|"attachments_add"|"log_decision", expense_id?, input?, attachments?, decision?, remarks?, levelOrder? }`.
- `create`: `input` com campos da despesa (`status` restrito a `rascunho`/`pendente_aprovacao`, exceto origem `pagcorp` que pode nascer `aprovado`).
- `update`/`submit`/`cancel`: exigem `expense_id` e posse (owner) ou admin.
- `log_decision`: `decision` restrito a `created|submitted|cancelled|integrated|integration_failed`.

**Exemplo de request**:
```ts
await supabase.functions.invoke("expense-mutation", {
  body: { action: "create", input: { supplier_name: "ACME", total_amount: 1500.5, currency: "BRL", doc_type: "purchase", cost_center: "CC01" } },
  headers: { "x-sap-session": sessionId, "x-sap-route": routeId, "x-sap-user": userCode, "x-company-db": companyDb },
});
```

**Exemplo de response**:
```json
{ "ok": true, "expense": { "id": "uuid", "status": "rascunho", "total_amount": 1500.5 } }
```

**Erros**: `400` (ação/JSON inválido), `401` (não autenticado), `403` (não é dono/admin), `404` (despesa não encontrada), `405` (método inválido), `409` (status incompatível), `500` (erro Supabase).

**Efeitos colaterais**: escreve em `expenses`, `expense_items`, `expense_attachments`, `expense_approval_log`; pode disparar seleção de próximo aprovador (`pickApproverSkippingRequester`).

---

### `expense-approval-action`

**Invocação**: `supabase.functions.invoke("expense-approval-action", { body, headers })`

**Objetivo**: Autoriza e executa a decisão (aprovar/rejeitar) de uma despesa interna, validando no servidor se o chamador é o aprovador designado do nível atual (ou admin/superuser SAP), evitando que qualquer usuário aprove documentos alheios.

**Método**: `POST` apenas.

**Autenticação**: JWT Cloud (`requireUser` + `has_role admin`) **ou** sessão SAP (`validateSapSession` + `is_sap_user_admin`/superuser). Identidade comparada ao aprovador designado via `isDesignatedApprover` (email exato, prefixo antes do `@`, ou tokens do nome).

**Entrada**:
```ts
{ expense_id: string; action: "approve" | "reject"; remarks?: string }
```
Cabeçalho opcional `Idempotency-Key` (ou `x-idempotency-key`) para evitar duplo processamento.

**Exemplo de request**:
```ts
await supabase.functions.invoke("expense-approval-action", {
  body: { expense_id: "uuid", action: "approve", remarks: "OK" },
  headers: { "Idempotency-Key": crypto.randomUUID(), "x-sap-session": sid, "x-sap-user": user, "x-company-db": db },
});
```

**Exemplo de response**:
```json
{ "ok": true, "action": "approve", "expense_id": "uuid", "status": "aprovado", "requestId": "..." }
```

**Erros**:
- `400` corpo inválido / `action` inválida / `expense_id` ausente
- `401` sem autenticação válida ou sessão SAP inválida
- `403` caller não é o aprovador designado
- `404` despesa não encontrada
- `409` despesa não está `pendente_aprovacao`, ou conflito de idempotência (requisição idêntica em curso)
- `422` `Idempotency-Key` reutilizada para payload diferente
- `500` erro interno/DB

**Efeitos colaterais**: atualiza `expenses` (status, nível atual, aprovador), grava `expense_approval_log`/`audit_log`; grava resposta em `expense_action_idempotency`. Notificação e integração SAP (`expense-to-sap`) ficam a cargo do client após a resposta.

---

### `expense-delegate`

**Objetivo**: Delega ou revoga a aprovação interna de uma despesa para outro aprovador, preservando o aprovador original.

**Método**: `POST`. **Autenticação**: `requireAdminOrSapAdmin` (admin Cloud ou SAP admin/superuser).

**Entrada**:
```ts
{ action: "delegate"|"revoke"; expense_id: string; new_approver_email?: string; new_approver_name?: string; reason?: string; doc_num?, doc_type?, card_name?, doc_total?, currency? }
```

**Response**: `{ ok: true, action, current_approver, original_approver }`.

**Erros**: `400` (campos faltando/ação inválida), `401` (não autenticado), `404` (despesa não encontrada), `409` (status inválido ou nada a revogar), `500`.

**Efeitos colaterais**: `UPDATE expenses` (current_approver/original_approver); insere `audit_log` (`delegate_approval`/`revoke_delegation`).

---

### `expense-attachment-storage`

**Objetivo**: Gateway único para o bucket privado `expense-attachments` (upload, geração de signed URL, remoção), autorizando por posse do documento (despesa ou adiantamento) ou papel de aprovador/admin.

**Método**: `POST` (multipart/form-data para `upload`; JSON para `sign`/`remove`).

**Autenticação**: `identifyCaller` (JWT Cloud ou sessão SAP); ownership validado via `loadOwnedByPath`/`callerMatches`.

**Entrada**:
- Upload: `FormData` com `action=upload`, `expense_id`|`advance_id`, `file` (máx. 25 MB).
- Sign/Remove: `{ action: "sign"|"remove", file_path: string }`.

**Response** (upload): `{ file_path, file_name, file_size, mime_type }`. (sign): `{ signed_url }` válido por 300s.

**Erros**: `400` (payload inválido/arquivo grande demais), `401`/`403` (não autorizado), `404` (owner não encontrado), `405` (método), `500`.

**Efeitos colaterais**: grava/apaga objetos no bucket `expense-attachments`.

---

### `expense-backfill-due-date`

**Objetivo**: Recalcula `due_date`/`document_date` de despesas sem essa informação, reenviando os anexos para extração via IA (Lovable AI Gateway).

**Método**: `POST { action: "one", expense_id }` (dono ou admin) ou `POST { action: "batch", company_db?, limit? }` (admin only).

**Autenticação**: `identifyCaller` (JWT Cloud ou sessão SAP); `batch` exige `isCloudAdmin || isSuperUser`.

**Efeitos colaterais**: `UPDATE expenses` (due_date/document_date); chamadas ao `LOVABLE_API_KEY` (AI Gateway).

**Segredos**: `LOVABLE_API_KEY`.

---

### `expense-integration-retry`

**Objetivo**: Job (cron a cada 10 min) que reenvia ao SAP despesas aprovadas ainda não integradas, respeitando cooldown e notificando o admin via WhatsApp em caso de falha repetida.

**Método**: `POST`/cron. **Autenticação**: nenhuma explícita — best-effort, protegido pelo próprio filtro de candidatos idempotente.

**Efeitos colaterais**: dispara reenvio (lógica interna equivalente a `expense-to-sap`), envia WhatsApp via `http://.../sender_wpp` para `matheus.moreira`; respeita `getIntegrationPause("sap_b1")`.

**Segredos**: WhatsApp token hardcoded no código (`WHATSAPP_TOKEN`), `SUPABASE_SERVICE_ROLE_KEY`.

---

### `expense-to-sap`

**Invocação**: `supabase.functions.invoke("expense-to-sap", { body, headers })`

**Objetivo**: Integra uma despesa interna aprovada como Pedido de Compra (`PurchaseOrders`) no SAP B1, incluindo anexos (`Attachments2`) e PDF gerado (`pdf-lib`) quando aplicável; maior função do repositório (1378 linhas).

**Método**: `POST`. **Autenticação**: `requireUserOrSapSession` (JWT Cloud ou sessão SAP válida).

**Entrada**: `{ expense_id: string }`.

**Response** (sucesso): `{ success: true, docEntry, docNum }`. Se já integrado: `{ success: true, alreadyIntegrated: true, docEntry, docNum }`.

**Erros**: `401` (sem sessão SAP válida — "Faça login no SAP pela tela antes de integrar"), `409`/`200` com `alreadyProcessing: true` quando outro processo já está integrando (lock), `500` (erro genérico com mensagem SAP).

**Efeitos colaterais**: cria `PurchaseOrders` no SAP; upload de anexos via `Attachments2`; atualiza `expenses` (status, `sap_doc_entry`, `sap_doc_num`, `sap_integration_*`); envia e-mail via `send-smtp-email` para `matheus.moreira@anagaming.com.br`; dispara WhatsApp de contingência quando não há anexo; usa lock (`tryAcquireIntegrationLock`/`releaseIntegrationLock`) e respeita `getIntegrationPause("sap_b1")`.

**Segredos**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, credenciais SAP em `system_credentials`.

---

### `expense-sap-status-sync`

**Objetivo**: Sincroniza periodicamente (cron) o status do PO no SAP para despesas já lançadas, atualizando `sap_purchase_order_status`; se o PO foi cancelado no SAP, move `expenses.status` para `cancelado`. Usa backoff exponencial (até 8 tentativas, cap 60 min).

**Método**: `POST` (aceita `{ expenseIds: string[] }` para forçar sync manual) ou cron sem corpo. **Autenticação**: nenhuma explícita; protegido por `tryWatcherLock`.

**Efeitos colaterais**: `UPDATE expenses` (status, contatores de tentativa).

---

### `advance-to-sap`

**Objetivo**: Integra um adiantamento aprovado como Down Payment Invoice (`PurchaseDownPaymentInvoices`) no SAP B1.

**Método**: `POST`. **Autenticação**: `requireUserOrSapSession`.

**Entrada**: `{ advance_id: string }`.

**Response**: `{ success: true, docEntry, docNum }` ou `{ success: true, alreadyIntegrated: true, ... }`.

**Erros**: `401` (sem sessão SAP), `200` com `alreadyProcessing: true` (lock ativo), `500` (erro SAP/config — ex.: `dpm_account_code` ausente).

**Efeitos colaterais**: cria `PurchaseDownPaymentInvoices` no SAP; upload de anexos (`Attachments2`); atualiza `advance_payments` (status, doc_entry/num, erro); usa lock anti-duplicação.

---

## Aprovações

### `approval-history-sync`

**Objetivo**: Importa/consulta o histórico e fila de aprovações vindos de um webhook n8n ("Ana Gaming") para `public.approval_history`, mesclando também decisões registradas no próprio `audit_log` (para refletir ações tomadas dentro do ERP Flow).

**Método**: `POST` — `{ action: "list", companyDb, decision?, limit? }` para leitura; sem `action` (ou outro valor) dispara a sincronização a partir do webhook.

**Autenticação**: `requireAdminOrSapSession`; leitura (`list`) restringe resultados ao próprio usuário se a sessão for SAP não-admin.

**Erros**: `400` (`companyDb` ausente), `403` (empresa não corresponde à sessão SAP).

**Efeitos colaterais**: upsert em `approval_history` (`onConflict: company_db,external_id`), preservando decisões finais (Y/N) contra regressão para pendente; atualiza `approval_history_sync_state`.

**Segredos**: `APPROVAL_HISTORY_WEBHOOK_URL`.

---

### `transfer-approvals`

**Objetivo**: Reatribui em massa aprovações pendentes de despesas (`expenses`) de um aprovador para outro dentro de uma `company_db`, opcionalmente filtrando por centro de custo. Suporta `dry_run`.

**Método**: `POST`. **Autenticação**: `requireAdmin` (somente admin Cloud).

**Entrada**:
```ts
{ company_db: string; to_user_code: string; from_user_code?: string; cost_center?: string; dry_run?: boolean; reason?: string }
```
Exige `from_user_code` e/ou `cost_center` como filtro.

**Response**:
```json
{ "dryRun": true, "totalCandidates": 12, "transferred": [...], "skipped": [...], "errors": [] }
```

**Erros**: `400` (parâmetros faltando/iguais), `401`/`403` (não admin), `500`.

**Efeitos colaterais** (quando `dry_run=false`): `UPDATE expenses.current_approver`; cria notificação in-app; grava `audit_log`.

---

## NF Entrada

### `nf-entrada-fetch-file`

**Objetivo**: Baixa sob demanda o XML ou PDF (DANFSE, via zip) de uma NF de serviço na MasterTax, faz upload no bucket `nf-entrada-files` e retorna signed URL.

**Método**: `POST`. **Autenticação**: não explicitada no trecho inicial (uso interno, chamada por tela de NF Entrada).

**Efeitos colaterais**: upload no bucket `nf-entrada-files`.

---

### `nf-entrada-rematch`

**Objetivo**: Reexecuta o matching de uma NF de Entrada específica contra Pedidos de Compra (abertos ou em Draft) no SAP, sem duplicar vínculos.

**Método**: `POST { import_id: string }`. **Autenticação**: chamada internamente (por `nf-entrada-rematch-daily`) com `service_role`; sem validação de usuário explícita no trecho lido.

**Response**: `{ matched: boolean, ... }`.

**Efeitos colaterais**: `UPDATE nf_entrada_imports` (status, `sap_matched_*`).

---

### `nf-entrada-rematch-daily`

**Objetivo**: Cron diário que reexecuta `nf-entrada-rematch` para todas as NFs elegíveis (status `awaiting_erpflow_approval`/`integration_error`, sem PO localizado, criadas nos últimos 60 dias).

**Método**: `POST`/cron sem corpo. **Autenticação**: nenhuma — protegido por `tryWatcherLock`.

**Response**: `{ ok: true, candidates, matched, unmatched, errors }`.

---

### `nf-entrada-sap-watcher`

**Objetivo**: Polling periódico que, para NFs com status `awaiting_sap`, consulta o Draft do PO no SAP; se aprovado, cria o Draft da PurchaseInvoice; se rejeitado, marca `sap_rejected`. Também vincula `PurchaseInvoices` consumindo o PO em `nf_entrada_contas_pagar`.

**Método**: `POST`/cron. **Autenticação**: nenhuma — `tryWatcherLock` + `isTestCompanyDb`.

**Efeitos colaterais**: cria Draft de `PurchaseInvoice` no SAP; `UPDATE nf_entrada_imports`; grava vínculos via `linkNfToAp`.

---

### `nf-entrada-to-sap`

**Objetivo**: Cria um Draft de Pedido de Compra (`oPurchaseOrders`) no SAP para uma NF de Entrada já aprovada no ERP Flow. Idempotente (`sap_po_draft_id`).

**Método**: `POST`. **Autenticação**: chamada internamente; sem JWT explícito no trecho — respeita `getIntegrationPause("sap_b1")`.

**Efeitos colaterais**: `POST /Drafts` no SAP; `UPDATE nf_entrada_imports.sap_po_draft_id`.

---

### `sap-nf-entrada-sync`

Ver seção [SAP B1](#sap-b1).

---

## PagCorp

### `pagcorp-proxy`

**Objetivo**: Proxy autenticado para a API PagCorp (cartões corporativos), incluindo criptografia AES-GCM+HMAC da senha de login exigida pela PagCorp (usa chaves `aes_key`/`hmac_key` cadastradas por empresa).

**Método**: `POST`. **Autenticação**: `requireUserOrSapSession` (JWT Cloud ou sessão SAP).

**Entrada**: `{ action: string, companyDb?, ... }` (login, listar transações, etc.).

**Efeitos colaterais**: chamadas HTTP à API PagCorp; loga chamadas via `logIntegrationCall`.

**Segredos**: credenciais PagCorp em `system_credentials` (`api_base_url`, `client_key`, `client_secret`, `login_email`, `login_password`, `aes_key`, `hmac_key`, `account_id`).

---

### `pagcorp-card-mapping`

**Objetivo**: CRUD do mapeamento entre cartões PagCorp e centro de custo/projeto/item padrão para lançamento contábil (`save`, `delete`, `catalog`, `list`, `list-mappings`).

**Método**: `POST`. **Autenticação**: `requireUserOrSapSessionHeaders` (JWT Cloud ou headers de sessão SAP).

**Entrada**:
```ts
{ action: "save"|"delete"|"catalog"|"list"|"list-mappings"; company_db: string; id?, card_identifier?, card_label?, cost_center?, project?, item_code?, is_fallback? }
```

**Erros**: `400` (ação/`company_db` inválidos), `401` (não autenticado), `405` (método).

**Efeitos colaterais**: CRUD em `pagcorp_cards`.

---

### `pagcorp-relations-resolver`

**Objetivo**: Resolve internamente as relações PC ↔ NF ↔ Pagamento a partir dos caches SAP (`sap_purchase_order_cache`, `sap_nf_entrada_cache`, `sap_vendor_payment_cache`), gravando em `pagcorp_document_relations`.

**Método**: `POST` — vazio (modo cron, resolve logs "stale") ou `{ logId }` / `{ companyDb }` (modo manual).

**Autenticação**: modo manual exige `requireUserOrSapSessionHeaders` com checagem de `companyDB` da sessão contra o log; modo cron não exige auth (chamado internamente).

**Efeitos colaterais**: upsert em `pagcorp_document_relations`; pode buscar e cachear PO sob demanda (`fetchAndCachePo`).

---

### `pagcorp-settlement-watcher`

**Objetivo**: Fecha o ciclo PagCorp→SAP: quando uma NF de Entrada baixa o PO oriundo de uma transação PagCorp, este watcher emite um `VendorPayments` (baixa em Contas a Pagar) usando a conta contábil do cartão (`pagcorp_settlement_accounts`).

**Método**: `POST`/cron a cada 5 min. **Autenticação**: nenhuma explícita — protegido por `tryWatcherLock`/`isTestCompanyDb`.

**Efeitos colaterais**: `POST /VendorPayments` no SAP; `UPDATE pagcorp_integration_log.settlement_status/attempts`; grava vínculo NF↔AP (`linkNfToAp`); loga via `logIntegrationCall`.

---

### `pagcorp-to-sap`

**Objetivo**: Integra uma transação PagCorp diretamente no SAP B1 (fora do fluxo interno de aprovação), criando em sequência Pedido de Compra + Fatura AP + Pagamento de Saída.

**Método**: `POST`.

**Entrada**:
```ts
{
  transaction: { id, description, amount, currency, date, accountAlias, accountCode, receipts?, ... },
  companyDb: string;
  integrationType: "generic" | "accountability";
  supplierCode: string;
  supplierName?: string;
  integratedBy?: string;
}
```

**Autenticação**: sem `requireUser`/`requireUserOrSapSession` explícito no trecho lido (aceita `x-sap-*` headers via CORS, mas a validação principal parece ficar em `getIntegrationPause`/uso das credenciais SAP da empresa).

**Efeitos colaterais**: cria documentos no SAP (`PurchaseOrders`, `PurchaseInvoices`, `VendorPayments`); notifica por e-mail (`send-smtp-email`) sucesso/erro; respeita `getIntegrationPause("sap_b1")`.

---

## Omie

### `omie-proxy`

**Objetivo**: Proxy para a API Omie (ERP alternativo usado por algumas empresas), autenticado com `app_key`/`app_secret` armazenados por `company_db`.

**Método**: `POST`. **Autenticação**: decoupled do Lovable Cloud — a própria Omie autentica via credenciais em `system_credentials`; sem exigência de JWT/SAP session no código.

**Entrada**: `{ action: string; company_db: string; endpoint?; params? }` (ex.: `action: "login"` chama `ListarEmpresas`).

**Erros**: `400` (`action`/`company_db` ausentes ou credenciais não configuradas).

**Efeitos colaterais**: chamadas HTTP à API Omie (`https://app.omie.com.br/api/v1/...`); loga via `logIntegrationCall`.

---

## Synapse

> "Synapse" agrupa as sincronizações de dados mestres entre SAP, JumpCloud e PagCorp usadas para intercompany e para notificações de acompanhamento de pedidos.

### `synapse-jc-sync`

**Objetivo**: Cruza usuários do JumpCloud com usuários SAP B1 por e-mail/username para identificar contas órfãs ou desincronizadas.

**Método**: `POST`/cron. **Autenticação**: não explícita no trecho lido (usa `system_credentials` de `jumpcloud` e `sap`, chamado internamente/admin).

**Efeitos colaterais**: leitura nas duas APIs; grava resultado em tabela de sincronização (não detalhada nas primeiras 80 linhas, ver arquivo completo).

**Segredos**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, credenciais JumpCloud/SAP.

---

### `synapse-pagcorp-sync`

**Objetivo**: Sincroniza dados cadastrais/transacionais do PagCorp (usa a mesma criptografia AES-GCM+HMAC de login do `pagcorp-proxy`) para bases internas usadas pelo módulo intercompany.

**Método**: `POST`/cron. **Autenticação**: não explícita — uso interno via `service_role`.

**Segredos**: `LOVABLE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, credenciais PagCorp.

---

### `synapse-po-notify`

**Objetivo**: Notifica marcos de andamento de Pedidos de Compra (aprovado → GRPO/NF de entrada → fatura AP → pago) para os interessados, cruzando `PurchaseOrders`, `PurchaseDeliveryNotes` e `PurchaseInvoices` no SAP.

**Método**: `POST`/cron. **Autenticação**: nenhuma explícita — protegido por `tryWatcherLock`/`isTestCompanyDb`.

**Efeitos colaterais**: leitura no SAP; envia notificações (e-mail/WhatsApp, conforme configuração); usa `INTEGRATION_KEY = "purchase_order_notifications"` para deduplicação.

---

## Auditoria / Audit Console

### `audit-console-run`

**Objetivo**: Motor principal do Audit Console — cria uma execução (`audit_console_runs`), busca dados no SAP (PO, GRPO, faturas, pagamentos), aplica regras configuráveis (`audit_console_rules`) e gera divergências (`audit_console_divergences`) com um resumo executivo por IA.

**Método**: `POST`. **Autenticação**: `requireAdmin` (JWT Cloud + RPC `has_role admin`).

**Entrada**: `{ companyDb: string, ... }` (período, filtros).

**Tipos de divergência detectados**: `missing_order`, `value_mismatch`, `vendor_mismatch` (marca `is_fraud_flag`), `duplicate_suspected`, `payment_terms_mismatch`, `date_anomaly`, `missing_grpo`, `missing_ap`, `missing_payment`.

**Erros**: `401` (`UNAUTHORIZED`), `403` (`FORBIDDEN` — não admin), `500`.

**Efeitos colaterais**: grava em `audit_console_runs`, `audit_console_logs`, `audit_console_divergences`, `audit_console_insights` (via Lovable AI Gateway).

**Segredos**: `LOVABLE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, credenciais SAP.

---

### `audit-console-analyze-doc`

**Objetivo**: Recebe um documento (NF em XML/PDF ou contrato) enviado ao Audit Console, extrai dados estruturados via IA, confronta com os dados SAP do run e gera divergências heurísticas.

**Método**: `POST { documentId: string }`. **Autenticação**: `requireAdmin`.

**Response** (assíncrona): `{ status: "started" }` (HTTP 202) — processamento roda em `EdgeRuntime.waitUntil`. Se já em análise: `{ status: "already_analyzing" }` (202).

**Erros**: `401`, `403`, `500` (documento não encontrado, etc.).

**Efeitos colaterais**: download do storage `audit-console-docs`; `UPDATE audit_console_documents` (status, `extracted`, `divergences_created`); pode inserir em `audit_console_divergences`.

**Segredos**: `LOVABLE_API_KEY`.

---

### `audit-cross-fiscal-run`

**Objetivo**: Motor de cruzamento fiscal MasterTax × ERP (agnóstico via adapters `_shared/erp-adapters`), casando NFs de serviço (MasterTax) com contas pagas no ERP (SAP/Omie) por CNPJ + valor (tolerância) + data (janela).

**Método**: `POST`. **Autenticação**: não explicitada — assume-se uso administrativo interno.

**Entrada**:
```ts
{ empresa_id: string; periodo_inicio: string; periodo_fim: string } // datas YYYY-MM-DD
```

**Response**:
```json
{ "ok": true, "empresa_id": "...", "erp_origem": "sap", "notas_analisadas": 40, "contas_analisadas": 38, "linhas_geradas": 42 }
```

**Erros**: `400` (campos obrigatórios ausentes, empresa sem adapter de ERP), `500` (erro genérico).

**Efeitos colaterais**: apaga resultados automáticos/ambíguos anteriores do período e reinsere em `auditoria_cruzamento_fiscal` (preserva revisões manuais `confirmado_manual`/`ignorado`).

---

## IdP / Usuários

### `idp-mapping`

**Objetivo**: Gerencia o vínculo entre usuários SAP (`sap_user_code`) e identidades de provedores externos (IdP), usado para SSO/login unificado.

**Método**: `POST { action: "upsertMany"|"link"|"unlink", ... }`. **Autenticação**: `requireAdmin`.

**Erros**: `400` (parâmetros inválidos/ação inválida), `401`/`403`, `500`.

**Efeitos colaterais**: upsert/update em `idp_user_mapping`.

---

### `admin-users`

**Invocação**: `supabase.functions.invoke("admin-users", { body })` (GET/POST/DELETE via `method` do invoke).

**Objetivo**: CRUD de usuários administrativos do Lovable Cloud (Supabase Auth) — listar, convidar (com role `admin` opcional) e excluir.

**Métodos**: `GET` (listar), `POST` (convidar), `DELETE` (remover).

**Autenticação**: JWT Cloud obrigatório + checagem de role `admin` em `user_roles` (via client `service_role`, não `has_role` RPC).

**Entrada**:
- `POST`: `{ email: string; assignAdmin?: boolean (default true) }`
- `DELETE`: `{ userId: string }` (não permite auto-exclusão)

**Exemplo de response (GET)**:
```json
[{ "id": "uuid", "email": "user@empresa.com", "created_at": "...", "last_sign_in_at": "...", "role": "admin" }]
```

**Erros**: `401` (sem header Authorization / usuário inválido), `403` (chamador não é admin), `400` (email inválido / auto-exclusão / erro de convite), `405` (método), `500`.

**Efeitos colaterais**: `auth.admin.inviteUserByEmail`, `auth.admin.deleteUser`; upsert/delete em `user_roles`.

---

### `user-profile-save`

**Objetivo**: Salva/atualiza o perfil "intercompany" do usuário (nome de exibição, avatar, telefone, preferências de notificação), aceitando chamadas via JWT Cloud ou sessão SAP.

**Método**: `POST`. **Autenticação**: `requireUserOrSapSession`; se a origem for `sap_session`, só pode editar o **próprio** perfil (mesma `company_db`/`user_code` da sessão).

**Entrada**:
```ts
{
  company_db: string; user_code: string; display_name?, avatar_url?, email?, phone?,
  notify_whatsapp_overdue?, notify_whatsapp_approvals?, notify_email_overdue?, notify_email_approvals?,
  sap_synced_at?, dismissed_until?
}
```

**Erros**: `400` (`company_db`/`user_code` ausentes), `403` (sessão SAP tentando editar outro perfil), `500`.

**Efeitos colaterais**: upsert `user_profiles` (`onConflict: company_db,user_code`); espelha telefone em `user_phones`.

---

### `credentials`

**Objetivo**: CRUD genérico de credenciais de sistemas externos (`system_credentials`), por `system_name` + `company_db` (SAP, PagCorp, Omie, MasterTax, JumpCloud etc.).

**Métodos**: `GET`, `POST`, `DELETE`.

**Autenticação**:
- `GET` sem `keys` (metadados apenas, sem valores) → `requireAdminOrSapSessionHeaders` (sessão SAP também pode ler metadados da própria empresa).
- `GET` com `keys=...` (valores reais), `POST`, `DELETE` → `requireAdminOrSapAdmin` (admin Cloud ou SAP admin/superuser).

**Query params**: `system`, `company_db`, `keys` (lista separada por vírgula).

**Entrada (POST)**:
```ts
{ system_name: string; credentials: { key: string; value: string }[]; company_db?: string }
```

**Entrada (DELETE)**: `{ system_name: string; company_db?: string }`.

**Erros**: `400` (validação de tamanho/formato), `401`/`403` (auth), `405`, `500`.

**Efeitos colaterais**: upsert/delete em `system_credentials` (`onConflict: system_name,credential_key,company_db`).

---

### `jumpcloud-proxy`

**Objetivo**: Proxy administrativo para a API do JumpCloud (listar/buscar usuários).

**Método**: `GET`/`POST` (`action=listUsers|searchUsers`, via query string ou body).

**Autenticação**: `requireAdmin`.

**Erros**: `400` (ação inválida), `401`/`403`, `500`.

---

## Notificações (Email/WhatsApp)

### `send-smtp-email`

**Objetivo**: Envio genérico de e-mail via SMTP (Gmail, `system@anagaming.com.br`), usado por praticamente todos os pipes de notificação internos (integração SAP, PagCorp, backfill de anexos).

**Método**: `POST`. **Autenticação**: nenhuma validação de JWT/SAP explícita — função interna chamada com a `service_role key`.

**Entrada**:
```ts
{ to: string | string[]; subject: string; html?: string; text?: string; attachments?: { url?: string; filename?: string; contentType?: string; content?: string }[] }
```
Anexos: baixados de `url` ou enviados como `content` (base64); limite de 15 MB por anexo e 20 MB no total.

**Erros**: `500` (falha SMTP).

**Segredos**: `SMTP_PASSWORD` (usuário fixo `system@anagaming.com.br`, host `smtp.gmail.com:465`).

---

### `auth-email-hook`

**Objetivo**: Webhook oficial do Supabase Auth (`send-email hook`) para renderizar e enfileirar os e-mails transacionais de autenticação (signup, invite, magic link, recovery, email change, reauthentication) usando templates React Email. Também expõe endpoint de preview (`/preview`).

**Método**: `POST` (webhook assinado) e `GET/POST /preview` (protegido por `Authorization: Bearer <LOVABLE_API_KEY>`).

**Autenticação**: webhook — assinatura HMAC verificada via `verifyWebhookRequest` (biblioteca `@lovable.dev/webhooks-js`), usando `LOVABLE_API_KEY` como secret; preview — Bearer token igual à `LOVABLE_API_KEY`.

**Erros**: `401` (assinatura inválida), `400` (payload/versão inválidos, tipo de e-mail desconhecido), `500` (config ausente, falha ao enfileirar).

**Efeitos colaterais**: grava `email_send_log` (status `pending`), enfileira via RPC `enqueue_email` (fila `auth_emails`, processada por `process-email-queue`).

**Segredos**: `LOVABLE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

---

### `process-email-queue`

**Objetivo**: Dispatcher da fila `pgmq` de e-mails (transacionais e de autenticação), com retry exponencial, DLQ e respeito a rate-limit (429)/bloqueio (403) do provedor de e-mail Lovable.

**Método**: `POST`/cron. **Autenticação**: interna (usa `LOVABLE_API_KEY` + `service_role`).

**Efeitos colaterais**: consome mensagens de fila(s) `pgmq` (`auth_emails` e filas transacionais), envia via `sendLovableEmail`, grava `email_send_log`, move para `*_dlq` após `MAX_RETRIES=5` falhas.

**Segredos**: `LOVABLE_API_KEY`, `LOVABLE_SEND_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

---

### `resend-missing-attachment-notifications`

**Objetivo**: Backfill que reenvia por e-mail as notificações de despesas integradas ao SAP **sem anexo** (contingência), com links assinados (7 dias) dos anexos internos, para os destinatários fiscais.

**Método**: `POST`. **Autenticação**: nenhuma explícita.

**Entrada** (opcional): `{ dry_run?: boolean; expense_ids?: string[]; recipients?: string[] }` (padrão: `leonardo.oliveira@anagaming.com.br`, `fiscal@anagaming.com.br`).

**Efeitos colaterais**: signed URLs no bucket `expense-attachments`; envia e-mail via `send-smtp-email`.

---

### `overdue-reminders-dispatch`

**Objetivo**: Cron (a cada 5 min) que envia lembretes via WhatsApp para documentos vencidos (`due_date < hoje`) ainda `pendente_aprovacao`, respeitando frequência/janela configurada por `company_db` em `overdue_reminder_settings`.

**Método**: `POST`/cron. **Autenticação**: nenhuma.

**Efeitos colaterais**: `POST http://.../sender_wpp` (WhatsApp); grava histórico de lembretes enviados (para respeitar `max_reminders_per_doc`).

**Segredos**: `PUBLIC_APP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; WhatsApp token hardcoded.

---

### `whatsapp-approval-watcher`

**Objetivo**: Verifica aprovações pendentes em todas as empresas SAP (via HANA views) e envia notificação WhatsApp ao aprovador; re-lembra a cada 24h se continuar pendente.

**Método**: `POST`/cron. **Autenticação**: nenhuma — `tryWatcherLock`.

**Efeitos colaterais**: WhatsApp; leitura em `Users` (SAP) e HANA views.

**Segredos**: `HANA_VIEWS_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

---

### `whatsapp-approval-digest`

**Objetivo**: Envia um digest consolidado (a cada 4h) de todas as aprovações pendentes por aprovador, agrupando por empresa, via WhatsApp (evita spam de um alerta por documento).

**Método**: `POST`/cron. **Autenticação**: nenhuma — `tryWatcherLock`.

**Segredos**: `HANA_VIEWS_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

---

### `whatsapp-login-watcher`

**Objetivo**: Detecta 2+ falhas de login SAP consecutivas (sem sucesso entre elas) nas últimas 6h, para qualquer empresa, e dispara alerta WhatsApp para o time de suporte.

**Método**: `POST`/cron. **Autenticação**: nenhuma — `tryWatcherLock`.

**Segredos**: `HANA_VIEWS_URL`, `SUPABASE_SERVICE_ROLE_KEY`; WhatsApp token/telefone hardcoded (`WHATSAPP_TO`).

---

### `license-idle-watcher`

**Objetivo**: Detecta usuários SAP com licença PRO/CRM sem login por mais de 15 dias e envia alerta via WhatsApp + e-mail; re-alerta uma vez por semana ISO.

**Método**: `POST`/cron. **Autenticação**: nenhuma — `tryWatcherLock`.

**Efeitos colaterais**: WhatsApp + e-mail (`send-smtp-email`); grava em `license_idle_alerts`.

**Segredos**: `HANA_VIEWS_URL`.

---

## Integrações auxiliares (CNPJ, MasterTax, Backup)

### `cnpj-lookup`

**Objetivo**: Consulta dados cadastrais de um CNPJ na API pública `cnpj.ws`, verificando antes se já existe fornecedor cadastrado localmente (evita duplicidade).

**Método**: `POST`. **Autenticação**: nenhuma (função pública, chamada de telas de cadastro).

**Entrada**: `{ cnpj: string }` (14 dígitos, com ou sem máscara).

**Response (novo)**:
```json
{ "exists": false, "data": { "tipo_pessoa": "pj", "cnpj": "...", "razao_social": "...", "socios": [...] }, "raw": { ... } }
```
**Response (já existe)**: `{ "exists": true, "fornecedor": { ... } }`.

**Erros**: `400` (CNPJ inválido), `404` (não encontrado na base pública), `405` (método), `429` (limite de consultas da API pública), `502` (falha na API), `500`.

**Efeitos colaterais**: apenas leitura em `fornecedores`.

---

### `fornecedor-save`

**Objetivo**: Insere um novo fornecedor (PJ ou PF) na tabela `fornecedores`, com checagem de duplicidade por CNPJ/CPF.

**Método**: `POST`. **Autenticação**: nenhuma explícita.

**Entrada**: `{ payload: { tipo_pessoa: "pj"|"pf", cnpj?|cpf?, razao_social?, ... } }`.

**Erros**: `400` (CPF/CNPJ inválido, nome obrigatório para PF), `409` (duplicado — `23505`).

**Response (existente)**: `{ ok: true, id, existed: true, fornecedor }`. **Response (novo)**: `{ ok: true, id, existed: false, fornecedor }`.

---

### `item-save`

**Objetivo**: Cadastro de itens/serviços com geração automática de código sequencial (`item_base` + `item_variante`), usado no módulo de compras.

**Método**: `POST` — ações `findOrCreateBase`, `previewCode`, `createVariante`. **Autenticação**: nenhuma explícita.

**Erros**: `400` (parâmetros faltando/tipo inválido), `404` (`item_base` não encontrado), `409` (falha ao gerar código único após 5 tentativas).

**Efeitos colaterais**: insere em `item_base`/`item_variante`; usa RPC `preview_next_codigo`.

---

### `supplier-sync`

**Objetivo**: Helper simples para localizar (`findByTaxId`) ou inserir (`insert`) fornecedores na tabela `suppliers` (distinta de `fornecedores`, usada pelo fluxo PagCorp/expenses).

**Método**: `POST`. **Autenticação**: nenhuma explícita.

**Entrada**: `{ action: "findByTaxId", taxId, companyDb }` ou `{ action: "insert", row }`.

---

### `supplier-ai-extract`

**Objetivo**: Extrai dados do fornecedor (emissor) a partir de um documento (nota fiscal, recibo, invoice) usando IA multimodal (imagens/base64), retornando um `tool_call` estruturado com CNPJ/EIN/VAT etc.

**Método**: `POST`. **Autenticação**: nenhuma (a nota do código explica que não há sessão Supabase Auth nesse contexto SAP).

**Entrada**: `{ description?, amount?, receipts?, attachments?: [{ name?, url?, mime?, base64? }], hint? }`.

**Response**: objeto com campos do tool `extract_supplier` (card_name, federal_tax_id, email, telefones, endereço, `confidence`).

**Segredos**: `LOVABLE_API_KEY`.

---

### `mastertax-pull`

**Objetivo**: Busca NFs de serviço novas na API MasterTax (`GET /api/notas-servico`) por empresa, baixa XML quando disponível, e faz upsert idempotente em `nf_entrada_imports`.

**Método**: `POST`/cron. **Autenticação**: nenhuma explícita (uso interno).

**Efeitos colaterais**: upsert `nf_entrada_imports`; loga via `logIntegrationCall`.

---

### `mastertax-test`

**Objetivo**: Valida as credenciais MasterTax cadastradas para uma empresa, chamando o endpoint autenticado `GET /api/notas-servico`.

**Método**: `POST`/`GET`. **Autenticação**: `requireAdminOrSapAdmin`.

**Query/entrada**: `company_db` (query string) — restringe à empresa da sessão se SAP.

**Erros**: `404` (sem credenciais cadastradas), `400` (token/empresa_id ausentes).

---

### `backup-to-gdrive`

**Objetivo**: Backup automático (cron a cada 6h) de tabelas críticas (`expenses`, `advance_payments`, `nf_entrada_imports`, etc.) e espelhamento dos buckets `expense-attachments`/`nf-entrada-files` para o Google Drive, com retenção de 90 dias.

**Método**: `POST`/cron. **Autenticação**: nenhuma — `tryWatcherLock`; roda em background via `EdgeRuntime.waitUntil`.

**Response imediata**: `{ ok: true, started: true, message: "Backup em execução em segundo plano..." }`.

**Efeitos colaterais**: leitura em várias tabelas; upload no Google Drive via `connector-gateway.lovable.dev/google_drive`; remove snapshots com mais de 90 dias.

**Segredos**: `LOVABLE_API_KEY`, `GOOGLE_DRIVE_API_KEY`.

---

## AI / Assistentes

### `ai-assistant`

**Objetivo**: Chat com ferramentas (tool-calling) que permite ao usuário consultar dados do sistema (empresas, licenças, despesas, aprovações pendentes, fornecedores, auditoria, notificações) em linguagem natural.

**Método**: `POST`. **Autenticação**: JWT Cloud obrigatório (`sbUser.auth.getUser`); algumas ferramentas (`pagcorp_integration_stats`, `audit_log_recent`, `idle_license_alerts`) exigem role `admin` internamente.

**Entrada**: `{ messages: {role, content}[]; threadId?: string }`.

**Response**: `{ content: string }` (não streaming; loop de até 8 chamadas de ferramenta via Lovable AI Gateway, modelo `google/gemini-2.5-flash`).

**Erros**: `401` (sem JWT), `429` (rate limit do gateway IA), `402` (créditos esgotados), `500`.

**Efeitos colaterais**: persiste mensagens em `ai_chat_messages`/`ai_chat_threads`; apenas leitura nas demais tabelas.

**Segredos**: `LOVABLE_API_KEY`.

---

### `report-ai-chat`

**Objetivo**: Chat de IA (streaming) para responder perguntas sobre um relatório de compras/pagamentos já carregado na tela (BI), usando o contexto do relatório como prompt.

**Método**: `POST`. **Autenticação**: nenhuma explícita.

**Entrada**: `{ messages: {role, content}[]; reportContext: string }`.

**Response**: stream SSE (`text/event-stream`) repassado do Lovable AI Gateway (`google/gemini-3-flash-preview`).

**Erros**: `429` (rate limit), `402` (créditos insuficientes), `500`.

**Segredos**: `LOVABLE_API_KEY`.

---

### `license-analysis`

**Objetivo**: Consolida dados de licenciamento SAP (cache de usuários + `user_licenses` + `license_pricing`) para a tela de análise de licenças.

**Método**: `GET`/`POST`. **Autenticação**: `requireUser` (JWT Cloud).

**Query**: `company_db` (opcional).

**Response**: `{ users: [...], pricing: [...] }`.

**Erros**: `401`/`403` (auth), `500`.

---

## APIs externas (external-approvals-api)

### `external-approvals-api`

**Invocação**: consumida por **sistemas externos**, não pelo front-end da aplicação — chamada via HTTP direto: `POST ${VITE_SUPABASE_URL}/functions/v1/external-approvals-api`.

**Objetivo**: Expõe endpoints REST para um sistema externo listar/aprovar/rejeitar solicitações de aprovação SAP B1 (Approval Requests) sem acesso direto ao Service Layer.

**Método**: `POST` (único método aceito).

**Autenticação**: header `X-API-Key: <EXTERNAL_APPROVALS_API_KEY>` — chave compartilhada, **não** é JWT nem sessão SAP.

**Entrada** (`op` determina a operação):
```ts
// Listar
{ op: "list", company_db: string, user_code: string }
// Aprovar
{ op: "approve", company_db: string, user_code: string, approval_request_id: number, step: number, remarks?: string }
// Rejeitar
{ op: "reject", company_db: string, user_code: string, approval_request_id: number, step: number, remarks?: string }
```

**Exemplo de request** (chamada externa, não via `supabase.functions.invoke`):
```http
POST /functions/v1/external-approvals-api HTTP/1.1
Content-Type: application/json
X-API-Key: <chave>

{ "op": "approve", "company_db": "SBO_ANAGAMING", "user_code": "jdoe", "approval_request_id": 4821, "step": 1, "remarks": "Aprovado" }
```

**Exemplo de response**:
```json
{ "ok": true, "approvalRequestId": 4821, "status": "Approved" }
```

**Erros**: `401`/`403` (API key ausente/errada — inferido pela política do endpoint, ver `_shared`), `400` (`op` inválido, `company_db` sem credenciais), `500` (falha de login/consulta no SAP).

**Efeitos colaterais**: `PATCH`/decisão em `ApprovalRequests` no SAP Service Layer (login/logout administrativo por chamada).

**Segredos**: `EXTERNAL_APPROVALS_API_KEY`, credenciais SAP em `system_credentials` por `company_db`.

---

## Outros

### `financial-review`

**Objetivo**: Módulo de conciliação financeira — identifica adiantamentos/down payments em aberto no SAP B1 (AR e AP) e permite vincular a faturas, reconciliar internamente ou cancelar o pagamento.

**Método**: `POST` (ações múltiplas, paginação customizada `sapGetAll`). **Autenticação**: `requireUserOrSapSession`.

**Efeitos colaterais**: leitura/gravação no SAP conforme ação (link/cancel); grava histórico de reconciliação.

---

### `intercompany`

**Objetivo**: Lê/cria Plano de Contas (Chart of Accounts) e Centros de Lucro (Profit Centers) em **todas** as empresas SAP ativas simultaneamente, usando as credenciais de cada uma, com relatório por empresa (best-effort).

**Método**: `POST`. **Autenticação**: `requireAdminOrSapAdmin`.

**Efeitos colaterais**: leitura/gravação (`ChartOfAccounts`, `ProfitCenters`) em múltiplas bases SAP; falhas por empresa não interrompem as demais.

---

## Apêndice — erros comuns e formato padrão

### Formato padrão de resposta de erro

```json
{ "error": "Mensagem legível em português" }
```
Variações comuns adicionam campos extras, por exemplo:
```json
{ "error": "Despesa não está pendente de aprovação (status atual: aprovado).", "stage": "load_expense", "requestId": "..." }
```

### Códigos HTTP usados no projeto

| Código | Significado no contexto do projeto |
|---|---|
| `200` | Sucesso (algumas funções, como `sap-cancel-purchase-order`, sempre retornam 200 e reportam falha no corpo) |
| `202` | Processamento assíncrono iniciado (`audit-console-analyze-doc`) |
| `400` | Corpo/parâmetros inválidos, validação de negócio (ex.: CNPJ inválido, campos obrigatórios ausentes) |
| `401` | Não autenticado — sem JWT válido, sem sessão SAP válida, ou API key ausente |
| `403` | Autenticado mas sem permissão — não é admin, não é o aprovador designado, empresa não corresponde à sessão |
| `404` | Recurso não encontrado (despesa, documento, fornecedor, credenciais) |
| `405` | Método HTTP não suportado pela função |
| `409` | Conflito de estado (status incompatível, idempotência em curso, código duplicado) |
| `422` | Conflito de payload em requisição idempotente (`Idempotency-Key` reaproveitada com dados diferentes) |
| `429` | Limite de requisições atingido (API pública de CNPJ, Lovable AI Gateway) |
| `500` | Erro interno — falha de banco, falha de integração SAP/PagCorp/Omie/MasterTax, exceção não tratada |
| `502` | Falha ao consultar API externa (`cnpj-lookup`) |

### Padrões de autorização

- **Admin Cloud**: JWT válido + RPC `has_role(_user_id, 'admin')` = `true`.
- **SAP session**: headers `x-sap-session` + `x-sap-route` + `x-sap-user` + `x-company-db`, revalidados contra o próprio SAP Service Layer (`validateSapSession`).
- **SAP admin/superuser**: sessão SAP válida + (`Users?$filter=Superuser eq 'tYES'` no SAP) ou mapeamento em `is_sap_user_admin` (RPC).
- **Dono do recurso**: comparação normalizada (`emailPrefix`/tokens de nome) entre o identificador do chamador e `requester_email`/`requester_name`/`created_by_email` do registro.
- **Cron/Watcher**: sem autenticação de usuário; protegido por lock de execução única (`tryWatcherLock` / `releaseWatcherLock`) e, em integrações com SAP, pelo interruptor global `getIntegrationPause("sap_b1")`.
