---
name: Cartões corporativos em empresas Omie
description: Em empresas Omie, transações PagCorp viram sempre Conta a Pagar — nunca Pedido de Compra nem LCM.
type: feature
---

Empresas com erpType = "omie" não usam Pedido de Compra nem Lançamento Contábil Manual
para cartão corporativo. Toda transação do PagCorp é lançada como CONTA A PAGAR no Omie.

- Tela: `src/pages/PagCorp.tsx` desvia para `PagCorpOmieIntegrateDialog` quando `isOmie`.
- Usuário escolhe na hora: fornecedor, categoria, conta corrente e vencimento.
- Em lote: uma conta a pagar por transação (nunca consolidada).
- Backend: `supabase/functions/pagcorp-to-omie` (IncluirContaPagar), log em
  `pagcorp_integration_log` com integration_type = "omie_accounts_payable".
