---
name: Baixa PagCorp — valor sempre na moeda do documento
description: Em NF de moeda estrangeira, DocTotal/PaidToDate do SAP são em BRL e DocTotalFC/PaidToDateFC em USD; usar o total local com PTAX gera dupla conversão.
type: feature
---
Nas baixas automáticas do PagCorp (`pagcorp-settlement-watcher`):

- O SAP devolve `DocTotal` / `PaidToDate` da PurchaseInvoice em **moeda local (BRL)** e `DocTotalFC` / `PaidToDateFC` na **moeda do documento (USD)**.
- O valor da baixa (`openAmount`) deve ser calculado **na moeda do documento**: FC quando a NF for estrangeira. Multiplicar o total local pela PTAX causa dupla conversão (caso real: NF US$ 49.345,47 → baixa de R$ 1.280.608,34 em vez de ~US$ 5,5 mil).
- A fatia do PC é aplicada como **razão** (`PoRatio = soma das linhas do PC / soma de todas as linhas`) sobre o total na moeda do documento — nunca como valor local convertido.
- `TransferSum` = valor FC × PTAX do pagamento; `SumApplied` = valor FC × `DocRate` da NF.
