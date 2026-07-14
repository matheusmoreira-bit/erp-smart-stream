## Objetivo
Validar se o fluxo MasterTax → ERP Flow está de fato vinculando **NFs de entrada ao Pedido de Compra (PC) correspondente** no SAP, usando a base `TST - ANA Gaming` (SBO_TESTE_20260318_ANAGAMING) como referência. Vínculo alvo: **cabeçalho NF ↔ PO** (`nf_entrada_imports.sap_matched_po_doc_entry`).

## Diagnóstico já levantado

- **31 NFs importadas** do MasterTax em TST - ANA Gaming; apenas **6 amarraram a um PC** (`sap_matched_po_is_draft = true` em todas — ou seja, esboços).
- **25 NFs ficaram sem match** e permanecem em `awaiting_erpflow_approval`. Fornecedores predominantes: escritórios de advocacia e consultorias (Pinheiro Neto, Bichara, RSM, Sofist, Cappra…) — perfil típico de serviço pago sem PC prévio no SAP.
- **4 NFs estão com `sap_company_db = NULL`** — bug de ingestão (pull não gravou a base de destino).
- Cache local `sap_purchase_order_cache` não tem linhas para `SBO_TESTE_%` porque `sap-po-cache-sync` chama `isTestCompanyDb()` e pula bases teste. Isso **não afeta o match** — `mastertax-pull` e `nf-entrada-rematch` consultam o Service Layer ao vivo — mas afeta relatórios e o Mapa de Relações.
- Watcher `nf-entrada-sap-watcher` rodou às 17:10:04 UTC de hoje com `processed=6 linked=0` — ou seja: nada foi promovido no ciclo atual.

## Escopo da validação (sem alterar lógica)

1. **Categorizar as 25 NFs sem match** rodando um "rematch em lote" contra o SAP ao vivo e classificando o retorno em três causas:
   - `fornecedor não localizado` (CNPJ não bate em `BusinessPartners.FederalTaxID` e nome não contém match).
   - `PC não localizado` (fornecedor achado mas sem `PurchaseOrders` aberto nem `Drafts oPurchaseOrders`).
   - `PC candidato existe mas valor divergente` (há PC/Draft aberto mas `DocTotal` diferente do `valor_total` da NF — investigar tolerância).
2. **Reprocessar as 4 NFs com `sap_company_db` NULL** localmente: identificar se o pull perdeu a base ou se o CNPJ não bate a nenhuma empresa cadastrada em `system_credentials`; anotar o motivo no `nf_entrada_logs`.
3. **Confirmar os 6 vínculos existentes**: para cada `sap_matched_po_doc_entry`, ler no SAP se o `Draft`/PO ainda está `Open`, se CardCode confere e se o `DocTotal` bate — validar que o vínculo continua íntegro (não foi cancelado no ERP).
4. **Amarrar o resultado à cardinalidade N NF ↔ 1 PC**: para cada PC vinculado, contar quantas NFs apontam para ele e conferir consistência com `settlement_ap_count` / `nf_entrada_contas_pagar`.

## Entregável

Um relatório único no chat com:

```text
Base: SBO_TESTE_20260318_ANAGAMING (TST - ANA Gaming)
Total NFs:                31
Com PC vinculado:         6   (drafts abertos)
  └ íntegros hoje:        X / 6
Sem PC:                  25
  ├ fornecedor no SAP não localizado:  A
  ├ fornecedor OK, sem PC aberto:      B
  └ fornecedor OK, PC com valor ≠ NF:  C
Sap_company_db nulo:      4  (motivos consolidados)
```
Mais uma tabela por NF (número, fornecedor, valor, causa) para ação subsequente.

## Como executar (build phase)

- Adicionar um script one-shot em `/tmp` que:
  1. Lê as 25 NFs sem match.
  2. Chama a edge function `nf-entrada-rematch` para cada uma (ela já consulta `BusinessPartners`, `PurchaseOrders` e `Drafts` no SAP), coleta a resposta e classifica.
  3. Para as 4 NFs com `sap_company_db` NULL, consulta `system_credentials` pelo CNPJ do destinatário (se disponível no XML original em storage) e loga o resultado.
  4. Salva o CSV consolidado em `/mnt/documents/nf-entrada-anagaming-validacao.csv` e imprime o resumo.
- Sem migrações. Sem edição de código de produção. Apenas leitura + a chamada existente ao rematch.

## Próximos passos (fora deste plano, dependem do resultado)

- Se dominar a categoria "fornecedor OK, sem PC aberto" → definir política: criar rascunho de PC automático a partir da NF, ou marcar como "sem PC" e seguir para NF direta.
- Se dominar "valor divergente" → decidir tolerância (%) e revisitar `findExistingPo` no `mastertax-pull` (hoje exige `DocTotal` exato; o `rematch` já é mais tolerante).
- Se as 4 NFs com base nula forem recorrentes → corrigir o roteador de empresa em `mastertax-pull`.
- Popular `sap_purchase_order_cache` também para bases teste (ou marcar SBO_TESTE_20260318_ANAGAMING como não-teste) para o Mapa de Relações ficar completo.
