---
name: WhatsApp notifications
description: WhatsApp alerts for SAP login failures and pending approvals; user phones stored manually or imported from SAP MobilePhone
type: feature
---

## API
- URL: `http://63.177.171.140/sender_wpp` (form-urlencoded `to`, `message`)
- Bearer token: `777a5756-d6b3-4295-a031-e5c210998766` (hardcoded conforme solicitado)

## Pipes ativos
- **whatsapp-login-watcher** (cron `*/15 * * * *`): 2 falhas consecutivas em 6h → fixo `5531972665309`. Dedup: `whatsapp_login_alerts (company_db, user_code, failure_key)`.
- **whatsapp-approval-watcher** (cron `*/10 * * * *`): aprovações pendentes do SAP via `VW_APROVACOES_DETALHADAS` → telefone do aprovador. Dedup: `whatsapp_approval_alerts` por `(company_db, approval_request_id)` re-lembrando a cada 24h.

## Telefone do usuário
- Tabela `user_phones (company_db, user_code, phone, source)` única em `(company_db, user_code)`.
- Origem: `manual` (digitado na UI) ou `sap` (importado de OUSR.MobilePhone via `Users?$select=MobilePhone` no Service Layer).
- UI: ícone `Phone` em cada linha de `Users.tsx` abre `EditPhoneDialog` com botão "Importar do SAP".
- Watcher de aprovação prioriza `user_phones` manual; cai no MobilePhone do SAP se não houver.
- `normalizePhone()` prefixa `55` se vier com 10/11 dígitos.
