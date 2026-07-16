---
name: Sales module access
description: Módulo "Vendas" (/vendas, /vendas/historico) é restrito ao grupo de permissão de Contas a Receber; não faz parte dos DEFAULT_MODULES.
type: feature
---

## Regra
- Módulo `sales` NÃO está em `DEFAULT_MODULES` (src/hooks/usePermissions.ts).
- Só enxergam Vendas: admins (user_roles.role = 'admin'), SAP superuser, OMIE (bypass) e usuários atribuídos a um grupo de permissão que inclua o módulo `sales` (grupo de Contas a Receber).
- Guardas de rota em `src/pages/Sales.tsx` e `src/pages/BaixasHistory.tsx` usam `useModuleAccess("sales")` e bloqueiam a página caso o usuário não tenha acesso.
- MainMenu e MobileMenuSheet já filtram por `moduleKey: "sales"`.
