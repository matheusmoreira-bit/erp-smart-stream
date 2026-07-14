# Relatório Técnico — ERP Flow

**Projeto:** ERP Flow (Cactus Corporation)
**Domínios:** `erp-flow.cactuscorporation.com`, `erp-smart-stream.lovable.app`
**Data do relatório:** 14 de julho de 2026
**Público-alvo:** equipe técnica / auditoria de TI
**Classificação:** interno

---

## 1. Sumário executivo

O ERP Flow é uma plataforma web corporativa que orquestra processos de aprovação, despesas, adiantamentos, notas fiscais de entrada, cartões corporativos (PagCorp), auditoria fiscal e integração multi-empresa com SAP Business One e Omie. Ele opera em cima do stack Lovable Cloud (Supabase gerenciado) com **~90 tabelas** no schema `public`, **~68 Edge Functions** em Deno, RLS habilitada em toda superfície de dados e uma trilha de auditoria hash-encadeada (`audit_trail`) verificável.

Pontos fortes:

- Modelo de autorização robusto (RBAC via `user_roles` + `has_role()` SECURITY DEFINER + grupos globais de permissão + escopo por `company_db`).
- Auditoria imutável com verificação criptográfica (`verify_audit_chain`).
- Idempotência explícita nas ações de aprovação (`expense_action_idempotency`).
- Fila de e-mail durável com pgmq + cron + DLQ.
- Segregação obrigatória de base (`company_db`) entre integrações de teste e produção.
- Dependências sem vulnerabilidades high/critical no snapshot atual (override `dompurify ^3.4.12`).

Pontos de atenção (detalhados na §12):

- 3 warnings do scanner de storage (audit-console-docs, expense-attachments, nf-entrada-files) — políticas de leitura frouxas ou ausentes.
- HIBP / lockout de brute force / MFA não verificados no auth manager — precisam confirmação antes de go-live.
- Ausência confirmada de CSP/HSTS explícitos no `index.html`; dependem da camada de hosting.
- Token WhatsApp e URL do gateway estão hardcoded na Edge Function (aceito por decisão do produto, mas registrado como risco).

---

## 2. Visão de produto e escopo funcional

O produto entrega, em uma única interface, os fluxos operacionais de um centro de serviços compartilhados:

- **Aprovações corporativas** com regras por valor, centro de custo e categoria, substitutos temporários, delegação e histórico.
- **Despesas & adiantamentos** com upload de anexos, integração de retorno com SAP, auditoria de eventos e workflow multi-nível.
- **NF de entrada** (importação de XML/PDF, vínculo a pedido de compras, lançamento no SAP, watcher diário de rematch).
- **PagCorp** (cartões corporativos): sincronização de transações, mapeamento cartão↔usuário/CC/conta, tratamento de despesas não-dedutíveis, integração ao SAP.
- **Auditoria fiscal e Audit Console**: execuções (`audit_console_runs`), divergências, insights, cruzamento de dados fiscais.
- **Cadastros**: fornecedores, itens (base + variantes com codificação automática), intercompany.
- **Usuários & governança**: grupos globais de permissão, sincronização com IDP, licenças SAP, atividade e produtividade.
- **Analytics & Insights**: dashboard, métricas, análise de pagamento, ranking de atividade.
- **Notificações**: sino in-app com realtime, preferências por categoria, e-mail transacional via SMTP e alertas WhatsApp.
- **Synapse**: orquestração de agentes/integrações (JC sync, PagCorp sync, PO notify).

---

## 3. Arquitetura técnica

### 3.1 Stack e camadas

| Camada | Tecnologia |
|---|---|
| Front-end | React 18 + Vite 5 + TypeScript 5 + Tailwind 3 + shadcn/Radix |
| Roteamento | react-router-dom 7 |
| Estado assíncrono | @tanstack/react-query 5 |
| UI de fluxo | @xyflow/react 12 (mapa de relações) |
| PDF / relatórios | jspdf 4.2 + jspdf-autotable, pptxgenjs 4 |
| Charts | recharts 3 |
| Backend (BaaS) | Lovable Cloud (Supabase gerenciado): Postgres 15, PostgREST, GoTrue, Storage, Realtime |
| Runtime serverless | Deno Deploy (Supabase Edge Functions) |
| Filas | pgmq (extensão Postgres) + pg_cron |
| Auditoria | audit_trail hash-chain (pgcrypto/extensions.digest) |
| Testes | Vitest + Testing Library, Playwright |
| Lint / typecheck | ESLint 9 + typescript-eslint, `tsgo` |
| Bundler / lockfile | Bun (bun.lock em modo texto) |

### 3.2 Diagrama de contexto

```text
                        +--------------------------+
   Usuários (SPA) <---> |  React + Vite (browser)  |
                        +-----------+--------------+
                                    |
                                    | HTTPS + JWT (Supabase)
                                    v
                        +--------------------------+
                        |    Lovable Cloud API     |
                        |  PostgREST | GoTrue      |
                        |  Realtime  | Storage     |
                        +---+----------+-----------+
                            |          |
                            | RLS      | Signed URLs
                            v          v
                   +-------------------+    +-------------------+
                   |     Postgres      |    | Storage buckets   |
                   |  ~90 tabelas RLS  |    | expense-attach.   |
                   |  audit_trail      |    | nf-entrada-files  |
                   |  pgmq queues      |    | audit-console-docs|
                   |  pg_cron jobs     |    +-------------------+
                   +---------+---------+
                             |
                             | net.http_post (cron/triggers)
                             v
                   +-------------------+
                   |  Edge Functions   |
                   |  (~68 Deno fns)   |
                   +----+---+---+--+---+
                        |   |   |  |
        +---------------+   |   |  +---------------+
        v                   v   v                  v
  SAP B1 Service     Omie  PagCorp API      SMTP / WhatsApp
  Layer (multi-DB)   REST  (HMAC/AES)       Google Drive (backup)
                                            Lovable AI Gateway
```

