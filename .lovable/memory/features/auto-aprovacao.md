---
name: Auto-aprovação sempre escalada
description: O solicitante nunca aprova o próprio documento; o nível dele é pulado e os demais aprovadores seguem o fluxo.
type: feature
---
- Se o solicitante também é aprovador da alçada, a aprovação dele é **escalada**: ele é removido do nível atual e o documento vai para o próximo aprovador (paralelo do mesmo nível) ou para o próximo nível.
- O solicitante **não vê** os botões de aprovar/rejeitar — nem quando é admin/super-usuário.
- Os demais aprovadores continuam decidindo normalmente; a ausência da decisão do solicitante não trava o fluxo.
- Implementação: `supabase/functions/_shared/approval-skip.ts` (`excludeRequesterLevels`), guard no `expense-approval-action`, e `src/lib/self-approval.ts` usado em `Approvals.tsx`, `MobileApprovals.tsx` e `approval-authz.ts`.
