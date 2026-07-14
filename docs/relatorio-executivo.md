# Relatório Executivo — ERP Flow

**Projeto:** ERP Flow (Cactus Corporation) · **Domínio:** `erp-flow.cactuscorporation.com`
**Data:** 14/07/2026 · **Público:** direção técnica / auditoria de TI · **Classificação:** interno

## O que é
Plataforma web corporativa que unifica **aprovações, despesas, adiantamentos, NF de entrada, cartões corporativos (PagCorp), auditoria fiscal e integração multi-empresa com SAP Business One e Omie**, sobre Lovable Cloud (Supabase gerenciado).

## Arquitetura em uma linha
React 18 + Vite + TypeScript · Postgres 15 com **RLS em ~90 tabelas** · **~68 Edge Functions** Deno · filas `pgmq` + `pg_cron` · auditoria hash-chain (`audit_trail` + `verify_audit_chain`).

## Módulos entregues
Aprovações multi-nível · Despesas & Adiantamentos · NF de Entrada (XML/PDF → SAP) · PagCorp (HMAC+AES) · Audit Console e Cruzamento Fiscal · Cadastros (fornecedores, itens, intercompany) · Usuários/Permissões/Licenças · Analytics & Insights · Notificações (in-app, e-mail, WhatsApp) · Synapse (agentes) · AI Chat Global · Backoffice SAP.

## Integrações
SAP B1 Service Layer (multi-DB, circuit-breaker) · Omie · PagCorp · Google Drive (backup) · SMTP transacional · WhatsApp gateway · Lovable AI Gateway · JumpCloud (IDP) · CNPJ / Mastertax · API pública de aprovações.

## Automações
`pg_cron` para fila SMTP, sync SAP, watchers WhatsApp, rematch NF, settlement PagCorp, licenças ociosas, retenção. Locks de watcher (`try_watcher_lock`) garantem execução única. Fila `pgmq` com DLQ e supressão.

## Segurança — postura
- RLS habilitada em **todas** as tabelas `public`; nenhuma policy `USING(true)`.
- RBAC via `has_role()` SECURITY DEFINER + grupos globais por `company_db`.
- Auditoria imutável verificável criptograficamente; guard bloqueia UPDATE/DELETE em `audit_trail`.
- Idempotência explícita nas aprovações (`expense_action_idempotency`).
- **Sem vulnerabilidades high/critical** no snapshot atual de dependências (overrides aplicados a `dompurify`, `react-router-dom`, `recharts`).
- Segregação obrigatória por `company_db` (produção × teste).

## Riscos abertos (prioridade)
| # | Prio | Item |
|---|---|---|
| 1 | Alta | Confirmar HIBP, lockout de brute-force e MFA no auth manager antes do go-live. |
| 2 | Média | 3 warnings de storage (`audit-console-docs`, `expense-attachments`, `nf-entrada-files`) — revisar policies fail-closed. |
| 3 | Média | CSP/HSTS dependem do hosting; formalizar cabeçalhos no publish. |
| 4 | Média | Token e URL do gateway WhatsApp hardcoded — mover para segredo. |
| 5 | Baixa | Convex (legado) — decidir aposentadoria. |

## Backups & DR
Backups gerenciados pelo Lovable Cloud + export periódico para Google Drive (`backup-to-gdrive`). Retenção `prune_old_integration_data` (90 d integração, 60 d alertas WhatsApp) e arquivamento `archive_audit_trail`.

## Próximos passos recomendados
1. Fechar os 3 warnings de storage e publicar CSP/HSTS.
2. Formalizar MFA obrigatório para admin + política de senha (≥12, HIBP).
3. Migrar segredos WhatsApp para o cofre e adicionar rate-limit nas Edge Functions públicas.
4. Instrumentar `verify_audit_chain` em job semanal com alerta.

> Detalhamento completo (arquitetura, tabelas, edge functions, cron, dependências, checklist secure-by-default e hardening) no relatório técnico `docs/relatorio-tecnico.md`.