### 3.3 Fluxos de dados críticos

**Aprovação de despesa (feliz)**

```text
UI -> insert em expenses (RLS user_id/created_by)
  -> trigger audit_trigger encadeia hash
  -> edge fn expense-approval-action valida idempotência
     (expense_action_idempotency) e chama reassign/decision
  -> approvals log em expense_approval_log
  -> quando aprovado: edge fn expense-to-sap converte e integra
  -> retorno atualizado por expense-sap-status-sync (cron)
  -> notificação in-app + email transacional (pgmq)
```

**NF de entrada**

```text
Upload XML/PDF -> bucket nf-entrada-files
  -> insert em nf_entrada_imports
  -> edge fn nf-entrada-rematch tenta vincular a PO no cache SAP
  -> ação "Lançar pedido de compras" (dropdown RowActions) abre modal
     com PDFs anexados (via pending-purchase-files)
  -> integração ao SAP via nf-entrada-to-sap
  -> watcher diário nf-entrada-rematch-daily
```

**PagCorp**

```text
pagcorp-proxy autentica com HMAC + AES em base URL configurada
  -> baixa transações, credita em pagcorp_cards
  -> pagcorp-relations-resolver liga cartão↔usuário↔CC
  -> pagcorp-to-sap gera despesa no SAP
  -> settlement watcher fecha ciclo em contas específicas
```

**Auditoria hash-chain**

```text
Toda tabela auditada -> audit_trigger AFTER I/U/D
  -> lê último row_hash como prev_hash
  -> compõe payload canônico (prev | schema | table | op | actor | old | new)
  -> row_hash = sha256(payload); insere em audit_trail
verify_audit_chain(_limit) percorre a cadeia e retorna primeiro id quebrado
```

---

## 4. Módulos funcionais (por domínio)

### 4.1 Aprovações
Rotas: `/aprovacoes`, `/aprovacoes/regras`, `/auditoria/sap/*` (histórico).
Tabelas: `approval_rules`, `approval_rule_levels`, `approver_cost_centers`, `approver_substitutes`, `approval_history`, `approval_history_sync_state`, `expense_approval_log`, `expense_action_idempotency`.
Recursos: regras multi-nível por valor/CC/categoria; substitutos com janela `starts_at/ends_at` e revogação; reatribuição segura preservando histórico (`reassign_approval_rule_safe`); delegação end-to-end testada (`approval-delegation.e2e.test.ts`).
Regra de visibilidade: usuário vê o que criou/aprova; admin tem toggle "Ver todos" default ON.

### 4.2 Despesas e adiantamentos
Rotas: `/compras` (expenses), `/financeiro/adiantamentos`, `/financeiro/reconciliacao`.
Tabelas: `expenses` (38 col), `expense_items`, `expense_attachments`, `expense_audit_log`, `advance_payments`, `advance_payment_items`, `advance_payment_attachments`, `submitted_document_hashes` (dedupe), `document_drafts`.
Recursos: drafts persistentes por usuário, dedupe por hash, edição/reversão auditada, fila SAP com retentativa (`expense-integration-retry`), backfill de vencimento (`expense-backfill-due-date`).

### 4.3 NF de Entrada
Rota: `/financeiro/nf-entrada`.
Tabelas: `nf_entrada_imports`, `nf_entrada_logs`, `nf_entrada_contas_pagar`, `nf_entrada_settings`, `sap_nf_entrada_cache`, `sap_nf_entrada_sync_state`.
Edge fns: `nf-entrada-fetch-file`, `nf-entrada-rematch`, `nf-entrada-rematch-daily`, `nf-entrada-sap-watcher`, `nf-entrada-to-sap`, `sap-nf-entrada-sync`.
UI: dropdown reutilizável de ações (`RowActionsMenu`), com a ação "Lançar pedido de compras" abrindo o modal com PDF anexado.

### 4.4 PagCorp
Rotas: `/cartoes`, `/cartoes/transacoes`, `/cartoes/mapeamento`, `/cartoes/indedutiveis`, `/cartoes/historico`.
Tabelas: `pagcorp_cards`, `pagcorp_card_mapping`, `pagcorp_item_mapping`, `pagcorp_account_mapping`, `pagcorp_settlement_accounts`, `pagcorp_supplier_links`, `pagcorp_nondeductible_cards`, `pagcorp_nondeductible_expenses`, `pagcorp_integration_log`, `pagcorp_document_relations`.
Edge fns: `pagcorp-proxy`, `pagcorp-card-mapping`, `pagcorp-relations-resolver`, `pagcorp-settlement-watcher`, `pagcorp-to-sap`.
Segredos: `PAGCORP_*` (ACCOUNT_ID, CLIENT_KEY, CLIENT_SECRET, HMAC_KEY, AES_KEY, LOGIN_EMAIL, LOGIN_PASSWORD, API_BASE_URL).

