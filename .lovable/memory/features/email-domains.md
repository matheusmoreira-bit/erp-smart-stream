---
name: Domínios de e-mail permitidos
description: growth.gg é o novo domínio do grupo; antigos coexistem no login e no envio de e-mails
type: feature
---

- Migração em curso: colaboradores de todas as empresas do grupo passam para **@growth.gg**.
- Os domínios antigos (anagaming.com.br, cactuscorporation.com, cactusgaming.net, opengaming.com.br, banana.games, lotusblanca.net, institutoconectacactus.org.br) **continuam válidos** durante a transição.
- Allowlists a manter sincronizadas:
  - `src/components/GoogleAuthGate.tsx` → `ALLOWED_DOMAINS` (login Google)
  - `supabase/functions/send-smtp-email/index.ts` → `DEFAULT_ALLOWED_EMAIL_DOMAINS` (destinatários; o secret `SMTP_ALLOWED_DOMAINS` sobrescreve se existir)
- Remetente do sistema permanece `system@anagaming.com.br` (não muda por ora).
- Identidade não quebra na troca: `canonical_user_key()` ignora o domínio; basta registrar o novo e-mail em `sap_user_emails` para o mesmo `user_key`.
