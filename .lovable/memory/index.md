# Project Memory

## Core
- Root-cause first: antes de editar uma função, `rg -n` os callers e corrigir no ponto compartilhado, não no sintoma local da UI.
- Reuse first: antes de criar helper/componente/hook, procurar similar existente em `src/hooks/`, `src/components/ui/`, `src/lib/`, `supabase/functions/`.
- Trace-before-fix: em bug de "valor não chega em X", mapear origem→sink (página → hook → edge function → modal) antes de editar qualquer arquivo.
- Documentos de compra/venda: usuário vê só o que criou/aprova. Toggle "Ver todos"/"Ver todas as aprovações" começa DESMARCADO por padrão para todos, inclusive admins/super-usuários — quem tem permissão liga manualmente.
- Segregação de função só via CAPACIDADE do grupo (permission_group_modules) — nunca por nome de grupo nem flag no usuário.
- Identidade = usuário SAP (1 nome, N e-mails). Permissões/alçadas gravam a chave canônica (`canonicalUserKey`), nunca e-mail cru.

## Memories
- [Debug discipline](skill://lovable-debug-discipline) — Checklist root-cause / reuse / trace-before-fix para evitar loops de fix em sintoma.
- [Users screen actions](mem://preferences/users-screen-actions.md) — Keep the Users screen action buttons minimal and icon-based instead of large filled buttons.
- [OMIE open modules](mem://features/omie-open-modules.md) — Temporary rule: OMIE companies must keep all modules unlocked for all users, without permission-level control.
- [WhatsApp notifications](mem://features/whatsapp-notifications.md) — Cron-based WhatsApp pipes (login failures, pending approvals) with per-user phone book imported from SAP MobilePhone or manual.
- [Integration base segregation](mem://features/integration-base-segregation.md) — Toda integração persiste e filtra por company_db do contexto SAP ativo, sem vazar entre bases.
- [Sales module access](mem://features/sales-module-access.md) — Módulo Vendas restrito ao grupo Contas a Receber; fora dos DEFAULT_MODULES; guardas em Sales.tsx e BaixasHistory.tsx.
- [Exibir usuários pelo nome](mem://preferences/user-display-name.md) — Nas telas, sempre Nome via `displayUserName` (src/lib/user-display.ts), nunca e-mail/login.
- [Delegação de alçada](mem://features/approver-substitutes.md) — Substituto com vigência, autoatendimento de férias, audit log e notificações via approver-substitute-manage.
- [Identidade única de usuário](mem://features/user-identity.md) — Usuário SAP como chave (1 nome, N e-mails), tabelas sap_user_directory/sap_user_emails e chave canônica em permissões.
- [Grupos e capacidades](mem://features/permission-groups-capabilities.md) — Catálogo de capacidades GRUPO > USER, hooks useMyCapabilities e helpers server-side.
- [Baixa PagCorp valor exato](mem://features/pagcorp-baixa-valor-exato.md) — Baixa automática do PagCorp = fatia do PC na conta a pagar; reparo via pagcorp-settlement-repair.
- [Variação cambial nas baixas PagCorp](mem://features/pagcorp-baixa-variacao-cambial.md) — Diferença até 3% (máx. R$ 250) em moeda estrangeira é variação cambial e nunca é cancelada.