### 4.5 Auditoria fiscal e Audit Console
Rotas: `/auditoria`, `/auditoria/fiscal`, `/auditoria/cruzamento`, `/auditoria/logs`, `/backoffice/audit-trail`.
Tabelas: `audit_console_runs`, `audit_console_documents`, `audit_console_rules`, `audit_console_divergences`, `audit_console_insights`, `audit_console_logs`, `audit_console_workflow_runs`, `audit_console_workflow_steps`, `audit_console_accounts_payable`, `audit_console_approval_requests`, `audit_console_approval_decisions`, `auditoria_cruzamento_config`, `auditoria_cruzamento_fiscal`.
Edge fns: `audit-console-run`, `audit-console-analyze-doc`, `audit-cross-fiscal-run`.
Controle de acesso: `can_access_audit_console(_company_db)` — admin OU membro de `user_group_assignments` para a empresa.

### 4.6 Cadastros
Fornecedores (`/cadastros/fornecedores`): `fornecedores` (35 col) + `suppliers` + `supplier-ai-extract` (extração via IA) + `supplier-sync`.
Itens (`/cadastros/itens`): `item_base` + `item_variante` com geração automática de código via `create_item_variante` e `preview_next_codigo`.
Intercompany (`/cadastros/intercompany`): edge fn `intercompany`.

### 4.7 Usuários, permissões, licenças
Rotas: `/usuarios`, `/usuarios/lista`, `/usuarios/atividade`, `/usuarios/produtividade`, `/usuarios/licencas`, `/usuarios/importar-licencas`, `/usuarios/sincronizacao-idp`.
Tabelas: `user_roles`, `permission_groups`, `permission_group_modules`, `user_group_assignments`, `user_licenses`, `license_pricing`, `license_idle_alerts`, `user_phones`, `user_profiles`, `idp_user_mapping`.
Grupos globais (uma atribuição por `sap_email`, `company_db=NULL`), admin obtém todos os módulos; empresas Omie liberam todos os módulos (regra temporária).

### 4.8 Analytics & Insights
Rotas: `/analytics`, `/vendas`.
Componentes: `Dashboard`, `InsightsPanel`, `MetricCard`, `MonthlyLoginChart`, `UserActivityRankings`, `PaymentAnalysis`, `ReportAiChat`.

### 4.9 Notificações
Rota: `/notificacoes`.
Canais: in-app (realtime via `notifications` + `notification_preferences`), e-mail (fila pgmq + `send-smtp-email` + `email_send_log` + `suppressed_emails` + tokens de unsubscribe), WhatsApp (`whatsapp-login-watcher`, `whatsapp-approval-watcher`, `whatsapp-approval-digest`).
Overdue reminders: `overdue-reminders-dispatch` + `overdue_reminder_settings` + `overdue_reminder_log`.

### 4.10 Synapse (agentes / integrações declarativas)
Rota: `/integracoes/automacoes`.
Tabelas: `synapse_integrations`, `synapse_execution_log`, `synapse_global_settings`.
Edge fns: `synapse-jc-sync`, `synapse-pagcorp-sync`, `synapse-po-notify`.

### 4.11 AI Chat Global
Componente: `GlobalAiChat` + `report-ai-chat` (edge fn) + `ai_chat_threads` + `ai_chat_messages`. Provedor: Lovable AI Gateway (`LOVABLE_API_KEY`).

### 4.12 Backoffice / SAP
Rotas: `/backoffice`, `/backoffice/login`, `/backoffice/sap-sync`, `/backoffice/sap-sync/execucoes`, `/backoffice/sap-users`, `/backoffice/sap-users/replicate`, `/backoffice/transfer-history`, `/backoffice/audit-trail`.

---

## 5. Integrações externas

| Integração | Como conecta | Segredos usados | Observações |
|---|---|---|---|
| **SAP B1 Service Layer** | edge fn `sap-b1-proxy`, `sap-sl-cache-refresh`, `sap-po-cache-sync`, `sap-vendor-payment-cache-sync`, `sap-nf-entrada-sync`, `sap-user-profile-sync`, `sap-cancel-purchase-order`, `sap-change-password`, `sap-users-admin` | `SAP_FALLBACK_ADMIN_USERNAME`, `SAP_FALLBACK_ADMIN_PASSWORD`, `SAP_MIDDLEWARE_SECRET` | Multi-empresa via `company_db`; multi-senha (`sap-multi-password`); circuit-breaker/allowlist (`external_api_allowlist` + `register_external_api_failure/success`); health via `get_sap_sync_health` |
| **Omie** | edge fn `omie-proxy` + `src/lib/omie-client.ts` | credenciais em `system_credentials` por empresa | Regra vigente: bases Omie liberam todos os módulos, sem checagem de permissão |
| **PagCorp** | edge fn `pagcorp-proxy` (HMAC+AES) | `PAGCORP_ACCOUNT_ID`, `PAGCORP_CLIENT_KEY`, `PAGCORP_CLIENT_SECRET`, `PAGCORP_HMAC_KEY`, `PAGCORP_AES_KEY`, `PAGCORP_LOGIN_EMAIL`, `PAGCORP_LOGIN_PASSWORD`, `PAGCORP_API_BASE_URL` | Assinatura HMAC, campos sensíveis cifrados |
| **Google Drive** | connector Lovable + edge fn `backup-to-gdrive` | `GOOGLE_DRIVE_API_KEY` (managed) | Backup periódico |
| **SMTP (transacional)** | edge fn `send-smtp-email` + fila `q_transactional_emails`/`q_auth_emails` | `SMTP_PASSWORD` | Templates para auth e transacional; supressão via `suppressed_emails`; unsubscribe tokens |
| **WhatsApp gateway** | edge fns `whatsapp-*` | URL e Bearer token **hardcoded** por decisão do produto | Risco documentado (§12) |
| **Lovable AI Gateway** | edge fns `ai-assistant`, `report-ai-chat`, `supplier-ai-extract`, `audit-console-analyze-doc`, `license-analysis` | `LOVABLE_API_KEY` (managed) | Chat, análise de documentos, extração de fornecedor |
| **IDP corporativo (JumpCloud)** | edge fn `jumpcloud-proxy`, `idp-mapping`, `synapse-jc-sync` | credenciais do connector | Provisiona `idp_user_mapping` |
| **CNPJ lookup / mastertax** | `cnpj-lookup`, `mastertax-pull`, `mastertax-test` | — | Enriquecimento de fornecedor / apuração |
| **API externa de aprovações** | `external-approvals-api` documentada em `docs/external-approvals-api.md` | `EXTERNAL_APPROVALS_API_KEY` | Endpoint público para parceiros; protegido por API key + allowlist + circuit breaker |
| **Convex (legado)** | variáveis `VITE_CONVEX_URL`, `VITE_CONVEX_DEPLOY_KEY` | armazenadas | Uso residual, revisar se ainda em produção |

