---
name: Módulos indisponíveis no Omie
description: Empresas Omie não têm NF de Entrada, Reconciliação de Adiantamentos nem lançamento contábil manual (LCM).
type: feature
---

Omie não possui a parte contábil nem o fluxo de NF de Entrada do SAP B1.
Para empresas com erpType = "omie" ficam escondidas e bloqueadas:

- `/financeiro/nf-entrada` (NF de Entrada)
- `/financeiro/reconciliacao` (Reconciliação de Adiantamentos)
- qualquer opção de Lançamento Contábil Manual (LCM)

Central: `src/lib/erp-module-availability.ts` (ERP_DENIED_PATHS, isPathDeniedForErp,
filterPathsForErp, erpSupportsJournalEntry). Aplicado em ModuleRoute (bloqueio da rota),
MainMenu, ModulesNavSheet, ModuleSubmenu e no toggle PC/LCM do CreateExpenseModal.
Para incluir novas telas, basta adicionar o caminho em ERP_DENIED_PATHS.
