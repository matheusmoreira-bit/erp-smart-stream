---
name: Avisos de aprovação por WhatsApp (independente do SAP)
description: Watcher whatsapp-flow-approval-watcher envia digest de aprovações pendentes lidas do próprio ERP Flow, sem depender de HANA
type: feature
---

- Edge Function `whatsapp-flow-approval-watcher` (cron `*/30 * * * *`) lê `expenses.status = 'pendente_aprovacao'` (empresas ativas, exclui `SBO_TESTE_%` e `tst_%`) e envia **uma mensagem consolidada por aprovador**.
- Não depende de HANA/HanaAPI (os watchers antigos `whatsapp-approval-watcher` e `whatsapp-approval-digest` ficam ociosos com `use_hana_db=false`).
- Telefone: `user_phones` (por empresa, depois qualquer empresa) → `user_profiles.phone`. Respeita `user_profiles.notify_whatsapp_approvals = false`.
- `expenses.current_approver` guarda o nome de exibição (pode ser "A / B"); o code é resolvido por comparação de tokens do nome com os `user_code`.
- Dedup 24h em `whatsapp_flow_approval_alerts (company_db, expense_id, approver_code)`.
- Segredos `WHATSAPP_TOKEN` e `WHATSAPP_URL` configurados no backend (antes ausentes — por isso nada era enviado).
- Suporta `{"dry_run": true}` para simular sem enviar.
