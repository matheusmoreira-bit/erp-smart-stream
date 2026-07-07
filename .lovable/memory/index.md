# Project Memory

## Core
- Root-cause first: antes de editar uma função, `rg -n` os callers e corrigir no ponto compartilhado, não no sintoma local da UI.
- Reuse first: antes de criar helper/componente/hook, procurar similar existente em `src/hooks/`, `src/components/ui/`, `src/lib/`, `supabase/functions/`.
- Trace-before-fix: em bug de "valor não chega em X", mapear origem→sink (página → hook → edge function → modal) antes de editar qualquer arquivo.
- Documentos de compra/venda: usuário vê só o que criou/aprova. Toggle "Ver todos"/"Ver todas as aprovações" começa DESMARCADO por padrão para todos, inclusive admins/super-usuários — quem tem permissão liga manualmente.

## Memories
- [Debug discipline](skill://lovable-debug-discipline) — Checklist root-cause / reuse / trace-before-fix para evitar loops de fix em sintoma.
- [Users screen actions](mem://preferences/users-screen-actions.md) — Keep the Users screen action buttons minimal and icon-based instead of large filled buttons.
- [OMIE open modules](mem://features/omie-open-modules.md) — Temporary rule: OMIE companies must keep all modules unlocked for all users, without permission-level control.
- [WhatsApp notifications](mem://features/whatsapp-notifications.md) — Cron-based WhatsApp pipes (login failures, pending approvals) with per-user phone book imported from SAP MobilePhone or manual.
- [Integration base segregation](mem://features/integration-base-segregation.md) — Toda integração persiste e filtra por company_db do contexto SAP ativo, sem vazar entre bases.