Regra transversal (memória de projeto): **toda integração deve persistir e filtrar por `company_db` do contexto SAP ativo** — bases de teste (`TST%`) e produção nunca compartilham histórico. Trigger `companies_auto_flag_test` marca `is_test=true` e `notifications_skip_test_companies` bloqueia notificações de bases de teste.

---

## 6. Automações e jobs agendados

### 6.1 pg_cron
- `process-email-queue` (5s enquanto houver mensagem) — despachador da fila SMTP, arma/desarma via `email_queue_wake`/`email_queue_dispatch`.
- `expense-sap-status-sync` — sincroniza status de despesas com SAP; execução gravada em `expense_sap_sync_runs`.
- `whatsapp-login-watcher` — a cada 15 min, detecta 2 falhas em 6h.
- `whatsapp-approval-watcher` — a cada 10 min.
- `nf-entrada-rematch-daily`, `nf-entrada-sap-watcher`, `sap-*-cache-sync`, `pagcorp-settlement-watcher`, `license-idle-watcher`, `overdue-reminders-dispatch`, `resend-missing-attachment-notifications`, `sap-sl-cache-refresh`.
- `prune_old_integration_data` — retenção 90 dias para `integration_log`, 60 dias para `whatsapp_*_alerts`.
- `purge_expense_action_idempotency` — remove reservas obsoletas (>15 min) e completadas (>24 h).

### 6.2 Watchers com lock
`try_watcher_lock(_name, _ttl_minutes)` / `release_watcher_lock(_name, _status, _message)` na tabela `watcher_runs` — garantem execução única mesmo com múltiplos disparos concorrentes.

### 6.3 Filas pgmq
- `q_auth_emails`, `q_transactional_emails`, DLQs correspondentes (`move_to_dlq`).
- Estado global em `email_send_state` (com `retry_after_until` para backoff).

### 6.4 Triggers
- `audit_trigger` — anexa entrada em `audit_trail` (append-only via `_audit_guard`).
- `update_updated_at_column` — mantém `updated_at`.
- `cascade_delete_company_credentials` — remove credenciais ao apagar empresa.
- `companies_auto_flag_test`, `notifications_skip_test_companies`.
- `sync_user_license_across_companies` — mantém licença consistente entre bases.

---

## 7. Modelo de dados

### 7.1 Tabelas por domínio (contagem de policies RLS)

| Domínio | Tabelas | Total policies |
|---|---|---|
| Aprovações | approval_rules(9), approval_rule_levels(9), approver_cost_centers(2), approver_substitutes(2), approval_history(2), approval_history_sync_state(1) | 25 |
| Despesas | expenses(3), expense_items(3), expense_attachments(3), expense_approval_log(3), expense_action_idempotency(1), expense_sap_sync_runs(1), submitted_document_hashes(2) | 16 |
| Adiantamentos | advance_payments(4), advance_payment_items(4), advance_payment_attachments(3) | 11 |
| NF Entrada | nf_entrada_imports(3), nf_entrada_logs(3), nf_entrada_contas_pagar(1), nf_entrada_settings(2), sap_nf_entrada_cache(1), sap_nf_entrada_sync_state(1) | 11 |
| PagCorp | pagcorp_cards(3), pagcorp_card_mapping(5), pagcorp_item_mapping(2), pagcorp_account_mapping(2), pagcorp_settlement_accounts(5), pagcorp_supplier_links(5), pagcorp_nondeductible_cards(4), pagcorp_nondeductible_expenses(4), pagcorp_integration_log(4), pagcorp_document_relations(1) | 35 |
| Audit Console | 12 tabelas `audit_console_*` | 27 |
| Auditoria cruzada | auditoria_cruzamento_config(2), auditoria_cruzamento_fiscal(2) | 4 |
| Cadastros | fornecedores(4), suppliers(4), item_base(4), item_variante(4) | 16 |
| Usuários & permissões | user_roles(1), permission_groups(2), permission_group_modules(2), user_group_assignments(2), user_profiles(4), user_phones(4), user_licenses(1), license_pricing(2), license_idle_alerts(1), idp_user_mapping(2) | 21 |
| Notificações | notifications(2), notification_preferences(1), notification_send_runs(2), email_send_log(3), email_send_state(1), email_unsubscribe_tokens(3), suppressed_emails(2), overdue_reminder_settings(2), overdue_reminder_log(1), whatsapp_login_alerts(1), whatsapp_approval_alerts(1), po_notification_sent(1) | 20 |
| Cache SAP | sap_cache(9), sap_purchase_order_cache(1), sap_purchase_order_sync_state(1), sap_vendor_payment_cache(1), sap_vendor_payment_sync_state(1) | 13 |
| Integrações | integration_log(1), integration_pause(1), synapse_integrations(2), synapse_execution_log(2), synapse_global_settings(2), enabled_erp_types(2), external_api_allowlist(1) | 11 |
| Auditoria imutável | audit_trail(1), audit_trail_archive(1), audit_log(2), expense_audit_log(0) | 4 |
| Watchers | watcher_runs(1) | 1 |
| Companies | companies(3), system_credentials(1) | 4 |
| AI Chat | ai_chat_threads(1), ai_chat_messages(1) | 2 |
| Drafts | document_drafts(4) | 4 |

