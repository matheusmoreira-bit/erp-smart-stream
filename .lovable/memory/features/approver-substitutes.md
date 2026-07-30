---
name: Delegação temporária de alçada
description: Substituto de aprovador com vigência, autoatendimento (férias), audit log e notificações via edge function approver-substitute-manage
type: feature
---

## Regras
- Tabela `approver_substitutes` (vigência starts_at/ends_at, revogação, motivo).
- Toda escrita passa pela edge function `approver-substitute-manage` (list/create/revoke),
  porque a maioria dos usuários autentica via SAP (sem auth.uid()).
- Autorização: Cloud admin ou SAP admin/superuser gerenciam tudo; qualquer usuário
  autenticado gerencia apenas a própria alçada (official = ele mesmo) e pode revogar
  o que concedeu.
- Vigência máxima: 365 dias. Oficial ≠ substituto.
- Cada concessão/revogação grava `audit_log` (grant_approver_substitute /
  revoke_approver_substitute) e notifica substituto e titular.

## UI
- `SubstituteApproversTab` (aba em ApprovalRules + modal "Substituto" no cabeçalho de /aprovacoes).
- Botão "Definir meu substituto (férias)" para autoatendimento; admins veem também "Nova substituição".
