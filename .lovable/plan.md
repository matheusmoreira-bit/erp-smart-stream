
# Plano — Relatório Técnico Executivo do ERP Flow

Vou produzir um único arquivo markdown versionado em `docs/relatorio-tecnico.md` (15–25 páginas), com tom para equipe técnica / auditoria de TI, cobrindo capacidades funcionais, arquitetura, integrações, automações, dependências e postura de segurança (incluindo achados atuais do scanner, checklist secure-by-default e recomendações de hardening).

## Fase 1 — Exploração (read-only)

Antes de escrever, faço um levantamento sistemático para não deixar módulo de fora:

1. **Inventário funcional** — mapear todas as rotas em `src/App.tsx` e páginas em `src/pages/*` (Approvals, ApprovalHistory, Expenses, AdvancePayments, NfEntrada, PagCorp, FiscalAudit, AuditConsole, Suppliers, Items, Users/UsersHub, IdpSync, Analytics, Sales, Intercompany, LicenseAnalysis, Synapse, IntegrationsHub, SapUsersAdmin, Credentials, Notifications, etc.).
2. **Hooks e domínios** — ler `src/hooks/*` e `src/lib/*` para agrupar cada página nos domínios de negócio: Aprovações, Despesas, NF-e Entrada, PagCorp (cartão corporativo), Auditoria Fiscal/Console, SAP Sync, Fornecedores/Itens, Licenças, Notificações (email/WhatsApp), Synapse (agentes/IA).
3. **Integrações externas** — listar via `.lovable/memory/features/*` e `src/lib/{sap-client,omie-client,invoke-fn,notifications}.ts`: SAP Business One Service Layer, Omie, PagCorp, Google Drive (connector), SMTP, Lovable AI Gateway, Convex (VITE_CONVEX_*), IDP/SSO. Documentar segregação por base (`integration-base-segregation`) e o modo "OMIE open modules".
4. **Backend Lovable Cloud (Supabase)**:
   - Listar as ~90 tabelas do schema `public` já visíveis no contexto, agrupadas por domínio, com contagem de policies RLS.
   - Documentar as funções `SECURITY DEFINER` presentes (has_role, audit_trigger, verify_audit_chain, email_queue_dispatch/wake, reassign_approval_rule_safe, can_access_audit_console, register_external_api_*, try_watcher_lock, get_sap_sync_health, etc.).
   - Descrever a trilha de auditoria hash-encadeada (`audit_trail` + `audit_trail_archive` + `verify_audit_chain`).
   - Descrever a fila de e-mails (pgmq + cron `process-email-queue` + `email_send_state`).
   - Mapear os 3 buckets de storage (`expense-attachments`, `nf-entrada-files`, `audit-console-docs`) e suas policies.
5. **Edge Functions** — `code--list_dir supabase/functions/` para listar cada função, agrupar por propósito (SAP proxy, PagCorp, Omie, notificação, workers da fila, auditoria) e apontar segredos consumidos.
6. **Automações / Cron** — extrair jobs `cron.*` referenciados no código e nos memos (`process-email-queue`, `expense-sap-status-sync`, watchers, prune, reminders overdue, sync PO/NF/Vendor Payment).
7. **Dependências** — ler `package.json`, executar mentalmente o inventário (React 18, Vite 5, Tailwind, Radix, React Query, jsPDF, recharts, react-router-dom 7, framer-motion, xyflow, pptxgenjs) + rodar `code--dependency_scan` para incluir estado atual de vulnerabilidades.
8. **Segurança** — consolidar:
   - Os 3 warnings ativos do scanner (audit-console-docs sem policy de leitura para não-admin; expense-attachments sem policies listadas; nf-entrada-files legível por qualquer autenticado sem checagem de posse).
   - Rodar `supabase--linter` para complementar.
   - Checklist da skill `revisao-seguranca-lovable` aplicado item a item.
   - Segredos configurados (lista de nomes já disponível, sem valores).
   - Regras de visibilidade de documentos e OMIE open modules já memorizadas.
9. **Config & Ops** — `index.html` (SEO/meta), `vite.config.ts`, `playwright.config.ts`, `vitest.config.ts`, `supabase/config.toml`, ESLint, testes existentes (`src/lib/*.test.ts`, `useApprovalRules.test.ts`), `docs/external-approvals-api.md`.

Uso `acp_subagent--explore` em paralelo para acelerar (um agente para hooks/páginas, outro para edge functions + cron, outro para dependências/segurança), consolidando os retornos.

## Fase 2 — Estrutura do documento

