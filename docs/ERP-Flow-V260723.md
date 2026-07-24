# ERP Flow — Plano Unificado de Otimização (V260723)

> Documento vivo. Baseado em: `security--run_security_scan` (155 achados),
> `supabase--linter` (140 issues), inventário de 84 edge functions, memórias
> do projeto e histórico de sessões.
>
> **Sequência de execução aprovada pelo usuário:**
> Segurança → Backend/Integrações → Observabilidade → Refatorações → **UI/UX por último.**

---

## 0. Contexto de arquitetura (leitura obrigatória antes de "consertar" achados)

O ERP Flow **não usa Supabase Auth como identidade principal**. O login real
acontece contra o SAP B1 (Service Layer / HanaAPI) e a sessão SAP fica em
`localStorage`. Como consequência:

1. Todas as leituras do PostgREST feitas pela SPA saem com a **chave anon**.
2. Muitas políticas RLS `USING(true)` para `anon` são **intencionais** —
   protegem-se via edge functions + validação SAP, não via `auth.uid()`.
3. Vários `SECURITY DEFINER` são **anon-callable de propósito** (ex.: `has_role`,
   `permissions_enforcement_mode`, `get_my_idp_cost_center`).
4. O arquivo `src/test/rls-permissions.integration.test.ts` documenta e
   protege esse contrato — qualquer mudança de RLS **precisa** manter esse
   teste verde ou substituí-lo.

Isso muda o que é achado do linter que é **real gap** vs **falso positivo por design**.
O plano abaixo separa os dois.

---

## 1. Diagnóstico consolidado (dados concretos)

### 1.1 Linter Supabase — 140 issues

| Categoria | Qtd | Nível | Ação |
|---|---:|---|---|
| Function Search Path Mutable | **5** | WARN | **Fix mecânico** (Fase S1) |
| Extension in Public (`pg_trgm`) | 1 | WARN | Aceitar (mover extensão quebra índices trgm existentes) |
| RLS Policy Always True | **37** | WARN | Triagem por tabela (Fase S2) |
| Public (anon) can EXECUTE SECURITY DEFINER | **89** | WARN | Triagem por função (Fase S3) |
| Authenticated can EXECUTE SECURITY DEFINER | 7 | WARN | Revisar EXECUTE de `authenticated` (Fase S3) |
| RLS Enabled No Policy | 1 | INFO | Adicionar policy ou remover RLS (Fase S2) |

**Funções `public` sem `search_path`:**
`_audit_guard`, `delete_email`, `enqueue_email`, `move_to_dlq`, `read_email_batch`.
(as demais 30 funções sem search_path são do `pg_trgm` — ignoradas.)

**Tabelas com policy `USING(true)`/`WITH CHECK(true)` para anon em INSERT/UPDATE/DELETE:**
`approval_rules`, `approval_rule_levels`, `sap_cache`.
(Nas demais — `pagcorp_*`, `suppliers`, `user_profiles`, `sap_fluxo_analise_*`,
`expense_action_idempotency`, `pagcorp_settlement_accounts` — o alvo é
`authenticated`, `App`, ou `service_role`; ainda merecem estreitamento,
mas não expõem via anon.)

### 1.2 Edge functions — 84 no total

- **21** com `verify_jwt = false` em `supabase/config.toml` (declarado).
- **63** restantes: assumem `verify_jwt = true` **ou** validam por outros meios
  (`x-sap-session`, HMAC, cron, secret compartilhado). Nenhuma usa `getClaims`.
- **Padrão dominante** hoje: `requireAdminOrSapSessionHeaders` / `requireAdmin`
  em `_shared/auth.ts`. Isso funciona mas não segue o guideline oficial
  Supabase pós-signing-keys. **Não é regressão de segurança** — é dívida.

### 1.3 Achados fora do linter (histórico + code review)

- **HIBP / password strength** — nunca ativado no Auth (fluxo principal é SAP,
  mas o admin panel usa Supabase Auth).
