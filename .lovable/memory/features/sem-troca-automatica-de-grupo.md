---
name: Proibida troca automática de grupo de usuário
description: Nenhuma rotina automática (IdP, JumpCloud/Okta, sync de funcionários) pode alterar grupo/departamento de usuário no SAP ou no ERP Flow
type: constraint
---

Nenhum fluxo automático pode criar, remover ou trocar grupo de permissão do ERP Flow
(`user_group_assignments`) nem departamento/filial de usuário existente no SAP.
Mudança de grupo é SEMPRE manual, feita por administrador na tela de usuários.

Aplicado em:
- `supabase/functions/_shared/idp-deprovision.ts` — passo de remoção de grupos desativado;
  o corte de acesso continua pelo desprovisionamento do vínculo de identidade.
- `supabase/functions/_shared/employee-sync.ts` + `employees-sync-run` — `Department`/`Branch`
  só são enviados ao SAP na CRIAÇÃO do funcionário (`isNewEmployee`), nunca em update.

**Why:** usuários estavam sendo trocados de grupo sozinhos, gerando perda/ganho indevido de acesso.
