# Vínculo N:N entre PO ↔ NF ↔ Contas a Pagar

Hoje o pipeline assume implicitamente 1 PO → 1 NF → 1 Conta a Pagar. Vamos ajustar dados, integrações e UI para que múltiplas NFs possam se vincular ao mesmo PO e cada NF a várias contas a pagar, sem validação de saldo (regra escolhida: "aceita todas").

## 1. Modelo de dados

Migração nova:

- **`nf_entrada_contas_pagar`** (nova tabela de vínculo):
  - `nf_import_id` (FK → `nf_entrada_imports.id`, on delete cascade)
  - `source` (`sap` | `omie`)
  - `company_db`
  - `ap_doc_entry` (numérico, para SAP `PurchaseInvoices.DocEntry` ou `codigo_lancamento_omie`)
  - `ap_doc_num` (texto — número visível)
  - `linked_at`, `linked_by` (texto), `notes`
  - Índices: `(nf_import_id)`, `(company_db, ap_doc_entry)`
  - RLS: SELECT para `authenticated`; INSERT/UPDATE/DELETE só via `service_role` (watchers). Sem `anon`.
  - GRANT: `SELECT` a `authenticated`, `ALL` a `service_role`.

- **`nf_entrada_imports`**: adicionar coluna `settlement_ap_count` (int, default 0) para exibição rápida na UI, atualizada pelos watchers. Sem `CHECK` dependente de tempo.

Observação: mantemos `sap_matched_po_doc_entry` na NF (várias NFs podem ter o mesmo valor — já é permitido). Nenhuma constraint de unicidade é adicionada.

## 2. Rematch e integração NF ↔ PO

`supabase/functions/nf-entrada-rematch/index.ts`:

- Remover o critério `DocTotal eq` (que impedia casar valores parciais) e passar a casar `PurchaseOrders`/`Drafts` **abertos** por `CardCode`, opcionalmente filtrando por proximidade de valor, mas retornando **todos** os candidatos ao usuário via log — o vínculo é aceito mesmo que outras NFs já apontem para o mesmo PO.
- Não bloquear quando o PO já está referenciado por outra NF. Registrar no `nf_entrada_logs` quantas NFs já compartilham o PO.

`supabase/functions/nf-entrada-sap-watcher/index.ts`: nenhuma mudança de lógica — já cria uma Purchase Invoice separada por NF referenciando o mesmo `BaseEntry` (PO).

## 3. Vínculo NF ↔ Contas a Pagar

Novo componente compartilhado `_shared/link-nf-ap.ts` com `linkNfToAp({ nfImportId, source, companyDb, apDocEntry, apDocNum })` que faz upsert em `nf_entrada_contas_pagar` e atualiza `settlement_ap_count`.

Chamado em dois pontos:

- **`nf-entrada-sap-watcher`**: após criar a Purchase Invoice no SAP, gravar o vínculo (`source='sap'`, `ap_doc_entry = invoiceDocEntry`).
- **`pagcorp-settlement-watcher`**: já localiza `PurchaseInvoices` que fecham o PO. Vai passar a iterar sobre **todas** as invoices retornadas (não `$top=1`), gravar um vínculo por NF encontrada, e emitir **um Journal Entry por NF** (débito fornecedor / crédito conta PagCorp com o valor daquela NF).
  - Backfill: se já existir `settlement_journal_entry` para uma das NFs, pular apenas ela e processar as demais.
  - Só marca `settlement_status='settled'` quando todas as NFs vinculadas ao PO já geraram JE.

## 4. UI — Mapa de Relações

`src/hooks/useRelationsMapDerived.ts`:

- `useContasPagarLinks` passa a retornar `invoices` agrupando por NF: cada `PurchaseInvoice` traz um subarray `payables` (lançamentos vinculados àquela NF via `nf_entrada_contas_pagar` + `PurchaseInvoices` no SAP).
- No OMIE: manter matching por `numero_pedido`/fornecedor, mas devolver **múltiplas** contas por NF.

`src/components/RelationsMap.tsx`:

- Etapa "NF Entrada": exibir a lista completa de NFs (não apenas contagem), cada uma com badge do status SAP.
- Etapa "Pagamento": aninhar sob cada NF as contas a pagar correspondentes (valor pago, saldo, data).
- Diagrama passa a mostrar hierarquia PO → NFs → Contas.

## 5. Compat/segurança

- Nenhuma FK a `auth.users`; RLS validando `service_role` em escritas e `authenticated` só em leitura filtrada por `company_db` do usuário via política existente do `nf_entrada_imports` (join lógico no client).
- Log estruturado em `nf_entrada_logs` para toda inserção em `nf_entrada_contas_pagar`.

## Detalhes técnicos

Arquivos alterados/criados:

```text
supabase/migrations/<ts>_nf_ap_link.sql        (novo — tabela + índices + policies + GRANTs)
supabase/functions/_shared/link-nf-ap.ts       (novo)
supabase/functions/nf-entrada-rematch/index.ts (afrouxar filtro de valor)
supabase/functions/nf-entrada-sap-watcher/index.ts (gravar vínculo após criar PI)
supabase/functions/pagcorp-settlement-watcher/index.ts (iterar N NFs + N JEs)
src/integrations/supabase/types.ts             (regenera após migração)
src/hooks/useRelationsMapDerived.ts            (agrupar AP por NF)
src/components/RelationsMap.tsx                (render hierárquico)
```

Deploy: rodar migração; regenerar types; redeploy das 3 edge functions (`nf-entrada-rematch`, `nf-entrada-sap-watcher`, `pagcorp-settlement-watcher`).
