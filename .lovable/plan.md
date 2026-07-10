# Sync interno de PC + NF + Contas a Pagar e resolver de relações

Hoje a validação PagCorp e o cálculo de relações batem no SAP Service Layer em tempo real (SapValidationDialog, pagcorp-settlement-watcher, RelationsMap). Isso é lento, cria carga no SL e falha em ambientes que barram `DocumentLines/any()`.

A proposta é espelhar os três documentos no banco de forma incremental e resolver as relações internamente. A UI passa a ler apenas o Postgres.

## O que já existe
- `sap_nf_entrada_cache` + `sap_nf_entrada_sync_state` + função `sap-nf-entrada-sync` (NF de entrada incremental, com `base_po_doc_entry` já extraído). Mantido como está.

## Novas tabelas (migration)

```text
sap_purchase_order_cache
  company_db, doc_entry (PK composto), doc_num, series,
  card_code, card_name, doc_date, doc_due_date, doc_total, doc_total_fc,
  doc_currency, document_status, cancelled, sap_update_date, raw_json, synced_at

sap_purchase_order_sync_state
  company_db (PK), last_update_date, last_doc_entry, last_run_at,
  last_status, last_error, last_batch_count, total_synced

sap_vendor_payment_cache
  company_db, doc_entry (PK composto), doc_num, series, card_code, card_name,
  doc_date, doc_total, doc_total_fc, doc_currency, document_status, cancelled,
  invoice_links jsonb  -- [{docEntry, invoiceType, sumApplied, appliedFC}]
  sap_update_date, raw_json, synced_at

sap_vendor_payment_sync_state (mesmo shape do NF sync_state)

pagcorp_document_relations
  pagcorp_log_id uuid PK (FK -> pagcorp_integration_log.id)
  company_db, po_doc_entry, po_doc_num, po_status, po_total, po_currency,
  nf_doc_entries int[], payment_doc_entries int[],
  po_found bool, nf_found bool, payment_found bool,
  amount_matches bool, last_resolved_at timestamptz, resolve_error text
```

Todas com RLS + GRANTs (admin read; service_role full).

## Novas edge functions

1. **`sap-po-cache-sync`** — clone do `sap-nf-entrada-sync` para `PurchaseOrders`. Sync incremental por `UpdateDate + DocEntry`, paginado, com `watcher-lock`. Ignora bases `SBO_TESTE_*`. Login exclusivo com `Apiuser` (mesma regra do `sap-sl-cache-refresh`).

2. **`sap-vendor-payment-cache-sync`** — análogo para `VendorPayments`. Extrai `PaymentInvoices` para `invoice_links` (para poder cruzar com NFs sem re-consultar o SAP).

3. **`pagcorp-relations-resolver`** — lê `pagcorp_integration_log` com `sap_doc_entry not null` por empresa; para cada log:
   - localiza PC em `sap_purchase_order_cache`
   - localiza NFs em `sap_nf_entrada_cache` onde `base_po_doc_entry = po`
   - localiza pagamentos em `sap_vendor_payment_cache` cujo `invoice_links` contenha uma das NFs
   - grava/atualiza `pagcorp_document_relations` (upsert por `pagcorp_log_id`).
  
   Suporta modo cron (todos os logs stale) e manual (`{ logId }` ou `{ companyDb }`).

## Cron (via supabase--insert, não migration)

- `sap-po-cache-sync` a cada 5 min
- `sap-vendor-payment-cache-sync` a cada 5 min
- `pagcorp-relations-resolver` a cada 5 min (defasado 1 min do sync de NF já existente)

## UI

- `SapValidationDialog` deixa de chamar `sapQuery`. Passa a receber `pagcorpLogId` e ler diretamente `pagcorp_document_relations` + os três `sap_*_cache`. Mostra `last_resolved_at` e um botão “Reconsultar” que invoca `pagcorp-relations-resolver` com `{ logId }`.
- `PagCorp.tsx`: o card de transação exibe os campos vindos do cache (PC/NF/Pagamento) sem chamar SAP.
- `pagcorp-settlement-watcher`: quando precisar procurar a NF de um PO, primeiro tenta `sap_nf_entrada_cache` por `base_po_doc_entry`; só cai no SAP se cache não tiver ainda.
- `RelationsMap` continua funcionando; agora derivado de `pagcorp_document_relations` (já é consumido via hook que só precisa dos doc_entries).

## Ordem de entrega
1. Migration das 4 tabelas + GRANTs + RLS.
2. Edge functions `sap-po-cache-sync`, `sap-vendor-payment-cache-sync`, `pagcorp-relations-resolver`.
3. Cron para as três.
4. Refatorar `SapValidationDialog` e o watcher de baixa.
5. Ajustes menores no `PagCorp.tsx`/`RelationsMap` para consumir a nova tabela.

## Observações técnicas
- Só sincroniza empresas cuja `system_credentials.username = 'Apiuser'` (mesma trava do sap-sl-cache-refresh).
- Todas as queries de UI passam a filtrar por `company_db = session.companyDB` (regra já registrada em memória).
- Trabalho é pesado; nada removemos ainda. Cache e resolver rodam em paralelo à consulta live e, quando estabilizarem, cortamos o fallback.
