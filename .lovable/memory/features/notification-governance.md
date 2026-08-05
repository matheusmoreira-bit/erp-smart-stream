---
name: Governança de notificações
description: Tela /notificacoes/regras com regras globais e por empresa (excluir bases de teste, bloquear autoaprovação, destinatários extras/bloqueados) e status em tempo real
type: feature
---

Tabela `notification_governance` (linha global com `company_db = null` + overrides por empresa):
`exclude_test_companies`, `block_self_approval`, `notify_requester`, `extra_recipients[]`, `blocked_recipients[]`, `enabled`.

- Editada em `/notificacoes/regras` (somente admins; leitura liberada).
- Aplicada em `overdue-reminders-dispatch`: override por empresa vence a regra global; destinatários bloqueados geram log `skipped_blocked`; extras entram como papel `watcher`.
- Status em tempo real vem de `notification_send_runs` (realtime habilitado).
