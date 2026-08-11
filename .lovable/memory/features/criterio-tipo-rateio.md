---
name: Critério "Tipo de Rateio" nas regras de aprovação
description: Campo rateio_type é critério selecionável na matriz de alçadas (folha/imposto/reembolso/viagens/padrão).
type: feature
---
- `rateio_type` é um critério de regra (UI: "Tipo de Rateio"), operadores igual/diferente, valores: padrao, folha, imposto, reembolso, viagens.
- Contexto injetado em: `src/hooks/useExpenses.ts` (criação), `expense-mutation` (rematch), `expense-reassign-approver` (reprocesso). Documentos SAP (`src/lib/approvalSegments.ts`) usam "padrao".
- Instituto: regra "Folha (tipo de rateio)" prioridade 999 → Ketlhenn Monteiro (nível único).
