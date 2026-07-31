---
name: Baixa PagCorp com valor exato
description: Regra de valor das baixas automáticas do PagCorp — sempre a fatia do PC/NF, nunca o saldo da conta a pagar consolidada
type: feature
---
Baixas automáticas do PagCorp (pagcorp-settlement-watcher) devem aplicar **exatamente** o valor do pedido de compra / NF de entrada de origem.

- Quando a conta a pagar (PurchaseInvoice) consolida vários PCs, a baixa usa apenas a fatia proporcional das linhas com `BaseEntry = PC` e `BaseType = 22` (`PoShare`), limitada pelo saldo aberto da NF. Nunca o `DocTotal`/saldo inteiro.
- Divergências existentes são corrigidas pela função `pagcorp-settlement-repair` (admin, dryRun por padrão): cancela o VendorPayment automático divergente e devolve o log (`pagcorp_integration_log`) para `settlement_status = pending`, para o watcher relançar.
- O reparo só toca em baixas automáticas do PagCorp; documentos lançados manualmente no ERP nunca são cancelados.
- Tela: Backoffice → Auditoria de baixas PagCorp (`src/pages/PagCorpSettlementAudit.tsx`).