Todas as tabelas do schema `public` têm RLS habilitada. **Nenhuma política `USING (true)` foi encontrada no inventário.**

### 7.2 Auditoria hash-chain
`audit_trail(id, ts, actor_id, actor_email, actor_role, session_jwt_sub, schema_name, table_name, op, row_pk, old_data, new_data, changed_cols, prev_hash, row_hash, app_context)` — cada linha carrega `prev_hash` da anterior e `row_hash = sha256(prev|schema|table|op|actor|old|new)`. `_audit_guard` bloqueia UPDATE/DELETE. `verify_audit_chain(_limit)` percorre a cadeia. `archive_audit_trail(_keep_months, _batch_limit)` move linhas para `audit_trail_archive` preservando os hashes.

### 7.3 Idempotência
`expense_action_idempotency` reserva a operação por até 15 min (`created_at`) e retém 24 h após conclusão (`completed_at`). `check_expense_action_idempotency_consistency()` reporta contagens.

### 7.4 Cache SAP + Sync State
Todas as caches (`sap_purchase_order_cache`, `sap_vendor_payment_cache`, `sap_nf_entrada_cache`) têm tabelas correspondentes de `_sync_state` (paginação/high-water mark). Função `get_nf_entrada_cache_by_po` é o entry-point tipado.

---

## 8. Segurança

### 8.1 Modelo de autorização
- **Roles**: enum `app_role ('admin','user')`; tabela `user_roles(user_id, role)` isolada; função `has_role(_user_id, _role)` SECURITY DEFINER com `search_path='public'` — usada em toda política administrativa.
- **Grupos globais**: `permission_groups` + `permission_group_modules` + `user_group_assignments`. Uma atribuição por `sap_email` (`company_db=NULL`). Admin recebe todos os módulos.
- **Escopo por empresa**: `can_access_audit_console(_company_db)` combina admin + associação em `user_group_assignments`.
- **Regra de visibilidade documental**: usuário vê o que criou/aprova; admin tem toggle "Ver todos" default ON em Approvals, ApprovalHistory e Expenses.

### 8.2 Storage
- `expense-attachments` (privado)
- `nf-entrada-files` (privado)
- `audit-console-docs` (privado)

Estado atual das policies (§8.4).

### 8.3 Segredos configurados (apenas nomes)
`EXTERNAL_APPROVALS_API_KEY`, `LOVABLE_API_KEY`, `PAGCORP_API_BASE_URL`, `PAGCORP_LOGIN_PASSWORD`, `SAP_FALLBACK_ADMIN_PASSWORD`, `SAP_MIDDLEWARE_SECRET`, `VITE_CONVEX_DEPLOY_KEY`, `GOOGLE_DRIVE_API_KEY` (managed), `PAGCORP_CLIENT_KEY`, `SAP_FALLBACK_ADMIN_USERNAME`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEYS`, `SUPABASE_JWKS`, `API_AUDIT_HISTORY_TOKEN`, `PAGCORP_ACCOUNT_ID`, `PAGCORP_CLIENT_SECRET`, `PAGCORP_HMAC_KEY`, `PAGCORP_LOGIN_EMAIL`, `SMTP_PASSWORD`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PAGCORP_AES_KEY`, `VITE_CONVEX_URL`, `SUPABASE_DB_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_PUBLISHABLE_KEY`.

Nenhum destes é referenciado literalmente no bundle do front (apenas `SUPABASE_URL`/`PUBLISHABLE_KEY`, que são publicáveis).

### 8.4 Achados atuais do scanner (14/07/2026)

| # | Nível | Bucket / recurso | Descrição |
|---|---|---|---|
| S1 | warn | `audit-console-docs` | Só existe policy ALL para admin. Se não-admin precisar acessar via `can_access_audit_console`, não existe policy correspondente (fail-closed é aceitável, mas confirmar). |
| S2 | warn | `expense-attachments` | Nenhuma política SELECT/INSERT/UPDATE/DELETE listada — o acesso hoje é implícito. Precisa políticas explícitas de posse. |
| S3 | warn | `nf-entrada-files` | Policy "nf_entrada read" permite qualquer usuário autenticado ler todos os objetos, sem checagem de `company_db`/posse. Multi-tenant vazando. |

