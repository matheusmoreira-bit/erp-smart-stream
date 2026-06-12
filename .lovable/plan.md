# Evoluções do Módulo PagCorp

Escopo grande — proponho executar em **4 fases** para validar incrementalmente. Confirme se aceita o ordenamento ou se quer outra prioridade.

---

## Fase 1 — Ajustes diretos na integração SAP e UI da lista

1. **Descrição enviada ao SAP** (`pagcorp-to-sap/index.ts`)
   - Trocar `Despesa interna #<id>` por `PagCorp <Nome do Portador/Cartão>`.
   - Portador = `cardName` ou `accountAlias` ou `accountName`.
2. **Botão "Integrar ao ERP"** (`PagCorp.tsx`, `PagCorpIntegrateDialog.tsx`, `PagCorpConsolidateDialog.tsx`)
   - Padronizar label nos dois fluxos (com e sem prestação).
3. **Status textual da prestação de contas** (`PagCorp.tsx`)
   - Coluna passa a exibir badge com texto: `Pendente` / `Em análise` / `Aprovado`.
4. **Novo filtro de status** (`PagCorp.tsx`)
   - Três opções: Pendente · Em análise · Finalizado, com regras:
     - Pendente = sem prestação
     - Em análise = prestação criada e não aprovada
     - Finalizado = prestação aprovada
5. **Remover aba duplicada "Centro de Custo / Projeto"** (`PagCorpMapping.tsx`)
   - Toda configuração permanece na aba "Cartões".

## Fase 2 — Indedutíveis e integração em lote

6. **Integração sem prestação ⇒ Indedutível automático** (`PagCorp.tsx`, `pagcorp-to-sap`)
   - Quando `hasAccountability=false`, marcar `nondeductible=true` no payload e pular obrigatoriedade de prestação.
7. **Lote de indedutíveis em um único PC** (`PagCorp.tsx`, `pagcorp-to-sap`)
   - Reusar `integrateConsolidated` adicionando flag `nondeductible`.
8. **Lote de transações COM prestação em um único Pedido de Compra**
   - Garantir que todos os anexos/receipts das transações sejam enviados ao SAP (atualizar `pagcorp-to-sap` para iterar receipts de cada linha e anexar todos).

## Fase 3 — Consulta e reenvio de integrações

9. **Detalhe da integração concluída** (nova `PagCorpIntegrationDetailDialog.tsx`)
   - Ao clicar em linha integrada, abrir modal com `pagcorp_integration_log` (sap_payload, sap_response, sap_doc_entry/num, anexos, status).
   - Inspiração: `IntegrationsMonitor.tsx`.
10. **Reenvio de integração com falha**
    - Listar falhas (`pagcorp_integration_log` status=`error`) acessíveis a partir da própria linha.
    - Permitir editar fornecedor / centro de custo / projeto / item e reenviar via `pagcorp-to-sap` reaproveitando `pagcorp_data`.
11. **Persistência do modal durante a sessão**
    - `sessionStorage` por transação id: fornecedor + overrides; restaurar ao reabrir.

## Fase 4 — Padronização de empresas (transversal)

12. **Razão Social / Nome Fantasia / CNPJ (ou Nome Estrangeiro)**
    - Adicionar colunas a `companies` se faltarem (`legal_name`, `trade_name`, `tax_id`, `foreign_name`, `is_foreign`).
    - Atualizar telas que mostram empresa: seletor SAP, listas, filtros, headers.
    - Migration + ajuste em `useCompanies.ts` + componentes consumidores.

---

## Detalhes técnicos chave

- **Backend tocado**: `supabase/functions/pagcorp-to-sap/index.ts` (descrição, indedutível, batch, multi-anexos).
- **Sem mudança de schema** nas fases 1–3, exceto índice opcional em `pagcorp_integration_log(status)`.
- **Fase 4** exige migration em `companies` + retipagem.
- Detalhe/reenvio reaproveitam `pagcorp_integration_log` já existente — sem nova tabela.

---

## Confirmações antes de começar

- Posso seguir nessa ordem (1 → 4) entregando fase a fase?
- Na Fase 4, devo **adicionar** colunas novas em `companies` ou já existem campos equivalentes que devo reaproveitar? (vou inspecionar antes da migration)
- "PC" no item 7 = **Pedido de Compra** consolidado com flag indedutível, certo? (não um documento contábil distinto)