- **MFA** — não obrigatório para admins do Backoffice.
- **`localStorage` guarda sessão SAP** com credenciais criptografadas no cliente.
  Vetor de XSS ainda que baixo (CSP não está declarado no `index.html`).
- **CSP / HSTS / X-Frame-Options** — ausentes no `index.html`.
- **Rate limiting** — nenhum em `sap-change-password`, `expense-*`, `copilot-chat`.
- **Source maps** — ativos no build de preview (verificar prod).
- **Segredos em Edge Functions** — OK (`SUPABASE_SERVICE_ROLE_KEY` só server).
- **`external_api_allowlist`** — tem RLS estrita, mas endpoint público (`external-approvals-api`) precisa auditoria da assinatura.

---

## 2. Roadmap por fase

Cada fase entrega valor sozinha e é reversível. Nada bloqueia deploy.

### FASE S1 — Fixes mecânicos (baixíssimo risco) — **INICIAR AGORA**

Objetivo: eliminar warnings triviais e liberar o painel de segurança.

- [x] **S1.1** Migração: `SET search_path = public, pg_temp` nas 5 funções
      próprias do projeto (`_audit_guard`, `delete_email`, `enqueue_email`,
      `move_to_dlq`, `read_email_batch`). *— aplicado nesta rodada.*
- [x] **S1.2** HIBP + política de senha forte ativados no Supabase Auth
      (`password_hibp_enabled=true`).
- [x] **S1.3** Headers de segurança no `index.html`
      (`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`).
      HSTS/X-Frame-Options ficam a cargo do hosting (Lovable já força HTTPS).
- [x] **S1.4** `build.sourcemap` desativado em produção no `vite.config.ts`.

### FASE S2 — RLS: fechar escritas anônimas legítimas de admin

**Status: parcialmente concluída — linter 140 → 99 issues.**

| Tabela | Status | Nota |
|---|---|---|
| `approval_rules`, `approval_rule_levels` | ✅ S2.1 | Escrita só admin/service_role |
| `suppliers`, `user_profiles` | ✅ S2.2 | Escrita só admin/service_role |
| `sap_cache` | ✅ S2.2 | INSERT/UPDATE só service_role; DELETE anon mantido (cache invalidation) |
| `pagcorp_settlement_accounts`, `pagcorp_supplier_links`, `pagcorp_card_mapping`, `pagcorp_cards`, `pagcorp_nondeductible_expenses`, `pagcorp_integration_log` | ✅ S2.2 | Escrita só admin/service_role |
| `sap_fluxo_analise_*` (`service_role`) | ⚠️ pendente | Aceitar — só edge functions escrevem |
| `expense_action_idempotency` (`service_role only`) | ⚠️ pendente | Aceitar |
| Remanescentes `USING(true)` para `authenticated` | ⚠️ triagem | Ver linter |

Cada fix acompanha:
- Migração com `DROP POLICY` + `CREATE POLICY` escopada.
- Atualização do teste `rls-permissions.integration.test.ts`.
- Verificação em staging antes de prod.

### FASE S3 — SECURITY DEFINER: revogar EXECUTE onde não é necessário

96 funções (89 anon + 7 auth). Estratégia:

1. Listar cada função e classificar em 3 baldes:
   - **PÚBLICA por design** (`has_role`, `permissions_enforcement_mode`,
     `get_my_idp_cost_center`, `has_module_action`, `log_permission_shadow`)
     → aceitar, documentar em `security-memory`.
   - **Uso interno de edge function** → `REVOKE EXECUTE FROM anon, authenticated;
     GRANT EXECUTE TO service_role;`
   - **Convertível a SECURITY INVOKER** → converter.

Entregável: uma migração com blocos `REVOKE`/`GRANT` por função.

Linter: **99 → 73 warnings**.