**Dependency scan**: nenhum achado high/critical no snapshot atual (`code--dependency_scan` executado no dia do relatório). Override `dompurify ^3.4.12` está em `package.json` para blindar transitivamente o `jspdf`.

### 8.5 Checklist secure-by-default

| Item | Status | Observação |
|---|---|---|
| RLS habilitada em todas as tabelas `public` | **OK** | 100% das tabelas listadas. |
| Nenhuma policy `USING (true)` | **OK** | Não encontrada no inventário. |
| Políticas separadas SELECT/INSERT/UPDATE/DELETE | **OK** | Verificado em tabelas críticas. |
| Tokens de reset / sessão fora do schema exposto | **OK** | Gerenciado por GoTrue. |
| `service_role` fora do bundle | **OK** | Só em Edge Functions. |
| Chaves de terceiros só em Edge | **OK** | Todas via `Deno.env.get`. |
| Senha forte (min 12) | **Não verificado** | Confirmar em `configure_auth`. |
| Bloqueio de senha vazada (HIBP) | **Não verificado** | Provavelmente desabilitado; recomenda-se ligar. |
| Verificação de e-mail obrigatória | **Não verificado** | Confirmar. |
| Proteção brute force / lockout | **Não verificado** | Confirmar. |
| SSO/MFA para app interno | **Corrigir** | JumpCloud provisiona mapeamento, mas login local ainda é permitido. |
| Autorização validada no back-end | **OK** | RLS + edge fns. |
| Sem token em URL | **OK** | POST/JWT via header. |
| HTTPS + HSTS | **Corrigir** | HTTPS OK; HSTS depende do host — validar Cloudflare/hosting. |
| CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy | **Corrigir** | Nenhum meta/header configurado no `index.html`; adicionar via hosting. |
| CORS restritivo nas Edge Functions | **Verificar caso a caso** | Muitas fns aceitam `*`; deve-se restringir a domínios da aplicação. |
| Sem source maps de produção | **Verificar** | Padrão Vite: `build.sourcemap=false` (default). |
| Validação de input no servidor | **OK** | Zod nas edge fns / triggers. |
| Sanitização de saída (sem `dangerouslySetInnerHTML`) | **OK (com exceções)** | `react-markdown` sanitiza; buscar por `dangerouslySetInnerHTML` remanescente. |
| Rate limiting endpoints sensíveis | **Corrigir** | Só há circuit-breaker no `external_api_allowlist`; expandir para login, IA cara, webhooks. |
| Webhooks validam assinatura | **OK** | PagCorp usa HMAC. |
| Retenção de dados sensíveis | **OK** | `prune_old_integration_data` diário. |
| Trilha imutável | **OK** | `audit_trail` + `_audit_guard` + `verify_audit_chain`. |

### 8.6 Classes de vulnerabilidade avaliadas (fonte → sink)

| Classe | Avaliação |
|---|---|
| SQL injection | **Baixo risco** — todas as queries usam PostgREST parametrizado; funções PL/pgSQL usam `format(%I)` ou parâmetros. |
| XSS refletido/persistido | **Baixo risco** — React escapa por padrão; markdown via `react-markdown`. Auditar `dangerouslySetInnerHTML` residual. |
| SSRF | **Médio risco** — Edge fns fazem `fetch()` para URLs configuráveis (SAP `service_layer_url`, PagCorp `API_BASE_URL`). Recomenda-se allowlist por regex ou lista fixa. |
| Open redirect | Nenhum ponto identificado. |
| Path traversal / storage | Storage keys são compostos por edge fn/UI. Auditar geração de path em `expense-attachment-storage`. |
| IDOR | Mitigado por RLS `user_id`/`company_db`. Storage S3 (§8.4) é o único gap conhecido. |
| Prototype pollution | Deps sob controle; sem `lodash` no bundle. |
| ReDoS | Sem regex user-controlled no back-end. |
| Credenciais hardcoded | Um caso: token WhatsApp + URL no código da edge fn (aceito pelo produto). |
| Dependência vulnerável | Nenhuma high/critical no scan atual. |

### 8.7 Auditoria e forense
- `audit_trail` cobre entidades sensíveis (aprovações, despesas, PagCorp, credenciais).
- `verify_audit_chain(_limit)` executável por admin — deve entrar em rotina periódica (ex.: verificação diária + alerta se `ok=false`).
- `audit_log` (append-only via RLS) grava eventos de negócio de alto nível (`insert_audit_log` SECURITY DEFINER).
- `expense_audit_log` guarda visão de longo prazo.
- Backoffice `/backoffice/audit-trail` expõe UI para admin.

---

## 9. Backups, DR e retenção

- **Backups do banco**: gerenciados pela Lovable Cloud (Supabase managed). PITR e snapshots diários pelo provedor.
- **Backup complementar de arquivos**: edge fn `backup-to-gdrive` copia artefatos para o Google Drive corporativo via connector.
- **Retenção operacional**:
  - `integration_log` → 90 dias.
  - `whatsapp_login_alerts` / `whatsapp_approval_alerts` → 60 dias.
  - `expense_action_idempotency` → reservas 15 min, completadas 24 h.
  - `audit_trail` → move para `audit_trail_archive` após 6 meses via `archive_audit_trail`.
- **Recomendação**: exercitar restore em ambiente de staging trimestralmente (não há registro de DR drill documentado).

---

