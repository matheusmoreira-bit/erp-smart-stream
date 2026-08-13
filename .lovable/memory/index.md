# Project Memory

## Core
- Root-cause first: antes de editar uma função, `rg -n` os callers e corrigir no ponto compartilhado, não no sintoma local da UI.
- Reuse first: antes de criar helper/componente/hook, procurar similar existente em `src/hooks/`, `src/components/ui/`, `src/lib/`, `supabase/functions/`.
- Trace-before-fix: em bug de "valor não chega em X", mapear origem→sink (página → hook → edge function → modal) antes de editar qualquer arquivo.
- Documentos de compra/venda: usuário vê só o que criou/aprova. Toggle "Ver todos"/"Ver todas as aprovações" começa DESMARCADO por padrão para todos, inclusive admins/super-usuários — quem tem permissão liga manualmente.
- Segregação de função só via CAPACIDADE do grupo (permission_group_modules) — nunca por nome de grupo nem flag no usuário.
- Auto-aprovação: solicitante nunca aprova o próprio documento — nível dele é escalado e botões ficam ocultos (inclusive admin).
- Identidade = usuário SAP (1 nome, N e-mails). Permissões/alçadas gravam a chave canônica (`canonicalUserKey`), nunca e-mail cru.

## Memories
- [Auto-aprovação](mem://features/auto-aprovacao.md) — Regra de escalonamento quando o solicitante também é aprovador.
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
- [Baixa PagCorp moeda do documento](mem://features/pagcorp-baixa-moeda-documento.md) — DocTotal/PaidToDate são BRL e DocTotalFC/PaidToDateFC são USD; baixa sempre na moeda do documento (evita dupla conversão pela PTAX).
- [Variação cambial nas baixas PagCorp](mem://features/pagcorp-baixa-variacao-cambial.md) — Diferença até 3% (máx. R$ 250) em moeda estrangeira é variação cambial e nunca é cancelada.
- [Baixa PagCorp USD/PTAX](mem://features/pagcorp-baixa-usd-ptax-data.md) — USD usa conta própria, PTAX BCB da data da compra e pagamento lançado nessa mesma data; modo reset_cancelled no repair.
- [Baixas PagCorp manuais](mem://features/pagcorp-baixa-manual.md) — Baixa automática de cartão desativada; watcher notifica blenda.pinheiro.ext e a baixa é lançada em /cartoes/baixas com contas "PagCorp".
- [Segmentos de gestão](mem://features/management-segments.md) — ANA Gaming / Lótus / CSC por usuário; CSC vê todos os projetos nas bases ANA Gaming.
- [Governança de notificações](mem://features/notification-governance.md) — Regras globais/por empresa de envio (bases de teste, autoaprovação, destinatários) em /notificacoes/regras.
- [Cadeia de aprovação em rateio](mem://features/rateio-approval-chain.md) — Segmento = CC + projeto; cadeias mescladas quando o doc é rateado entre alçadas diferentes.
- [Grupos de permissão consolidados](mem://features/permission-groups-simplified.md) — Estrutura oficial de 8 grupos globais; não recriar CFO/Contas a Pagar/PagCorp/Contábil nem grupos por empresa.
- [Critério Tipo de Rateio](mem://features/criterio-tipo-rateio.md) — rateio_type como critério das regras de aprovação; regra Folha do Instituto (Ketlhenn, prioridade 999).
- [Aprovador de contingência da matriz](mem://features/approval-matrix-fallback-approver.md) — Fallback global = Matheus Moreira; regras 1.80/1.81/1.90/1.91 na Cactus (Juliana até 300k, +Marco Tulio acima).
- [NF de Entrada por empresa](mem://features/nf-entrada-segregacao-empresa.md) — Notas do Master Tax filtradas por base SAP ativa + CNPJ do tomador; status derivado do fluxo.
- [Regra de reembolso é paralela](mem://features/reembolso-regra-paralela.md) — Reembolso soma uma trilha extra à alçada padrão, em vez de substituí-la.