**S3.2 aplicado (24/07/2026)** — 12 funções internas + `verify_audit_chain`:
triggers (`sync_user_license_across_companies`, `notifications_skip_test_companies`,
`sync_collab_phone_to_companies`, `set_baixa_criado_por`), helpers de edge
(`register_external_api_success/failure`, `check_external_api_access`,
`try_watcher_lock`, `release_watcher_lock`, `prune_old_integration_data`,
`_run_pagcorp_attachment_backfill`, `create_item_variante`).
`verify_audit_chain` restrito a `authenticated + service_role`.
Linter: **73 → 50 warnings**.

**S3.3 aplicado (24/07/2026)** — última rodada: `preview_next_codigo` e
`purge_expense_action_idempotency` → só `service_role`; `can_access_audit_console`
e `can_manage_employee_integration` → `authenticated + service_role`.
Linter: **50 → 44 warnings**.

**Fase S3 concluída.** As ~19 funções `SECURITY DEFINER` ainda anon-executáveis
são **públicas por design** (a SPA usa chave anon; validam autorização
internamente). Documentadas em `security-memory` para o scanner não reabrir.



### FASE S4 — Autenticação e admin panel

- [ ] MFA obrigatório para role `admin` (usar Supabase Auth MFA nativo).
- [ ] Bloqueio de brute force no login SAP (rate limit + captcha após 3 falhas).
- [x] **S4.3 (24/07/2026)** — Revisão do fluxo Google OAuth (empresas OMIE). Criada
      RPC `is_email_allowed_for_omie_company` (SECURITY DEFINER, EXECUTE só para
      `authenticated`/`service_role`). Cliente parou de ler `user_group_assignments`
      inteira só para checar allowlist. `omie-proxy` action=login agora exige
      `requireUser()` + revalida allowlist server-side (403 se não autorizado) —
      antes a proteção existia só no cliente e podia ser burlada.
- [ ] Remover sessão SAP do `localStorage` em favor de cookie `HttpOnly` gerado por
      edge function (backlog longo — projeto separado; não bloqueia S1–S3).

### FASE S5 — Edge functions: padronizar auth + rate limit

- [x] **S5.1 (24/07/2026)** — Helper `_shared/rate-limit.ts` + tabela
      `edge_rate_limits` + RPC atômica `check_and_increment_rate_limit`
      (service_role only, `SET search_path`). Falha silenciosa: se o DB
      recusar, libera a chamada — o objetivo é conter abuso, não introduzir
      novo ponto de falha.
- [x] **S5.2 (24/07/2026)** — Rate limit aplicado nos endpoints de risco:
      • `sap-change-password`: 5/5min por usuário/IP.
      • `expense-approval-action`: 12/60s por (expense × IP).
      • `copilot-chat`: 20/60s por admin.
      • `external-approvals-api`: 30/60s por (company_db × user_code × IP).
- [x] **S5.3 (24/07/2026)** — Rate limit adicionado nos endpoints de IA/consulta:
      • `report-ai-chat`: 20/60s por IP.
      • `cnpj-lookup`: 30/60s por IP.
      • `supplier-ai-extract`: 15/60s por IP.
- [ ] Migrar 63 funções sem `getClaims` para o padrão oficial **quando** exigirem
      identidade de usuário Supabase (não SAP). A maioria continua legítima com
      `requireAdminOrSapSessionHeaders`.
- [ ] Validar assinatura HMAC no webhook `external-approvals-api`.

### FASE B1 — Backend / integrações (dívida técnica de médio prazo)

- [x] **B1.1 (24/07/2026)** — Consolidados 4 watchers de cache SAP
      (`sap-po-cache-sync`, `sap-nf-entrada-sync`, `sap-vendor-payment-cache-sync`,
      `sap-fluxo-analise-sync`) sob `supabase/functions/_shared/sap-cache.ts`:
      helpers únicos de `buildSapBaseUrl` / `sapCookieLogin` / `sapSessionLogin` /
      `sapLogout` / `loadSapCreds` / `toIsoTimestamp`, runner `runSapCacheWatcher`
      (lock + parse + iteração por company_db + time budget) e pager OData
      incremental `runIncrementalPager` (cursor UpdateDate + DocEntry, upsert +
      state). Reduziu ~1000 → ~380 linhas de código específico.
