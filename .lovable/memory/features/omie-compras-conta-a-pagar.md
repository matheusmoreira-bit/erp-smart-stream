---
name: Compras Omie viram Conta a Pagar
description: Em empresas Omie, o módulo de compras gera Conta a Pagar (IncluirContaPagar), nunca Pedido de Compra; campos extras no formulário e leitura de anexo.
type: feature
---
Empresas com erpType = "omie":
- O documento de compra aprovado é integrado como **Conta a Pagar** (`financas/contapagar/` → `IncluirContaPagar`), não como Pedido de Compra. Vendas continuam como Pedido de Venda.
- Builder: `supabase/functions/_shared/omie-accounts-payable.ts` (`buildOmieAccountsPayablePayload`). Código de integração estável `ERPFLOW-<id>`; em falha de rede tenta `ConsultarContaPagar` para não duplicar.
- Campos extras gravados em `expenses.omie_ap_data` (jsonb): conta corrente (`id_conta_corrente`), categoria, número da NF, chave NF-e, tipo de documento, código de barras, previsão de pagamento e impostos retidos (PIS/COFINS/CSLL/IR/ISS/INSS com `retem_*`).
- Formulário (CreateExpenseModal) mostra o bloco "Conta a pagar (Omie)" só em compras Omie; conta corrente é obrigatória.
- A leitura de anexo (process-expense-doc) extrai `document_number`, `nfe_key` e `withheld_taxes` e preenche esses campos.
