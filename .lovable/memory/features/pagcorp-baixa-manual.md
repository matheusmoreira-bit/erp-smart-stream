---
name: Baixas PagCorp são manuais
description: Baixa automática de cartão corporativo desativada; watcher só detecta a NF e notifica blenda.pinheiro.ext por WhatsApp; baixa é lançada na tela /cartoes/baixas com contas contábeis que contenham "PagCorp"
type: feature
---

## Regra (ago/2026)
- **Não fazer baixa automática** de cartão corporativo (PagCorp).
- `pagcorp-settlement-watcher` no cron apenas detecta que a NF de entrada do PC foi lançada,
  grava `settlement_status = 'awaiting_manual'` + `settlement_invoice_doc_entry/num` e notifica.
- Notificação: WhatsApp para **blenda.pinheiro.ext (+55 31 99674-9771)** + notificação in-app
  (`notifications`, link `/cartoes/baixas`), via `_shared/pagcorp-settlement-notify.ts`.
  Dispara só na transição para `awaiting_manual` (sem tabela de dedup).
- A baixa só é emitida quando a UI chama o watcher com `POST { logId, accountCode, costCenter?, project? }`;
  o `accountCode` sobrepõe `pagcorp_settlement_accounts`.

## Tela
`/cartoes/baixas` (`src/pages/PagCorpSettlements.tsx`) — lista pendências da empresa logada e
permite escolher **apenas contas contábeis cujo NOME contenha "PagCorp"** (ChartOfAccounts filtrado no cliente).
Cálculo de valor/fatia do PC e PTAX continuam no watcher.
