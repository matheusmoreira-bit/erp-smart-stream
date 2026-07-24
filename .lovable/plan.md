
# Fila de retry automático para integrações SAP

## Objetivo
Substituir o retry manual e o watcher genérico de 30 min por uma fila unificada que reagenda automaticamente integrações que falharem com erros 400 classificados como recuperáveis, respeitando backoff exponencial e limite por documento. Ao esgotar tentativas, notificar por e-mail + WhatsApp.

## Escopo confirmado com o usuário
- **Erros elegíveis** (retryable): transientes (session expired, timeout, lock/`in-use`, BPLID/`branch`, `Specify a date within the permissible range`), anexos (`Attachments2` — nome inválido, path), projeto/marca (`-1116` fallback ANA GAMING).
- **Não retryable** (sem re-tentativa): `not authorized`, `approver`, `budget`, permissões, `duplicate`, campos obrigatórios de negócio (fornecedor inexistente, etc.). Vão direto para “ação manual”.
- **Política**: 5 tentativas, backoff **2m → 4m → 8m → 16m → 32m** (~62min de janela).
- **Ao esgotar**: marca `retry_exhausted`, envia e-mail (via `send-transactional-email`) + WhatsApp para admins, lista no painel do Backoffice.
- **Cobertura**: `expense-to-sap`, `advance-to-sap`, `baixa-recebimento`, `pagcorp-to-sap` + `synapse-pagcorp-sync` + `pagcorp-settlement-watcher`.

## Arquitetura

```text
Integração falha 400
        │
        ▼
classifyError() ──► retryable? ──sim──► enqueue em sap_retry_queue (next_attempt_at = now + backoff)
        │                                              │
        └── não ──► marca error final, notifica         ▼
                                       cron 1min ──► sap-retry-worker
                                                       │
                                                       ▼
                                   despacha para função original (por doc_type)
                                                       │
                        ┌──────────────┬───────────────┼──────────────┬─────────────┐
                        ▼              ▼               ▼              ▼             ▼
                 expense-to-sap  advance-to-sap  baixa-recebimento  pagcorp-to-sap  synapse-pagcorp-sync
                                                       │
                                          sucesso ──► delete queue row
                                          falha retryable ──► ++attempts, reagenda
                                          attempts >= 5 ──► status='exhausted', notifica
```

## Componentes

### 1. Tabela `public.sap_retry_queue` (migração)
Campos-chave:
- `doc_type` (`expense` | `advance` | `baixa` | `pagcorp` | `synapse_pagcorp`)
- `ref_id` (uuid/text do doc), `company_db`, `payload` (jsonb — parâmetros para reinvocar a função)
- `attempts` (int, default 0), `max_attempts` (int, default 5)
- `next_attempt_at` (timestamptz), `last_attempt_at`
- `last_error` (text), `error_category` (`session`|`branch`|`date`|`attachment`|`project`|`lock`|`other`)
- `status` (`pending`|`in_flight`|`succeeded`|`exhausted`|`cancelled`)
- `notified_exhausted_at`
- **Unique** `(doc_type, ref_id)` com `status IN ('pending','in_flight')` (parcial) — evita duplicidade.
- RLS: só admin lê/altera; edge functions usam service_role.

### 2. Helper `_shared/sap-retry.ts`
- `classifySapError(status, body): { retryable, category, backoffMinutes? }` — reconhece as mensagens do escopo.
- `enqueueRetry(admin, { doc_type, ref_id, company_db, payload, error, category })` — upsert com backoff progressivo baseado em `attempts` (2/4/8/16/32).
- Substitui a lógica atual do watcher fixo de 30 min naquilo que já cobrimos.

### 3. Integração no ponto de falha
Nos 5 fluxos, dentro do `catch` que hoje persiste `sap_integration_error`:
```ts
const cls = classifySapError(status, body);
if (cls.retryable) await enqueueRetry(admin, {...});
```
Sem alterar contrato de resposta ao cliente — apenas garante que a fila cuide do próximo pedaço.

