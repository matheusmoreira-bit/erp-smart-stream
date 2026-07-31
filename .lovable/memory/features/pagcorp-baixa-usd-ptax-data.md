---
name: Baixa PagCorp em USD — PTAX e data da compra
description: Regra de data e câmbio das baixas automáticas do PagCorp em dólar (PTAX BCB da data da compra, pagamento lançado na mesma data)
type: feature
---
Baixas automáticas do PagCorp (`pagcorp-settlement-watcher`):

- **Conta contábil** é resolvida por `pagcorp_settlement_accounts` conforme a classificação do evento / moeda: BRL (saldo em real) e USD (saldo em dólar) usam contas diferentes.
- **USD**: `DocRate` do pagamento = PTAX de **venda** do Banco Central (Olinda) da **data da compra** (transação no cartão); o pagamento é lançado com `DocDate`/`TaxDate`/`DueDate`/`TransferDate` = **data da compra**. Se o SAP recusar a data (período fechado / fora do intervalo permitido), refaz automaticamente na data da NF.
- **BRL**: mantém a data da NF e valor local, sem conversão.
- `pagcorp-settlement-repair` aceita `mode: "reset_cancelled"`: confirma no ERP se a baixa automática foi cancelada e, se sim, limpa os vínculos (`settlement_*`) devolvendo o log para `pending`. Pagamentos ainda ativos não são tocados.