```text
docs/relatorio-tecnico.md
├── 1. Sumário executivo
├── 2. Visão de produto e escopo funcional
├── 3. Arquitetura técnica
│   ├── 3.1 Stack e camadas (front, Lovable Cloud, Edge, integrações)
│   ├── 3.2 Diagrama de contexto (ASCII)
│   └── 3.3 Fluxos de dados críticos (aprovação, NF entrada, PagCorp, auditoria)
├── 4. Módulos funcionais (por domínio)
│   ├── Aprovações & Regras & Substitutos & Delegação
│   ├── Despesas, Adiantamentos, Anexos
│   ├── NF de Entrada (import + vínculo ERP + pedido de compras)
│   ├── PagCorp (cartão corporativo, mapeamentos, não-dedutíveis)
│   ├── Auditoria Fiscal e Audit Console (runs, divergências, insights)
│   ├── Fornecedores, Itens, Intercompany
│   ├── Usuários, Permissões, Grupos, IDP/SSO, Licenças
│   ├── Analytics, Insights, Produtividade
│   ├── Notificações (email, WhatsApp, overdue reminders)
│   └── Synapse (agentes/IA), AI Chat Global
├── 5. Integrações externas
│   ├── SAP B1 Service Layer (multi-empresa, multi-senha, health)
│   ├── Omie (regra "open modules" temporária)
│   ├── PagCorp (HMAC, AES, credenciais)
│   ├── Google Drive (connector)
│   ├── SMTP e templates transacionais
│   ├── Lovable AI Gateway
│   └── Convex (uso e status)
├── 6. Automações e jobs agendados
│   ├── Cron jobs (email queue, SAP sync, prunes, reminders)
│   ├── Watchers (try_watcher_lock/release)
│   ├── Filas pgmq (auth_emails, transactional_emails, DLQ)
│   └── Triggers (audit_trigger, updated_at, cascade delete, notifications skip test)
├── 7. Modelo de dados
│   ├── Tabelas por domínio (com contagem de policies)
│   ├── Trilha de auditoria hash-encadeada
│   ├── Idempotência (expense_action_idempotency)
│   └── Cache SAP e sync state
├── 8. Segurança
│   ├── 8.1 Modelo de autorização (RLS + has_role + user_roles + user_group_assignments)
│   ├── 8.2 Buckets de storage e políticas
│   ├── 8.3 Segredos (inventário sem valores)
│   ├── 8.4 Achados atuais do scanner (3 warnings) + linter
│   ├── 8.5 Checklist secure-by-default (item a item, OK / Corrigir / Não verificado)
│   ├── 8.6 Classes de vulnerabilidade avaliadas (fonte→sink)
│   └── 8.7 Postura de auditoria (audit_trail append-only + verify_audit_chain)
├── 9. Backups, DR e retenção
│   ├── Backups do Lovable Cloud (Supabase managed)
│   ├── Retenção: integration_log 90d, whatsapp_* 60d, audit_trail_archive
│   ├── Idempotência e purge de reservations
│   └── Recomendação de estratégia de restore
├── 10. Testes, qualidade e observabilidade
│   ├── Vitest, Playwright, ESLint, tsgo
│   ├── audit_log / audit_trail / expense_sap_sync_runs
│   └── Health checks (get_sap_sync_health, email_send_state)
├── 11. Dependências e supply chain
│   ├── Inventário resumido do package.json
│   ├── Resultado do dependency_scan (jspdf/dompurify, recharts, react-router-dom, etc. — estado atual)
│   └── Overrides aplicados (dompurify pin)
├── 12. Riscos e recomendações de hardening
│   ├── Curto prazo (fix dos 3 warnings de storage, HIBP, brute force)
│   ├── Médio prazo (SSO/MFA, CSP, rate limiting em edge functions)
│   └── Longo prazo (GHAS/CodeQL, secret scanning, chaos/DR drill)
├── 13. Roadmap sugerido e itens em aberto
└── Apêndices
    ├── A. Lista completa de rotas
    ├── B. Lista completa de edge functions
    ├── C. Tabelas por domínio com policies
    ├── D. Segredos configurados (só nomes)
    └── E. Glossário
```

## Fase 3 — Verificação antes de entregar

- Reler o documento e checar cobertura dos itens pedidos (funcionalidades, módulos, integrações, automações, ferramentas, controles, backups, arquitetura, dependências, segurança).
- Rodar `code--dependency_scan` uma vez para congelar o snapshot da seção 11 na data do relatório.
- Rodar `supabase--linter` para incorporar achados atuais na seção 8.4.
- Confirmar que nenhuma URL/ID do Supabase e nenhuma chave sensível aparecem no documento.
- Marcar explicitamente itens em "Não verificado" quando não conseguir confirmar (ex.: HIBP ativo, brute-force lockout) para não afirmar cobertura que não existe.

## Entregável

- `docs/relatorio-tecnico.md` — documento único, ~20 páginas, versionado no repositório.
- Nenhuma outra alteração de código, schema ou configuração.

Se preferir também um PDF, gero em um segundo passo depois que aprovar o conteúdo.
