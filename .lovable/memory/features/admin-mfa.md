---
name: Admin MFA (F09)
description: Administradores exigem segundo fator (TOTP, aal2) no banco e nas funções; sessão admin 12h, usuário 30d; reset só por outro admin
type: feature
---
- has_role(admin) retorna false para o próprio usuário sem aal2 no JWT; chamadas de serviço (sem JWT) não são afetadas.
- _shared/auth.ts requireUser: admin sem aal2 → 403; sessão admin >12h ou usuário >30d → 401.
- Funções com checagem própria usam callerHasMfa(req).
- Tela AdminMfaGate conduz cadastro/confirmação; AdminMfaCard em Administradores mostra status e redefine fator (edge mfa-admin-reset, audit mfa_factor_reset).
- Não há códigos de recuperação: perda do celular = outro admin redefine.
