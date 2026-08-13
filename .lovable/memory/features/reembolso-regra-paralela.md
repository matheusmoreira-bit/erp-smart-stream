---
name: Regra de reembolso é paralela
description: rateio_type=reembolso NÃO substitui a matriz; cria uma trilha extra em paralelo à alçada padrão.
type: feature
---
- Folha/imposto/viagens continuam sendo override (regra única).
- Reembolso: `buildReembolsoSegments` (`supabase/functions/_shared/rateio-segments.ts`) gera as trilhas padrão (CC+projeto, allowSingle) **mais** um segmento `__reembolso__` com a cadeia da regra que usa o critério `rateio_type`.
- Documento só é aprovado quando todas as trilhas (padrão + reembolso) concluírem.
- Aplicado em `expense-mutation` (criação) e `expense-reassign-approver` (reprocesso).
