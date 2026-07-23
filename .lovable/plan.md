# Fase 2 — Portabilidade para AWS

Objetivo: preparar o ERP Flow para rodar fora do Lovable Cloud (alvo AWS) com perdas mínimas, mantendo a versão atual 100% funcional. Nada de rewrite — só abstração, documentação e infraestrutura opcional.

## Escopo

### 1. Abstração de dependências Lovable/Supabase
- Criar `src/lib/backend/` com contratos (`AuthProvider`, `StorageProvider`, `DbProvider`, `FunctionsInvoker`).
- Implementação default: `supabase-impl.ts` (proxy do client atual — zero mudança de comportamento).
- Refatorar 3-5 pontos de entrada principais (auth, invoke, storage) para usarem os contratos. Restante segue direto no cliente Supabase por ora (migração incremental futura).
- Nenhum edge function reescrito. Apenas documentados os `Deno.env` usados.

### 2. Camada de configuração unificada
- `src/config/runtime.ts` centraliza URLs/keys lidas de `import.meta.env`.
- Documenta mapeamento das envs equivalentes na AWS:
  - `VITE_SUPABASE_URL` → PostgREST/Hasura ou API Gateway
  - `VITE_SUPABASE_PUBLISHABLE_KEY` → JWT público (Cognito/Auth0)
  - Edge Functions → Lambda + API Gateway (mesmo path `/functions/v1/<name>`)

### 3. Backup automatizado do banco (Lovable Cloud → S3)
- Nova edge function `db-backup-s3` (agendada via cron diário):
  - Faz `pg_dump` lógico dos schemas `public` (via SQL `COPY` por tabela — pg_dump não roda em edge).
  - Alternativa: usar as views/tabelas listadas via `information_schema` e exportar cada uma como JSONL.
  - Faz upload multipart para bucket S3 (via AWS SDK v3 `npm:@aws-sdk/client-s3`).
  - Retenção: 30 dias diários + 12 mensais.
- Segredos novos (build/edge): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BACKUP_BUCKET`.
- UI: card em `/backoffice` mostrando último backup (data, tamanho, status) + botão "Rodar agora".

### 4. Export de storage (anexos de despesas)
- Função `storage-mirror-s3` (agendada semanal): copia buckets Supabase Storage → S3 mantendo prefix por empresa. Idempotente (compara `etag`).

### 5. Documentação `docs/aws-portability.md`
- Diagrama alvo (Frontend S3+CloudFront, API Gateway+Lambda, RDS Postgres, Cognito, S3 anexos).
- Mapeamento 1:1 de cada edge function → Lambda equivalente.
- Passo a passo do restore: baixar dump do S3, `psql -f`, apontar env vars.
- Lista de gaps conhecidos (ex: `pg_cron`, `pg_net`, RLS policies — todos portáveis para RDS + Postgres nativo).

### 6. Health check consolidado
- Nova rota `/backoffice/infra-health` com status de: DB, Storage, Edge Functions ativas, Backups S3, HanaAPI V2, SAP Service Layer por empresa.

## Fora de escopo (fica para Fase 3)
- Docker local / seed sintético.
- Migração real de auth para Cognito.
- CI/CD Terraform.

## Detalhes técnicos

- Backups usam `SUPABASE_SERVICE_ROLE_KEY` já disponível no edge runtime.
- Tabelas grandes (`expenses`, `expense_items`, `expense_approval_log`, `pagcorp_integration_log`, `sap_integration_log`) exportadas em chunks de 10k linhas via `range()`.
- Formato JSONL comprimido gzip → `s3://<bucket>/daily/YYYY-MM-DD/<schema>.<table>.jsonl.gz`.
- Manifest `manifest.json` no mesmo prefix lista tabelas, contagem, checksum sha256.
- `db-backup-s3` grava resultado em nova tabela `infra_backup_log` (RLS: apenas super-admin lê).

## Ordem de execução
1. Migration `infra_backup_log` + RLS.
2. Segredos AWS (via `add_secret` — pediremos ao usuário).
3. Edge function `db-backup-s3` + agendamento diário 03:00 UTC.
4. Edge function `storage-mirror-s3` + agendamento semanal.
5. UI backoffice (card status + botão manual + página health).
6. Abstração `src/lib/backend/` (refactor não-destrutivo).
7. Documentação `docs/aws-portability.md`.

## Perguntas antes de começar
1. Você já tem uma conta AWS + bucket S3 dedicado para backups, ou quero deixar o código pronto e você provisiona depois?
2. Frequência do backup do banco: diário 03:00 UTC OK, ou prefere outra janela?
3. Anexos (storage): mirror semanal é suficiente ou quer contínuo (a cada upload)?
