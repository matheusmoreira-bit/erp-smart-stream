---
name: Cancelamento de PC libera transação PagCorp
description: Ao cancelar pedido de compra no SAP (com ou sem despesa no Flow), as transações PagCorp vinculadas voltam a ficar livres para novo lançamento.
type: feature
---
Padrão do sistema (edge function `sap-cancel-purchase-order`):

- Após cancelar o PC no SAP com sucesso, as linhas de `pagcorp_integration_log` com o mesmo `company_db` + `sap_doc_entry` são removidas, liberando a transação para novo lançamento.
- Vale tanto para pedidos órfãos (criados direto pela integração PagCorp) quanto para despesas do módulo de Compras (`finalStatus: "cancelado"` via `expense-mutation`).
- Exceção: logs com settlement concluído (`settlement_status = completed`, `settlement_journal_entry` ou `settlement_invoice_doc_entry` preenchidos) são preservados e apenas registrados no audit log como `pagcorp_kept_settled`.
