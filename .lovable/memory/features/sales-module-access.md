---
name: Sales module access
description: Módulo "Vendas" é visível a todos os usuários (faz parte dos DEFAULT_MODULES).
type: feature
---

## Regra
- Módulo `sales` está incluído em `DEFAULT_MODULES` (src/hooks/usePermissions.ts).
- Todos os usuários enxergam o módulo Vendas por padrão, sem necessidade de grupo específico.
- Guardas de rota em `src/pages/Sales.tsx` e `src/pages/BaixasHistory.tsx` continuam usando `useModuleAccess("sales")` — permanecem porque grupos customizados podem opcionalmente restringir.
