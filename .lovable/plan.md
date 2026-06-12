# Módulo: Integração de Notas Fiscais de Entrada

Novo módulo independente, sem alterar os existentes. Reaproveita apenas `sap-b1-proxy`, `expense-attachments` bucket e padrões de auditoria já presentes.

## Antes de iniciar — preciso confirmar 4 pontos

1. **API Master Tax**: você tem as credenciais (base URL, token/usuário/senha, método de auth)? Vou armazenar como secrets (`MASTERTAX_BASE_URL`, `MASTERTAX_TOKEN`, etc.). Se ainda não tem, sigo com um cliente "stub" preparado e você adiciona depois.
2. **PDF da NF**: o PDF vem da própria Master Tax (mesmo payload/endpoint) ou de um portal separado (SEFAZ/Meu Danfe/MigrateDFe)? Isso muda o cliente de download.
3. **Fornecedor / Item / Centro de custo**: quando o CNPJ/NCM da NF não existir cadastrado no SAP, devo (a) marcar como "Erro de integração — fornecedor não cadastrado", (b) criar fornecedor automaticamente, ou (c) deixar a despesa em rascunho aguardando vínculo manual? Padrão sugerido: (a)+(c) com tela de vínculo.
4. **Frequência do polling** Master Tax e SAP: sugerido 15 min Master Tax, 10 min status SAP — ok?

Implemento assumindo os defaults acima caso prefira não responder agora.

## Arquitetura

```text
Master Tax API ──► edge: mastertax-pull (cron 15min)
                        │ upsert
                        ▼
                  nf_entrada_imports ──► cria expense (esboço)
                        │                       │
                        │                aprovação ERP Flow (regra dedicada)
                        ▼                       ▼
                  nf_entrada_logs        edge: nf-entrada-to-sap
                                                │ cria Draft PurchaseOrder
                                                ▼
                                         edge: sap-draft-watcher (cron 10min)
                                                │ aprovado → cria Draft PurchaseInvoice
                                                ▼
                                            status final
```

## Banco (migration única)

Tabelas novas, todas com RLS + GRANTs:

- `nf_entrada_imports` — 1 linha por chave de acesso (UNIQUE: chave_acesso).
  - identificação: chave_acesso, numero_nf, serie, cnpj_fornecedor, nome_fornecedor, data_emissao, valor_total, condicao_pagamento
  - payload: xml_content (text), xml_storage_path, pdf_storage_path, itens (jsonb), impostos (jsonb), raw_mastertax (jsonb)
  - vínculos: expense_id, sap_company_db, sap_po_draft_id, sap_invoice_draft_id, cost_center
  - fluxo: status enum (`pending_expense`, `awaiting_erpflow_approval`, `erpflow_rejected`, `awaiting_sap`, `sap_rejected`, `awaiting_invoice`, `completed`, `integration_error`), rejection_reason, last_error
  - auditoria: created_at, updated_at, last_poll_at
- `nf_entrada_logs` — id, import_id, step, status_from, status_to, message, payload (jsonb), actor, created_at
- `nf_entrada_settings` — chave/valor por empresa (mapeamentos CNPJ→BPCode, NCM→ItemCode opcional, regra de aprovação a usar)

RLS: admin total; usuário vê só registros das empresas que tem acesso (mesmo padrão de `expenses`). Storage: novo bucket privado `nf-entrada-files` para XML+PDF.

## Edge functions novas

1. `mastertax-pull` — cron 15min. Lista NFs novas, baixa XML+PDF, faz upsert por `chave_acesso` (idempotente), cria `expense` em rascunho com anexos, dispara regra de aprovação dedicada. Status → `awaiting_erpflow_approval`.
2. `nf-entrada-to-sap` — disparada quando expense vinculada é aprovada (hook na aprovação OU polling de expenses aprovadas com `source='nf_entrada'`). Cria `Drafts` (ObjectCode 22 — Purchase Order) no SAP B1 via `sap-b1-proxy` reaproveitado. Grava `sap_po_draft_id`. Status → `awaiting_sap`.
3. `sap-draft-watcher` — cron 10min. Para cada `awaiting_sap`, consulta status do Draft no SAP. Se rejeitado → `sap_rejected`. Se aprovado/convertido em PO → cria Draft de NF de Entrada (ObjectCode 18) baseada na PO + dados fiscais do XML (CFOP, CST, NCM, impostos). Grava `sap_invoice_draft_id`, status → `completed`.

Todas as funções: logam em `nf_entrada_logs`, capturam erro → status `integration_error` + `last_error`, totalmente reprocessáveis pela tela.

Idempotência: `chave_acesso` UNIQUE; antes de criar PO/NF checa se `sap_po_draft_id`/`sap_invoice_draft_id` já existe.

## Regra de aprovação

Não altero o módulo existente. Crio 1 linha em `approval_rules` com `source='nf_entrada'` (campo novo opcional, default null — não impacta regras atuais) ou marco a expense com tag/categoria reservada `__nf_entrada__` para casar na regra. Vou pelo caminho da tag para zero impacto no schema de approval_rules.

## Front-end

Rota nova `/nf-entrada` em `src/App.tsx`. Item no `MainMenu`. Páginas:

- `src/pages/NfEntrada.tsx` — tabela com filtros (status, empresa, período, fornecedor), colunas pedidas (NF, série, fornecedor, CNPJ, valor, data emissão, status, importação, expense_id, sap_po_draft_id, sap_invoice_draft_id), ações (ver XML, ver PDF, histórico, reprocessar, cancelar).
- `src/pages/NfEntradaDetail.tsx` — drawer/modal com timeline a partir de `nf_entrada_logs`, payloads expandíveis, anexos.
- Hooks: `useNfEntrada`, `useNfEntradaLogs`.
- Botão "Buscar agora" chama `mastertax-pull` manualmente; "Reprocessar" reenvia conforme estado atual.

## Secrets necessários
`MASTERTAX_BASE_URL`, `MASTERTAX_TOKEN` (ou user/pass conforme item 2 acima), opcional `MASTERTAX_PDF_BASE_URL`.

## Ordem de entrega
1. Confirmar os 4 pontos acima.
2. Migration (tabelas + bucket + GRANTs + RLS).
3. Edge `mastertax-pull` + cron.
4. Edge `nf-entrada-to-sap` + tag de approval rule.
5. Edge `sap-draft-watcher` + cron.
6. UI: rota, página lista, detail, menu.
7. Teste end-to-end com 1 NF real.

## Itens NÃO incluídos (confirmar se quer)
- Geração de boleto/pagamento.
- Alteração da tela atual de `Expenses` (mantida intacta; NFs aparecem lá apenas como expense comum filtrável por categoria).
- Mapeamento automático de centro de custo via IA (posso adicionar depois reusando `supplier-ai-extract`).
