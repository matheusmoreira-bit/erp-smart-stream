---
name: PagCorp não passa por aprovação
description: Transações de cartão corporativo (PagCorp) sempre nascem aprovadas, mesmo quando digitadas manualmente.
type: feature
---
Documento é tratado como cartão corporativo quando `origin = pagcorp` OU a
observação contém "PagCorp" (variações com espaço/caixa). Nesses casos:

- status inicial = `aprovado`, sem aprovador e sem avaliar a matriz de alçadas;
- vale no cliente (`src/hooks/useExpenses.ts`) e no servidor
  (`supabase/functions/expense-mutation` via `_shared/pagcorp-expense.ts`),
  inclusive na ação `submit` de rascunho.