### 4. Edge function `sap-retry-worker`
- Cron pg_cron a cada **1 minuto**.
- Seleciona até 20 linhas com `status='pending' AND next_attempt_at <= now()` (locking por `UPDATE ... SET status='in_flight'`).
- Para cada linha, dispara a função de origem via `fetch` interno (mesmo padrão do `expense-integration-retry`).
- Sucesso → `status='succeeded'`, remove após 24h (housekeeping).
- Nova falha retryable → `attempts++`, `next_attempt_at = now + backoff(attempts)`. Se `attempts >= max_attempts` → `status='exhausted'` + notifica.
- Nova falha NÃO retryable → `status='exhausted'` imediato + notifica.

### 5. Notificação ao esgotar
- E-mail via template novo `sap-integration-exhausted` (`send-transactional-email`) para lista de admins (`ADMIN_EMAILS` configurável — inicialmente `matheus.moreira`).
- WhatsApp reaproveitando o helper já existente do `expense-integration-retry`.
- Registra em `expense_audit_log` / `pagcorp_integration_log` conforme doc_type.
- Cooldown já garantido por `notified_exhausted_at` (não notifica duas vezes o mesmo doc).

### 6. Ajustes no watcher atual
- `expense-integration-retry` continua existindo para casos legados (aprovados sem `sap_doc_entry` que nunca entraram na fila), mas passa a **primeiro enfileirar** em `sap_retry_queue` em vez de reprocessar diretamente. Evita duplicação de lógica.

### 7. UI mínima (Backoffice)
Nova aba **Integrações → Fila de Retries**:
- Colunas: Empresa · Doc · Tipo · Tentativas · Próxima em · Última falha · Status.
- Ações: **Retry agora** (zera `next_attempt_at`), **Cancelar**, **Ver detalhes**.
- Filtra por status (padrão: `pending` + `exhausted`).
- Realtime via Supabase Realtime na tabela.

## Detalhes técnicos

**Backoff**: `next_attempt_at = now() + interval '2 minutes' * pow(2, attempts)` limitado a 32 min.

**Classificação (regex nos textos SAP)**:
| categoria | pattern |
|---|---|
| session | `SessionId invalido`, `session.*expir`, `-1200` |
| branch | `branch`, `BPLID`, `not assigned to selected branch` |
| date | `Specify a date within the permissible range` |
| attachment | `Attachments2 failed`, `File name`, `space string` |
| project | `-1116`, `LINHAS MARCA/BRAND` |
| lock | `in use`, `blocked`, `locked` |

**Não retryable (blocklist explícita)**: `not authorized`, `insufficient`, `approver`, `budget`, `duplicate`, `already exists`, `foreign key`, `-2035` (validation de conta contábil), `Business Partner is on hold`.

**Idempotência**: chave `(doc_type, ref_id)`. Se novo erro chegar antes de reprocessar, apenas atualiza `last_error`.

**Segurança**: RLS restrita a admins; worker usa `SUPABASE_SERVICE_ROLE_KEY`; nenhum segredo exposto no front.

## Fora do escopo (deste ciclo)
- Retries para erros NON-400 (5xx já retryable no HTTP client atual).
- Fila para fluxos de leitura (NF entrada, PO cache) — só integrações de escrita.
- Retries para MasterTax / JumpCloud.

## Entregáveis
1. Migração `sap_retry_queue` + RLS + índice + trigger `updated_at`.
2. `supabase/functions/_shared/sap-retry.ts` (classifier + enqueue).
3. `supabase/functions/sap-retry-worker/index.ts` + cron.
4. Alteração nos 5 fluxos para enfileirar em erros retryable.
5. Template `sap-integration-exhausted` + wiring.
6. Página `src/pages/BackofficeRetryQueue.tsx` + rota `/backoffice/retry-queue` + link no menu.
7. Ajuste no `expense-integration-retry` para delegar à fila.
