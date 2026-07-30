---
name: Identidade única de usuário (usuário SAP)
description: O usuário SAP é a chave de identidade — 1 nome, N e-mails; permissões/alçadas nunca gravam e-mail cru
type: feature
---

## Modelo

- **Usuário SAP = chave de identidade.** 1 usuário SAP : 1 nome : N e-mails.
- Chave canônica: `public.canonical_user_key()` (SQL) e `canonicalUserKey()` em `src/lib/user-identity.ts`.
  Regra: minúsculas, sem domínio de e-mail, sem acentos, sem separadores, sem sufixos `ext/externo/terceiro/adm/admin`.
  Ex.: `matheus.moreira@anagaming.com.br` → `matheusmoreira`.

## Tabelas

- `sap_user_directory` — user_key (PK), sap_user_code, display_name, is_active
- `sap_user_emails` — user_key + email (N e-mails por usuário, email único)
- `user_identity_migration_backup` — cópia das atribuições antes da unificação (2026-07-30)

## Regras obrigatórias

- `user_group_assignments.sap_email` e `approver_cost_centers.sap_email` guardam **a chave canônica**, nunca e-mail.
  Triggers `trg_uga_canonical_email` / `trg_acc_canonical_email` convertem qualquer gravação.
- Nunca gravar duas linhas (username + e-mail) para a mesma pessoa.
- Comparações de identidade: `canonicalUserKey` / `identityMatches` / `sameUser` — nunca `split("@")[0]` novo.
- Para enviar e-mail a um usuário, resolver os endereços em `sap_user_emails` pelo `user_key`.
- Exibição sempre pelo **nome** (`directoryDisplayName` / `displayUserName`).