## 10. Testes, qualidade e observabilidade

- **Unitários**: Vitest — `useApprovalRules.test.ts`, `approvalSegments.test.ts`, `expense-dedupe.test.ts`, `report-pdf.test.ts`, `approval-delegation.e2e.test.ts`.
- **E2E**: Playwright (`playwright.config.ts` + `playwright-fixture.ts`).
- **Lint / typecheck**: ESLint 9 + typescript-eslint 8, `tsgo --noEmit`.
- **Observabilidade**:
  - `audit_log` (eventos), `audit_trail` (dado bruto), `expense_sap_sync_runs`, `notification_send_runs`, `synapse_execution_log`, `integration_log`.
  - Health SAP: `get_sap_sync_health(_last_n)` retorna JSON com cron status, última run, janela e taxa de erro.
  - Health e-mail: `email_send_state` (backoff + circuit breaker).
- **Erro tracking**: `ErrorBoundary` no front; nenhum SaaS de APM externo integrado.

---

## 11. Dependências e supply chain

### 11.1 Runtime (produção)

React 18, react-dom 18, react-router-dom 7, TanStack Query 5, Radix (26 pacotes), Tailwind 3, Tailwind-Merge, class-variance-authority, clsx, cmdk, date-fns 3, embla-carousel-react, framer-motion 11, input-otp, jspdf 4.2 + jspdf-autotable, lucide-react, next-themes, pptxgenjs 4, react-day-picker 8, react-helmet-async 3, react-hook-form 7, react-markdown 10, react-resizable-panels, react-window 2, recharts 3, sonner 1, vaul 0.9, zod 3, xyflow/react 12, @supabase/supabase-js 2, @lovable.dev/cloud-auth-js 1.

### 11.2 Dev

