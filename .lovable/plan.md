# Baixa automática PagCorp: PO + NF → Journal Entry

## Fluxo alvo

```
Compra PagCorp
  → Prestação de contas
  → Integração SAP (PO gerado pela despesa PagCorp)  [já funciona]
  → NF de entrada lançada (PurchaseInvoice fecha o PO)  [já funciona]
  → **NOVO: Baixa automática (Journal Entry) da fatura contra
     a conta contábil do cartão PagCorp**
```

Quando a NF de entrada é lançada, a fatura de compras (AP Invoice) fica em aberto no fornecedor. O objetivo é gerar um Journal Entry que:

- **Debita** a conta do fornecedor (zerando o saldo da fatura, como se o cartão tivesse pago)
- **Credita** a conta contábil do cartão PagCorp (que já foi debitada quando o cartão foi lançado no extrato bancário)

Isso reconcilia o passivo do fornecedor contra o passivo do cartão, refletindo que o pagamento já ocorreu via cartão.

## Componentes

### 1. Cadastro da conta contábil do PagCorp

Nova tabela `pagcorp_settlement_accounts` (uma linha por empresa + opcionalmente por cartão):

- `company_db` (obrigatório)
- `card_identifier` (opcional; NULL = fallback da empresa)
- `settlement_account_code` — conta contábil do cartão no SAP (ex.: `2.1.03.001`)
- `cost_center`, `project` (opcionais)
- `enabled` (bool, default true)

Resolução na baixa: match exato `(company_db, card_identifier)` → fallback `(company_db, NULL)`.

Tela de cadastro: adicionar seção **"Conta contábil de baixa"** em `src/pages/PagCorpMapping.tsx`, ao lado dos mapeamentos existentes de cartão/item/conta.

### 2. Rastreamento PO → NF → baixa

Adicionar colunas em `pagcorp_integration_log`:

- `settlement_status` (`pending` | `awaiting_invoice` | `awaiting_settlement` | `settled` | `error` | `skipped`)
- `settlement_journal_entry` (int, DocEntry do JE)
- `settlement_error` (text)
- `settlement_attempted_at` (timestamptz)
- `settlement_locked_at` (timestamptz — lock otimista por linha)

Como o vínculo NF↔PO já é automático (via `nf-entrada-rematch` gravando `sap_matched_po_doc_entry` em `nf_entrada_imports`), o watcher casa `pagcorp_integration_log.sap_doc_entry` (PO) com `nf_entrada_imports.sap_matched_po_doc_entry` para achar a fatura correspondente.

### 3. Watcher `pagcorp-settlement-watcher` (novo edge function)

Cron a cada 5 min. Para cada `pagcorp_integration_log` com `status = 'success'` e `settlement_status IN ('pending','awaiting_invoice','awaiting_settlement')`:

1. Lock global (`watcher_runs`) + lock por linha (`settlement_locked_at` com TTL 5 min).
2. Pula bases de teste (`isTestCompanyDb`).
3. Para cada log: consulta SAP `PurchaseOrders(<sap_doc_entry>)` — se `DocumentStatus = 'bost_Close'` significa que a NF fechou o PO; caso contrário mantém `awaiting_invoice`.
4. Busca a `PurchaseInvoice` que fechou o PO (via `DocumentLines/BaseEntry eq <sap_doc_entry>` no endpoint de `PurchaseInvoices`).
5. Resolve conta de baixa em `pagcorp_settlement_accounts` (por cartão → fallback). Se não houver, marca `skipped` com motivo claro.
6. Cria `JournalEntries` no SAP:
   - Linha 1 (débito): `ShortName = <CardCode do fornecedor>`, `Debit = DocTotal`, `ContraAccount = settlement_account_code`
   - Linha 2 (crédito): `AccountCode = settlement_account_code`, `Credit = DocTotal`, `CostingCode`/`ProjectCode` se houver
   - `Memo`: `"Baixa PagCorp PO {docNum} / NF {invoiceDocNum}"`, `Reference1 = PO DocNum`, `Reference2 = Invoice DocNum`
7. Grava `settlement_journal_entry`, marca `settled`. Em erro: incrementa contagem e marca `error` com mensagem; watcher re-tenta em execuções futuras (backoff simples via `settlement_attempted_at`).
8. Timeout global de 90s; próxima página no próximo cron.
9. Log em `integration_log` (`system_name = 'pagcorp'`, `action = 'settlement'`) com `company_db`.

### 4. Agendamento cron

`pg_cron` via `supabase.insert` (não migration):

```sql
select cron.schedule(
  'pagcorp-settlement-watcher',
  '*/5 * * * *',
  $$ select net.http_post(
       url:='https://<project>.supabase.co/functions/v1/pagcorp-settlement-watcher',
       headers:='{"Content-Type":"application/json","apikey":"<anon>"}'::jsonb,
       body:='{}'::jsonb) $$
);
```

### 5. UI de acompanhamento

Em `src/pages/PagCorp.tsx` (e/ou `IntegrationHistory`): coluna extra **"Baixa"** com badge:
- `awaiting_invoice` → cinza "Aguardando NF"
- `awaiting_settlement` → amarelo "Pronta p/ baixa"
- `settled` → verde "Baixada · JE #{n}"
- `error` → vermelho com tooltip da mensagem
- `skipped` → cinza claro com motivo

Botão **"Reprocessar baixa"** (admin) que zera `settlement_status → pending` e invoca o watcher.

## Detalhes técnicos

- Todas as operações filtram/gravam por `company_db` (regra de segregação de bases).
- Reutiliza `sap-b1-proxy`? Não — o watcher usa credenciais de `system_credentials` diretamente (mesmo padrão de `nf-entrada-sap-watcher`).
- Idempotência: `settlement_status = 'settled'` bloqueia novo JE; `settlement_locked_at` evita corrida.
- `DocumentLines/BaseType = 22` (Purchase Order) para localizar a NF que fechou o PO.
- Valor da baixa = `DocTotal` da NF em moeda local (não da despesa PagCorp — evita divergência de câmbio/impostos).
- Journal Entry usa `TransactionCode` opcional (a definir) e `RefDate = DocDate da NF`.

## Passos de implementação

1. Migração: cria `pagcorp_settlement_accounts` (com GRANTs + RLS admin/authenticated read) e adiciona colunas de `settlement_*` em `pagcorp_integration_log`.
2. UI de cadastro em `PagCorpMapping.tsx` + hook `usePagcorpSettlementAccounts`.
3. Edge function `pagcorp-settlement-watcher` + entrada em `config.toml` (`verify_jwt = false`).
4. Cron via `supabase.insert`.
5. UI de status/reprocesso.

## Pontos que preciso confirmar antes de codificar

- **Conta contábil do PagCorp**: uma por empresa é suficiente ou você precisa **por cartão** desde já? (o schema já suporta os dois; só quero saber quantas linhas cadastrar inicialmente).
- **Memo/Reference1/2 do JE**: OK como proposto?
- **Filial (BPLId)**: alguma empresa usa multi-branch e precisa do BPL na baixa?