- [x] **B1.2 (24/07/2026)** — Dashboard de retries com métricas agregadas:
      taxa de sucesso, recuperados vs esgotados, média de tentativas,
      falhas por categoria e recuperação por doc_type — janelas 1h/24h/7d/30d.
- [x] **B1.3 (24/07/2026)** — `expense-sap-status-sync` agora resolve o status
      do PO via `sap_purchase_order_cache` (freshness ≤ 3h) antes de bater no
      Service Layer. Reduz drasticamente logins SAP quando o watcher de cache
      está em dia; SL vira fallback apenas para DocEntry ausentes/velhos.
- [x] **B1.4 (24/07/2026)** — Auditoria de `sap-b1-proxy` para roteamento HANA V2.
      Inventário das 4 actions de leitura:
      • `queryView` — **já roteado 100% via HANA V2** (`fetchHanaView`) com toggle
        `use_hana_db` por empresa e fallback vazio (não SL) por design.
      • `query` — leituras pontuais por ID (`ApprovalTemplates(x)`, `ApprovalStages(y)`,
        `Users?$filter=UserCode eq 'X'&$select=Superuser`, `Departments(cc)` etc.).
        HANA views atuais (VW_USERS, VW_FORNECEDORES, VW_ACOMPANHAMENTO_PEDIDOS)
        **não expõem** os campos consultados (Superuser, template metadata),
        então roteamento HANA quebraria contrato do cliente. Mantido no SL.
      • `queryAll` — usado só para paginar `BusinessPartners`, `Items` e
        `ChartOfAccounts` quando o cliente ignora as tabelas de cache
        (`sap_cache`, `suppliers`, `sap_items_cache`). Recomendação registrada:
        migrar callers para as caches (já feito em `useSuppliers`/`useItems`);
        `queryAll` fica como fallback para empresas sem HANA.
      • `sapAction` — writes (POST/PATCH). Não elegível para HANA.
      Conclusão: as leituras HANA-eligíveis **já estão migradas** (via `queryView`
      ou watchers de cache). SL segue como fallback correto para o restante.

### FASE O1 — Observabilidade

- [ ] Ativar `analytics--read_project_analytics` como fonte no Backoffice.
- [x] **O1.2 (24/07/2026)** — Dashboard "Latência de Edge Functions" com p50/p95/p99,
      taxa de erro e contagem por função em janelas 1h/24h/7d. Infra:
      tabela `edge_function_metrics` (RLS admin-only, service_role write),
      RPC `get_edge_function_metrics(_hours)`, prune de 14 dias e helper
      `_shared/edge-metrics.ts` (`withEdgeMetrics` — fire-and-forget, nunca
      derruba o request). Instrumentadas 8 funções críticas: `sap-b1-proxy`,
      `expense-approval-action`, `expense-to-sap`, `sap-approvals-hana`,
      `baixa-recebimento`, `sap-users-admin`, `sap-change-password`,
      `copilot-chat`. Card exposto em `/backoffice/sap-sync-runs`.
- [x] **O1.3 (24/07/2026)** — Alertas WhatsApp automáticos via
      `edge-metrics-alerts` (cron `*/5min`). Dispara quando, na janela
      de 5min com ≥10 execuções, `p95 > 10s` ou `error_rate > 5%`.
      Dedup por `(function_name, kind, window_bucket)` na tabela
      `edge_metrics_alerts`. Telefones em `EDGE_METRICS_ALERT_PHONES`
      (fallback: Douglas Ferreira). Reusa gateway WhatsApp existente.

### FASE R1 — Refatoração / dívida

- [x] Deduplicar hubs (`AuditHub`, `IntegrationsHub`, `UsersHub`) — extraído
      `src/components/TabsHub.tsx` com layout único (tabs + filtro por módulo +
      roteamento). `ApprovalsHub` mantém lógica própria (sem tabs, apenas
      chaveia via query param).
