## Objetivo

Embarcar o Silent Specter (plataforma de auditoria com IA sobre dados SAP) como uma seção dentro do módulo Analytics deste projeto, **criando todas as tabelas aqui** (Lovable Cloud do ERP Flow).

## Tamanho real do trabalho

O Silent Specter tem:
- ~30+ tabelas (`companies`, `audit_runs`, `audit_divergences`, `accounts_payable`, `approval_requests`, `approval_request_decisions`, `approval_templates`, `chat_messages`, `vendors`, `documents`, `divergence_rules`, `workflow_*`, `auth_failure_logs`, `allowed_emails`, etc.)
- 14 rotas (dashboard, audit, audit-queue, audit-report, divergences, document-analysis, documents, vendors, approvals, companies, logs, settings, users)
- Backend pesado: `runner.server.ts` (executa auditorias), `divergence-rules.server.ts`, integrações SAP, IA insights, chat
- Roteador diferente (TanStack Router vs. nosso React Router)
- Schema parcialmente conflitante: já temos `companies`, `suppliers`, `approval_history`, etc. — alguns campos diferem

**Não cabe em uma única migração nem em uma única resposta.** Vou propor um faseamento em quatro entregas, cada uma fechada e funcional.

## Conflitos de schema (precisam decisão antes do Fase 1)

| Tabela Silent Specter | Tabela já existente aqui | Decisão sugerida |
|---|---|---|
| `companies` (id uuid, name, sap_db, sap_url…) | `companies` (company_db PK, display_name, base_url…) | **Reusar a nossa**, mapear `company_id` ⇒ `company_db` |
| `vendors` (sap-style) | `suppliers` | **Reusar `suppliers`**, audit aponta via `card_code` |
| `approval_requests`/`_decisions`/`_templates` | `approval_history`/`approval_rules` | **Manter separado** (origem distinta: snapshot SAP × hub n8n) sob prefixo `audit_*` |
| `chat_messages` | `ai_chat_messages`/`ai_chat_threads` | **Reusar os nossos** |
| `allowed_emails`, `auth_failure_logs` | `user_roles` + auth nativa | **Descartar** — usaremos nosso RBAC |
| `documents`, `accounts_payable`, `audit_*`, `divergence_rules`, `workflow_*`, `insights_*` | — | **Criar com prefixo `audit_`** |

## Fases

### Fase 1 — Fundação (schema + navegação)
- Migration criando tabelas exclusivas do Silent Specter com prefixo `audit_`, RLS escopado por `company_db` + role, e GRANTs:
  `audit_runs`, `audit_divergences`, `audit_divergence_rules`, `audit_documents`, `audit_accounts_payable`, `audit_approval_requests`, `audit_approval_decisions`, `audit_approval_templates`, `audit_workflow_steps`, `audit_workflow_runs`, `audit_insights`, `audit_logs`
- Sub-rota `/analytics/audit` com sidebar interno (Dashboard, Audit Queue, Divergências, Documentos, Insights, Logs)
- Item de menu já existente "Auditoria Fiscal" passa a apontar para essa estrutura (ou criamos novo `audit_console`)
- Estilo "glass card / ambient bg / display font" portado para os tokens semânticos do projeto (sem quebrar o tema atual)

### Fase 2 — Telas read-only
- Dashboard executivo (KPIs + gráficos + AI insights card)
- Audit Queue (lista de runs)
- Audit Report (`/runId`) com divergências
- Página de divergências global com filtros
- Hooks: `useAuditRuns`, `useAuditDivergences`, `useAuditInsights`

### Fase 3 — Motor de auditoria
- Edge function `audit-run` (porte do `runner.server.ts` + `divergence-rules.server.ts`) — dispara comparações SAP × dados internos
- Edge function `audit-insights` (porte do `insights.functions.ts`) usando Lovable AI Gateway (não OpenAI direto)
- Botão "Nova auditoria" + acompanhamento de progresso (`use-sync-progress` equivalente)
- Tabela `audit_workflow_runs` recebe execuções

### Fase 4 — Análise documental + chat
- Página `document-analysis` + `documents` (upload + extração + confronto)
- Floating chat / command palette portados, conectados ao nosso `ai_chat_*`
- Workflow dialog + confront drawer
- Limpeza: remover qualquer resíduo TanStack Router, padronizar com React Router v6

## Detalhes técnicos

- **Roteamento**: tudo entra como sub-rotas do Analytics (`/analytics/audit/*`), usando React Router. Convertemos `createFileRoute(...)` em componentes normais.
- **Auth**: usamos `useSap` + `useModuleAccess("audit_console")`. Sem `allowed_emails` paralelo.
- **Segredos**: chaves de IA continuam em `LOVABLE_API_KEY`. Nenhum segredo do Silent Specter vai ao bundle.
- **RLS**: toda tabela `audit_*` com policy `company_db = current setting` + `has_role(...)` para admin, escrita só por edge function (service role).
- **Storage**: bucket novo `audit-documents` (privado) para uploads de NF/contratos analisados.
- **Tipos**: `src/integrations/supabase/types.ts` é auto-gerado — não tocamos.

## Fora de escopo desta fusão

- Migração de **dados** existentes do Silent Specter (só schema + UI). Se quiser trazer dados, fazemos export CSV depois.
- Sincronizar `auth.users` entre os dois projetos.
- Manter o Silent Specter rodando em paralelo (assumimos que ele será aposentado).

## Próximo passo

Se aprovar este plano, começo pela **Fase 1** (migration + navegação) na próxima mensagem.
