## Contexto atual

Hoje temos dois fluxos acoplados no `pagcorp-settlement-watcher`:

**Fluxo 1 — Baixa automática do PagCorp (o que precisa mudar)**
Após o PC (Pedido de Compra) ser fechado no SAP pela NF de Entrada, o watcher cria um **Lançamento Contábil (JournalEntry)** manual: débito no fornecedor / crédito na conta contábil do cartão PagCorp.

Problema: isso é uma baixa "por contabilidade" — não fecha a fatura de fornecedor em Contas a Pagar. O AP fica em aberto no SAP, o extrato de fornecedor mostra fatura + JE avulso, e reconciliação com o cartão fica manual.

**Fluxo 2 — Vínculo PC → documentos subsequentes (não está funcionando)**
A tabela `nf_entrada_contas_pagar` está zerada. Existem 5 NFs com `sap_matched_po_doc_entry` preenchido, mas nenhuma tem vínculo com AP registrado. Causas:
- O único ponto que grava esse vínculo é o `pagcorp-settlement-watcher`, e ele só grava quando consegue liquidar — hoje todas as 8 linhas `SBO_ANAGAMING` estão em `settlement_status='error'` (401 SLD + query 400) e as demais são base de teste.
- O casamento NF↔AP usa `sap_matched_po_doc_entry` + `valor_total` exato (`.eq("valor_total", invoice.DocTotal)`), o que é frágil (NF parcial, arredondamento, uma NF cobre múltiplos PCs).

## O que muda

### 1. Substituir JournalEntry por Outgoing Payment (baixa via Contas a Pagar)

Trocar a chamada `POST /JournalEntries` por `POST /VendorPayments` no SAP Service Layer, um pagamento **por PurchaseInvoice**, aplicando o valor total (ou saldo em aberto) da NF, tendo como conta de saída a GL cadastrada em `pagcorp_settlement_accounts` (a mesma que hoje é o "crédito" do JE).

Estrutura resumida do payload:

```text
VendorPayments
  DocDate = data da NF
  CardCode = fornecedor da NF
  DocCurrency = moeda da NF
  TransferAccount = settlement_account_code (GL do cartão / conta trânsito)
  TransferSum = saldo em aberto da NF
  TransferDate = data da NF
  PaymentInvoices: [{ DocEntry: NF.DocEntry, InvoiceType: it_PurchaseInvoice, SumApplied: <saldo> }]
  BPLID, CostingCode/ProjectCode quando aplicável
```

Efeito: fecha a `PurchaseInvoice` (`DocumentStatus=bost_Close`, `PaidToDate=DocTotal`) e a contrapartida contábil cai automaticamente na conta trânsito configurada — mesmo resultado contábil que o JE atual, mas com o AP baixado.

Antes de emitir o pagamento, ler `PurchaseInvoices({entry})?$select=DocTotal,PaidToDate,DocumentStatus`:
- se já estiver fechada → marcar `settled` sem repetir pagamento (idempotência);
- pagar apenas o saldo `DocTotal - PaidToDate` (protege contra NF parcialmente paga por outra via).

Registro em `pagcorp_integration_log`:
- novos campos usados: `settlement_payment_doc_entry`, `settlement_payment_doc_num` (a criar via migration; hoje só temos `settlement_journal_entry`);
- `settlement_journal_entry` fica preservado para o histórico já settled; nenhum dado apagado.

### 2. Corrigir e ampliar o vínculo PC → NF → AP

Fazer o vínculo NF↔AP **independente do sucesso da baixa**. Assim que uma NF de Entrada é criada apontando para um PC (drop no `nf-entrada-sap-watcher`, casos 1 e 2), imediatamente:
- consultar `PurchaseInvoices` que tenham `DocumentLines/any(BaseType eq 22 and BaseEntry eq {PC})`;
- gravar em `nf_entrada_contas_pagar` via `linkNfToAp` (helper já existe).

Casamento por PC (BaseEntry), não por valor. Uma NF pode ter várias linhas do mesmo PC — o helper já é idempotente pela chave `(nf_import_id, source, ap_doc_entry)`.

O `pagcorp-settlement-watcher` continua criando o vínculo como fallback (para NFs importadas antes desta mudança), mas passa a usar o mesmo casamento por `BaseEntry` em vez de `valor_total` exato.

### 3. Backfill único

Uma vez, para as 5 NFs com `sap_matched_po_doc_entry` preenchido e `settlement_ap_count=0`: consultar as PurchaseInvoices do SAP por PC e popular `nf_entrada_contas_pagar`. Rodado on-demand (endpoint no `nf-entrada-rematch` ou script SQL manual — a definir na implementação).

## Fora de escopo agora

- Investigar/corrigir os `Login SAP 401 Fail to NONE-SSO` das linhas em erro atuais (parece problema de credenciais em `SBO_ANAGAMING`, não do watcher). Após a mudança, essas linhas voltam automaticamente ao ciclo de retry com o novo fluxo.
- Suporte OMIE para baixa automática (hoje o watcher só toca SAP).

## Detalhes técnicos

- Arquivos afetados:
  - `supabase/functions/pagcorp-settlement-watcher/index.ts` — trocar `createJournalEntry` por `createVendorPayment`; ajustar casamento NF↔AP por `BaseEntry`.
  - `supabase/functions/nf-entrada-sap-watcher/index.ts` — após criar Draft de NF vinculada a PC, buscar `PurchaseInvoices` do PC e chamar `linkNfToAp`.
  - Migration nova: colunas `settlement_payment_doc_entry INT`, `settlement_payment_doc_num INT` em `pagcorp_integration_log`.
- `linkNfToAp` já existe em `_shared/link-nf-ap.ts` e é usada só aqui.
- Idempotência do pagamento: cheque `PaidToDate` antes do POST; se `DocumentStatus=bost_Close` e log já tem `settlement_payment_doc_entry`, apenas confirma `settled`.

## Confirmação antes de implementar

1. A conta cadastrada em `pagcorp_settlement_accounts.settlement_account_code` é uma **GL de trânsito/bancária apropriada para `TransferAccount`** do Outgoing Payment (não conta de fornecedor, não conta de resultado)? Se for uma conta contábil de resultado, o SAP recusa o pagamento.
2. Confirmar que a baixa deve ser sempre pelo **valor da NF** (não pelo valor da transação PagCorp). Em geral batem, mas quando divergem (ex.: NF menor por desconto), o correto é seguir a NF — assumo isso.
