
## Objetivo

Criar nova integração Synapse `purchase_order_notifications` que monitora o ciclo de vida de pedidos de compra no SAP B1 e dispara emails ao solicitante em 4 marcos:

1. **Pedido aprovado** (status passa de pendente → aprovado)
2. **NF de entrada incluída** (PurchaseDeliveryNotes ou PurchaseInvoices vinculada ao PO)
3. **Contas a pagar gerado** (Invoice gerada → JournalEntry de AP)
4. **Contas a pagar baixado** (pagamento liquidado — VendorPayments / ClosedDate)

Email vai para o `requester email` do PO. Execução a cada 15 min, com deduplicação por `(po_doc_entry, milestone)`. Toda execução gera log com preview do HTML enviado ou erro.

## Arquitetura

```text
[pg_cron a cada 15min]
        ↓
[synapse-po-notify edge function]
        ↓
  ├─ lê config global (synapse_global_settings)
  ├─ lista synapse_integrations ativas para a chave 'purchase_order_notifications'
  └─ para cada empresa ativa:
        ├─ login SAP (cookies)
        ├─ busca PO recentes (últimos N dias)
        ├─ para cada PO + cada milestone detectado:
        │     ├─ verifica se já notificado (po_notification_sent)
        │     ├─ envia via send-smtp-email (preview HTML salvo)
        │     └─ insere em po_notification_sent + synapse_execution_log
```

## Mudanças no Banco

**Nova tabela `synapse_global_settings`** (singleton, 1 linha por integration_key):
- `integration_key` (PK)
- `is_active_global` boolean
- `interval_minutes` integer
- `parameters` jsonb (ex.: `days_back`, remetente, assunto)
- RLS: somente admin gerencia; todos autenticados leem.

**Nova tabela `po_notification_sent`** (deduplicação):
- `company_db`, `po_doc_entry` (int), `milestone` (text: `approved`|`grpo`|`ap_invoice`|`ap_paid`)
- UNIQUE `(company_db, po_doc_entry, milestone)`
- `sent_at`, `recipient_email`, `email_html` (preview salvo), `email_subject`, `status` (`sent`|`error`), `error_message`

**Atualizar `synapse_execution_log`**: já existe e suporta `details` jsonb — guardará por execução: contagem por milestone, lista de erros, preview links.

Cron job (via `supabase--insert`, não migration): chama `synapse-po-notify` a cada 15 min.

## Backend (Edge Functions)

### Nova: `supabase/functions/synapse-po-notify/index.ts`
- Aceita POST: `{ company_db?: string, force?: boolean }` (sem company_db → roda para todas as ativas)
- Antes de processar: lê `synapse_global_settings` — se `is_active_global=false`, aborta com log "global disabled"
- Para cada empresa:
  1. Login SAP (reusa padrão de `synapse-pagcorp-sync`)
  2. Detecção de milestones (consultas Service Layer):
     - **approved**: `PurchaseOrders?$filter=DocumentStatus eq 'bost_Open' and DocApprovalStatus eq 'asas_Approved' and DocDate ge '<dataN>'` (ou comparar `UpdateDate`)
     - **grpo**: para cada PO, checar `BaseEntry`/`BaseDocument` em `PurchaseDeliveryNotes` que referencia o PO (ou via campo `DocumentLines/BaseEntry` no PDN)
     - **ap_invoice**: idem em `PurchaseInvoices` referenciando o PO
     - **ap_paid**: `PurchaseInvoices?$filter=DocumentStatus eq 'bost_Close'` ou consultar `VendorPayments` linkado
  3. Para cada `(po, milestone)` novo (não existir em `po_notification_sent`):
     - Renderiza HTML (template inline com brand)
     - Resolve email do solicitante: `PO.RequesterEmail` → fallback `PO.U_*` → fallback `OUSR.E_Mail` por `RequesterCode`
     - Chama `send-smtp-email`
     - Insere `po_notification_sent` com status e HTML preview
  4. Após loop, insere `synapse_execution_log` com resumo
- Atualiza `synapse_integrations.last_run_*`
- Config local em `supabase/config.toml`: `verify_jwt = false` (chamado por cron)

### Reuso
- `send-smtp-email` já existe — reutilizado.
- `useSynapseIntegrations.ensureIntegration` ganha bloco para `purchase_order_notifications`.

## Frontend

### `src/pages/Synapse.tsx`
- Sem alterações estruturais — a nova integração aparece automaticamente após `ensureIntegration`. Toggle ativo/inativo por empresa e botão "Executar" funcionam via hook existente.
- Adicionar mapeamento em `edgeFunctionMap` no hook: `purchase_order_notifications: "synapse-po-notify"`.

### `src/components/IntegrationsTab.tsx` (Backoffice/Admin)
- Adicionar nova seção **"Configurações Globais Synapse"** abaixo de "Integrações Disponíveis":
  - Lista cada `synapse_global_settings` com:
    - Switch ativo/inativo global
    - Input numérico de frequência (minutos)
    - Botão Salvar
- Novo hook `useSynapseGlobalSettings` para CRUD nessa tabela.

### Logs / Preview
- Em `Synapse.tsx`, na dialog de configurações, ampliar lista "Últimas execuções" — para `purchase_order_notifications`, listar últimos registros de `po_notification_sent` com botão "Ver preview" (abre dialog mostrando o HTML ou mensagem de erro).

## Detalhes Técnicos Importantes

- **Deduplicação**: chave `(company_db, po_doc_entry, milestone)` — UNIQUE constraint garante atomicidade mesmo com execuções concorrentes.
- **Idempotência**: se `send-smtp-email` falhar, `po_notification_sent` é gravado com `status='error'`; próxima execução não retenta automaticamente (decisão consciente para não floodar). Botão manual "Reenviar" pode ser adicionado depois.
- **Janela de busca**: parâmetro `days_back` (default 30) limita PO consultados.
- **Email do solicitante**: SAP B1 expõe `RequesterEmail` no PO; se vazio, buscar `Users(<RequesterCode>)/EmailAddress`. Se ainda vazio → log com erro "sem email".
- **Cron**: agendado via `supabase--insert` apontando para a URL pública da função com `apikey` no header.
- **Execução manual**: botão "Executar" no Synapse continua funcionando e respeita `is_active_global`.

## Ordem de Implementação

1. Migration: criar `synapse_global_settings` e `po_notification_sent` + RLS + seed do registro global para `purchase_order_notifications`.
2. Edge function `synapse-po-notify` + entrada em `config.toml`.
3. Atualizar `useSynapseIntegrations`: registrar a nova integração no `ensureIntegration` e mapear no `edgeFunctionMap`.
4. Hook `useSynapseGlobalSettings` + UI no `IntegrationsTab`.
5. UI no `Synapse.tsx` para listar histórico de notificações com preview HTML.
6. Agendar cron job de 15 em 15 min via `supabase--insert`.

