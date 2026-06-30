
# Console de Auditoria — Fases 3 e 4

O schema já existe (`audit_console_runs/divergences/insights/logs/rules` + enums). O que falta é o motor que **gera dados** e a UI para **disparar e revisar**.

## Fase 3 — Motor, regras, insights, logs

### 3.1 Edge function `audit-console-run` (motor)
Cria um run e processa em background usando `EdgeRuntime.waitUntil`. Recebe `{ companyDB, scope, dateFrom, dateTo }`.

Pipeline por run:
1. `INSERT audit_console_runs (status=pending, progress=0)`
2. Para cada etapa, atualiza `current_step` + `progress_pct` e grava `audit_console_logs`
3. Coleta dados do SAP via Service Layer (reusa `sapFetch` de `_shared/sap-fetch.ts` e credenciais via `system_credentials`):
   - `PurchaseRequests`, `Quotations`, `PurchaseOrders`, `PurchaseDeliveryNotes`, `PurchaseInvoices`, `VendorPayments`, `BusinessPartners`
   - filtra por `DocDate` entre `dateFrom`/`dateTo`
4. Aplica regras (próximo item) → gera divergências
5. Gera insights via Lovable AI (resumo executivo)
6. Atualiza `status=completed`, totais e `finished_at`

### 3.2 Regras de divergência (catálogo inicial)
Implementa direto no motor, parametrizáveis por `audit_console_rules`:

| Tipo enum                  | O que checa                                                              | Severidade default |
|---------------------------|--------------------------------------------------------------------------|--------------------|
| `missing_order`           | GRPO/PI sem PO de origem                                                | high               |
| `missing_grpo`            | PI sem GRPO quando fornecedor exige                                     | medium             |
| `missing_ap`              | GRPO sem PI após N dias (config `days`, default 30)                     | medium             |
| `value_mismatch`          | `|PO.DocTotal − PI.DocTotal| > tolerance` (% ou $)                       | high               |
| `vendor_mismatch`         | PI com `CardCode` diferente do PO                                       | critical           |
| `payment_terms_mismatch`  | `PaymentGroupCode` PI ≠ PO                                              | medium             |
| `duplicate_suspected`     | Mesma `CardCode` + valor + janela ±3 dias                               | high → fraud_flag  |
| `date_anomaly`            | `PI.DocDate < PO.DocDate` ou fim de semana/feriado                      | low                |
| `missing_approval`        | PO acima do limite sem `approval_history` correspondente                | high               |
| `missing_payment`         | PI vencida há > 30d sem `VendorPayment`                                 | medium             |

Regras default são *seedadas* via migração (`company_db = NULL` = global). Admin pode override por empresa.

### 3.3 Insights IA
Após o pipeline, chama Lovable AI (`google/gemini-3-flash-preview`) com o resumo das divergências e grava 3-5 linhas em `audit_console_insights` (executive summary + top riscos).

### 3.4 UI — Disparar e acompanhar
- **Botão "Nova auditoria"** em `AuditRunsList` → modal com `dateFrom/dateTo`, escopo (compras/vendas/financeiro/tudo), confirma e chama a edge function.
- **Polling** do run ativo a cada 3s (substitui mensagem "Fase 3").
- **Aba Regras**: tabela editável de `audit_console_rules` (ativar/desativar, ajustar `tolerance` e `default_severity`).
- **Aba Logs**: lista `audit_console_logs` por run com filtro por nível.
- **Aba Insights**: lista global de `audit_console_insights` (já existe hook).

## Fase 4 — Análise documental

### 4.1 Bucket privado `audit-console-docs`
Upload de NF (XML/PDF) ou contrato, por run.

### 4.2 Edge function `audit-console-analyze-doc`
- Recebe `{ runId, storagePath, docType: 'nf' | 'contract' }`
- Extrai texto: PDF → `pdf-parse` (npm); XML → parser nativo
- Chama Lovable AI com structured output (Zod) para extrair: `vendor`, `total`, `items[]`, `dates`, `paymentTerms`
- Confronta contra o SAP daquele run:
  - NF: bate `CardCode`, `DocTotal`, itens com `PurchaseInvoices`
  - Contrato: bate cláusulas (prazo, multa, vigência) com `PurchaseOrders`
- Gera `audit_console_divergences` com `source_table='external_doc'`, `source_id=storagePath`

### 4.3 UI — Tab "Documentos"
- Drag & drop multiplo
- Lista de docs enviados por run + status (`pending/analyzed/failed`)
- Linha clicável → modal com extração estruturada + divergências geradas

## Estrutura técnica

```text
supabase/functions/
  audit-console-run/           # motor (background via EdgeRuntime.waitUntil)
  audit-console-analyze-doc/   # análise documental (Fase 4)

src/components/audit-console/
  NewAuditRunDialog.tsx        # modal "Nova auditoria"
  AuditRulesTable.tsx          # editor de regras
  AuditLogsViewer.tsx          # tail de logs por run
  AuditInsightsList.tsx        # lista global
  AuditDocumentsTab.tsx        # Fase 4
  AuditDocumentRow.tsx

src/hooks/useAuditConsole.ts   # estender: useStartAuditRun, useAuditDocuments,
                               # useUpdateRule, polling em useAuditRun quando pending

supabase/migrations/<ts>_audit_console_phase3_4.sql
  - tabela audit_console_documents (id, run_id, company_db, storage_path,
    doc_type, extracted jsonb, status, error, created_at)
  - GRANT + RLS análogo a divergences
  - seed audit_console_rules com regras default (company_db NULL)
  - bucket privado audit-console-docs via storage.buckets
```

## Considerações

- **Credenciais SAP**: motor lê `system_credentials` por `company_db` e usa Service Layer (mesmo padrão de `sap-b1-proxy`).
- **Run longo**: usa `EdgeRuntime.waitUntil(processRun())` retornando 202 imediato ao client, que faz polling.
- **Idempotência**: bloqueia novo run para a mesma `company_db` se já existir um `pending` ativo.
- **Custo IA**: insights = 1 chamada por run; análise documental = 1 por doc. Default Gemini Flash (barato).
- **Permissões**: já garantidas por `can_access_audit_console` + role `admin` (não muda).
- **Sem mock**: dados reais do SAP e da IA desde o primeiro run.

## Fora de escopo (proposta para fase 5+)
- Agendamento recorrente (cron) das auditorias
- Workflow de aprovação das divergências revisadas (tabelas `audit_console_workflow_*` já existem mas ficam dormentes)
- Export PDF do relatório executivo

Posso seguir? Se sim, começo pela migração + motor (Fase 3) e depois Fase 4.