Vite 5, @vitejs/plugin-react-swc, TypeScript 5.8, @playwright/test 1.57, @testing-library/*, jsdom 20, eslint 9, typescript-eslint 8, autoprefixer, postcss, tailwindcss, vitest 3, lovable-tagger.

### 11.3 Overrides

```json
"overrides": { "dompurify": "^3.4.12" },
"resolutions": { "dompurify": "^3.4.12" }
```

Aplicado para blindar transitivamente `jspdf` (advisories de hook pollution, cross-realm sanitization, IN_PLACE bypass, ALLOWED_ATTR pollution).

### 11.4 Estado do scanner (dependency_scan)

Snapshot desta data: **nenhuma vulnerabilidade high/critical**. Recentemente resolvidos:
- `react-router-dom` 6.30 → 7.18 (XSS open redirect, external redirect, `//` protocol relative).
- `recharts` 2.15 → 3.9 (removeu lodash — prototype pollution / code injection).
- `dompurify` transitivo → 3.4.12 (via override).

---

## 12. Riscos e recomendações de hardening

### 12.1 Curto prazo (bloqueadores antes do próximo go-live)

1. **Storage `nf-entrada-files`** — substituir a policy atual por:
   ```sql
   CREATE POLICY "nf_entrada read owned" ON storage.objects FOR SELECT
   TO authenticated
   USING (bucket_id = 'nf-entrada-files'
          AND EXISTS (SELECT 1 FROM public.nf_entrada_imports i
                      WHERE i.storage_path = name
                        AND i.company_db IN (SELECT company_db FROM public.user_group_assignments
                                              WHERE lower(sap_email)=lower((auth.jwt()->>'email')))));
   ```
2. **Storage `expense-attachments`** — criar policies ownership-based (join por `expense_attachments.storage_path` + `expenses.created_by = auth.uid()` OU admin).
3. **Storage `audit-console-docs`** — confirmar intenção fail-closed OU adicionar policy espelhando `can_access_audit_console`.
4. Ligar **HIBP** e **verificação obrigatória de e-mail** no Auth.
5. Ativar **lockout / brute force protection** (Supabase Auth).

### 12.2 Médio prazo

6. Adicionar **CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy** — via camada de hosting (Cloudflare / Lovable) e/ou meta tags.
7. Restringir **CORS das Edge Functions** ao domínio de produção + preview conhecidos.
8. Implementar **rate limiting** em edge fns caras (`ai-assistant`, `report-ai-chat`, `supplier-ai-extract`, `external-approvals-api`).
9. Forçar **SSO/MFA** para app interno (login local só como fallback administrativo).
10. **Rotacionar** o Bearer WhatsApp e o token API externa; considerar migrar para segredo em vez de literal.
11. Validar `service_layer_url`/`api_base_url` contra allowlist (mitiga SSRF).

### 12.3 Longo prazo

12. Habilitar **CodeQL** (security-extended), **secret scanning + push protection** e **Dependabot** no repositório GitHub.
13. Automatizar **verify_audit_chain** diário com alerta em `audit_log`.
14. **DR drill** trimestral (restore de backup em staging + validação de integridade da chain).
15. Adotar APM/observabilidade externa (Sentry ou similar) para o front e edge fns.

---

## 13. Roadmap sugerido e itens em aberto

- Consolidar rotas de auditoria (`/auditoria/*`) sob um único hub com breadcrumbs.
- Deprecar Convex se não estiver mais em uso ativo — remover env vars.
- Remover regra temporária "OMIE open modules" e migrar para grupos globais assim que o modelo de permissão Omie estiver definido.
- Reforçar dedupe em `submitted_document_hashes` com TTL configurável.
- Consolidar edge fns de sync SAP (`sap-*-cache-sync`) sob um scheduler declarativo (Synapse).
- Adicionar assinatura HMAC opcional na `external-approvals-api`.

---

## Apêndice A — Rotas front-end (completo)

`/`, `/analytics`, `/aprovacoes`, `/aprovacoes/regras`, `/auditoria`, `/auditoria/cruzamento`, `/auditoria/fiscal`, `/auditoria/logs`, `/auditoria/sap/*`, `/backoffice`, `/backoffice/audit-trail`, `/backoffice/login`, `/backoffice/sap-sync`, `/backoffice/sap-sync/execucoes`, `/backoffice/sap-users`, `/backoffice/sap-users/replicate`, `/backoffice/transfer-history`, `/cadastros/fornecedores`, `/cadastros/intercompany`, `/cadastros/itens`, `/cartoes`, `/cartoes/historico`, `/cartoes/indedutiveis`, `/cartoes/mapeamento`, `/cartoes/transacoes`, `/compras`, `/financeiro/adiantamentos`, `/financeiro/nf-entrada`, `/financeiro/reconciliacao`, `/integracoes`, `/integracoes/automacoes`, `/integracoes/credenciais`, `/integracoes/monitor`, `/notificacoes`, `/perfil`, `/usuarios`, `/usuarios/atividade`, `/usuarios/importar-licencas`, `/usuarios/licencas`, `/usuarios/lista`, `/usuarios/produtividade`, `/usuarios/sincronizacao-idp`, `/vendas`, `*` (NotFound).

## Apêndice B — Edge Functions (completo)

`admin-users`, `advance-to-sap`, `ai-assistant`, `approval-history-sync`, `audit-console-analyze-doc`, `audit-console-run`, `audit-cross-fiscal-run`, `auth-email-hook`, `backup-to-gdrive`, `cnpj-lookup`, `credentials`, `expense-approval-action`, `expense-attachment-storage`, `expense-backfill-due-date`, `expense-delegate`, `expense-integration-retry`, `expense-mutation`, `expense-sap-status-sync`, `expense-to-sap`, `external-approvals-api`, `financial-review`, `fornecedor-save`, `idp-mapping`, `intercompany`, `item-save`, `jumpcloud-proxy`, `license-analysis`, `license-idle-watcher`, `mastertax-pull`, `mastertax-test`, `nf-entrada-fetch-file`, `nf-entrada-rematch`, `nf-entrada-rematch-daily`, `nf-entrada-sap-watcher`, `nf-entrada-to-sap`, `omie-proxy`, `overdue-reminders-dispatch`, `pagcorp-card-mapping`, `pagcorp-proxy`, `pagcorp-relations-resolver`, `pagcorp-settlement-watcher`, `pagcorp-to-sap`, `process-email-queue`, `process-expense-doc`, `report-ai-chat`, `resend-missing-attachment-notifications`, `sap-b1-proxy`, `sap-cancel-purchase-order`, `sap-change-password`, `sap-nf-entrada-sync`, `sap-po-cache-sync`, `sap-sl-cache-refresh`, `sap-user-profile-sync`, `sap-users-admin`, `sap-vendor-payment-cache-sync`, `send-smtp-email`, `supplier-ai-extract`, `supplier-sync`, `synapse-jc-sync`, `synapse-pagcorp-sync`, `synapse-po-notify`, `transfer-approvals`, `user-profile-save`, `whatsapp-approval-digest`, `whatsapp-approval-watcher`, `whatsapp-login-watcher`.

## Apêndice C — Funções PL/pgSQL relevantes

`has_role`, `audit_trigger`, `_audit_guard`, `_audit_canonicalize`, `_audit_row_pk`, `verify_audit_chain`, `archive_audit_trail`, `enable_audit_on`, `email_queue_wake`, `email_queue_dispatch`, `enqueue_email`, `read_email_batch`, `delete_email`, `move_to_dlq`, `try_watcher_lock`, `release_watcher_lock`, `prune_old_integration_data`, `purge_expense_action_idempotency`, `check_expense_action_idempotency_consistency`, `reassign_approval_rule_safe`, `check_applicable_approval_rules`, `active_officials_for_substitute`, `substitute_grants_for_me`, `get_default_expense_approver`, `can_access_audit_console`, `get_sap_sync_health`, `is_sap_user_admin`, `get_nf_entrada_cache_by_po`, `register_external_api_failure`, `register_external_api_success`, `check_external_api_access`, `create_item_variante`, `preview_next_codigo`, `sync_user_license_across_companies`, `cascade_delete_company_credentials`, `companies_auto_flag_test`, `notifications_skip_test_companies`, `insert_audit_log`.

## Apêndice D — Glossário

- **company_db**: identificador da base SAP/Omie ativa; é a chave de segregação multi-tenant.
- **RLS**: Row Level Security do Postgres.
- **pgmq**: extensão de filas do Supabase para Postgres.
- **HMAC / AES**: assinatura e criptografia usadas no envelope PagCorp.
- **HIBP**: Have I Been Pwned — banco de senhas vazadas usado para bloquear escolhas triviais.
- **CSP / HSTS**: cabeçalhos de segurança HTTP.
- **Chain of custody**: nesta base, o vínculo criptográfico entre linhas consecutivas de `audit_trail`.

---

*Documento gerado automaticamente a partir do inventário do repositório e do backend Lovable Cloud. Itens marcados como "Não verificado" exigem confirmação humana antes de auditoria formal.*