- [x] Auditoria de rotas em `App.tsx`: nenhuma página órfã encontrada — todas
      as `src/pages/*.tsx` estão referenciadas por `App.tsx` ou por um hub.


### FASE UX — UI/UX (executar por último, conforme solicitado)

- [ ] Unificar tokens de design (`index.css`) — hoje há mix de cores hardcoded
      em `src/pages/*` (rodar `rg "text-\[#|bg-\[#" src/`).
- [ ] Padronizar `PageHeader` em todas as rotas.
- [ ] Revisão de responsividade mobile (Bottom Nav já existe, mas várias
      tabelas ficam sem scroll horizontal).
- [ ] Acessibilidade (foco, contraste, labels de ícone).
- [ ] Empty states e loaders coerentes.

---

## 3. Priorização (Risco × Esforço × Impacto)

```text
    Alto impacto
        │
   S2 ──┼── S1  ← começar aqui
    │   │
   S4   │  S3
    │   │
   S5 ──┼── B1
    │   │
   O1   │  R1
        │
        └────── UX  (por último)
    Baixo esforço →
```

**Sprints sugeridos (2 semanas cada):**
1. **Sprint 1** — S1 completo + início de S2 (approval_rules, sap_cache).
2. **Sprint 2** — S2 restante + S3 triagem completa.
3. **Sprint 3** — S4 (MFA + rate limit login) + S5 rate limit.
4. **Sprint 4** — B1 + O1.
5. **Sprint 5** — R1 + início UX.
6. **Sprint 6** — UX.

---

## 4. Checklist de segurança — status atual

| Item | Status | Fase |
|---|---|---|
| RLS habilitado em todas tabelas `public` | ✅ (INFO só 1 tabela sem policy) | — |
| Nenhuma policy `USING(true)` sem escopo | ⚠️ 37 casos | S2 |
| Service_role só em edge functions | ✅ | — |
| Segredos de terceiros fora do front | ✅ | — |
| HIBP / senha forte | ❌ | S1.2 |
| MFA para admin | ❌ | S4 |
| Rate limit em login/reset | ❌ | S4/S5 |
| Rate limit em IA caras | ❌ | S5 |
| Webhook signature validada | ⚠️ auditar | S5 |
| HTTPS + HSTS | ⚠️ HSTS ausente | S1.3 |
| CSP + headers de segurança | ❌ | S1.3 |
| Source maps de prod desativados | ❓ verificar | S1.4 |
| Nenhum segredo em URL | ✅ | — |
| PII sensível criptografada | N/A (não há PII financeira além de CNPJ) | — |
| Input validado no servidor | ✅ (zod nas edge functions críticas) | — |
| Auditoria de decisões | ✅ (`audit_log`, `expense_audit_log`) | — |
| GHAS / CodeQL no repo GitHub | ❓ verificar sync | S4 |

---

## 5. Riscos & mitigações

| Risco | Mitigação |
|---|---|
| Estreitar RLS quebra fluxos anon-legítimos | Rodar `rls-permissions.integration.test.ts` antes/depois; feature flag por tabela |
| Revogar EXECUTE de anon quebra RPCs consumidas pela SPA | Auditar `rg "supabase.rpc\("` antes de cada revoke |
| MFA obrigatório trava admin sem MFA configurado | Rollout: enrollment forçado no 1º login, 30 dias de grace |
| CSP quebra scripts externos (Google, WhatsApp) | Começar em `report-only`, medir, então enforce |

---

## 6. Próximas ações imediatas

1. ✅ **S1.1 aplicado nesta rodada** (migração de `search_path`).
2. **Aguardando decisão** para:
   - S1.2 (HIBP) — 1 chamada de tool, zero código.
   - S1.3 (CSP/HSTS) — edita `index.html` + `_shared` cors.
   - S1.4 (sourcemap) — 1 linha em `vite.config.ts`.
3. Depois S2 (RLS) — precisa validação sua tabela a tabela porque envolve mudança de comportamento.
