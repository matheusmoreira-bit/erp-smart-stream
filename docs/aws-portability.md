# Portabilidade AWS — ERP Flow

Este documento descreve como o ERP Flow pode ser migrado do Lovable Cloud
(Supabase gerenciado) para uma stack AWS mantendo funcionalidade equivalente.
A intenção é operar em Lovable Cloud como default e usar AWS como saída
estratégica sem rewrite.

## 1. Arquitetura alvo

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CloudFront + S3 (SPA)                         │
└────────────────┬─────────────────────────────────────────────────────┘
                 │ HTTPS
┌────────────────▼──────────────┐     ┌──────────────────────────┐
│  API Gateway  +  Lambda(s)    │────▶│   RDS Postgres (Multi-AZ)│
│  (uma Lambda por edge fn)     │     │   + PostgREST/Hasura     │
└────────────────┬──────────────┘     └────────────┬─────────────┘
                 │                                 │ pg_dump semanal
                 │                                 ▼
                 │                       ┌──────────────────┐
                 │                       │  S3 (backups)    │
                 │                       └──────────────────┘
                 │
                 ▼
      ┌────────────────────┐    ┌────────────────────┐
      │  Cognito (Auth)    │    │  S3 (anexos)       │
      │  + Google OAuth    │    │  presigned URLs    │
      └────────────────────┘    └────────────────────┘
```

## 2. Mapeamento de dependências

| Lovable Cloud (hoje)             | AWS (alvo)                                |
| -------------------------------- | ----------------------------------------- |
| `supabase.auth`                  | Cognito User Pool + Hosted UI             |
| `supabase.from(...)`             | PostgREST ou Hasura sobre RDS             |
| `supabase.storage`               | S3 + presigned URLs                       |
| `supabase.functions.invoke(fn)`  | API Gateway → Lambda                      |
| `pg_cron` (agendamento)          | EventBridge scheduled rules → Lambda      |
| `pg_net` (HTTP do banco)         | Chamar Lambda em vez do banco             |
| Realtime                         | AppSync (GraphQL subscriptions) ou WS     |
| RLS policies                     | RLS nativo do Postgres (portável 1:1)     |
| `VITE_SUPABASE_URL/KEY`          | `VITE_BACKEND_URL / VITE_PUBLIC_JWT`      |

## 3. Camada de abstração

Criada em `src/lib/backend/`:

- `types.ts` — contratos (`AuthProvider`, `StorageProvider`, `FunctionsInvoker`)
- `supabase-impl.ts` — implementação atual, proxy fino
- `index.ts` — exporta `backend` conforme `runtime.target`

Novos consumidores devem usar `import { backend } from "@/lib/backend"`.
O código legado que usa `supabase` diretamente continua funcionando; a
migração é incremental.

Para migrar para AWS, criar `aws-impl.ts` que implementa os mesmos contratos
com AWS Amplify / SDK e trocar o export em `index.ts` conforme
`VITE_BACKEND_TARGET`.

## 4. Backups automáticos (já implementados)

### Banco (`db-backup-s3`)
- Dump lógico do schema `public` em JSONL gzip por tabela.
- Sobe cada arquivo para `s3://<bucket>/daily/YYYY-MM-DD/<tabela>.jsonl.gz`.
- Manifest com contagem e sha256 em `manifest.json`.
- Tabelas grandes/de log (`audit_trail`, `sap_cache`, `integration_log`,
  `permission_shadow_log`) são puladas — têm suas próprias rotinas.

### Storage (`storage-mirror-s3`)
- Espelha buckets `expense-attachments` e `receipts` para S3.
- Idempotente: só re-envia se tamanho diferente.

### Ativação
1. Adicionar em Cloud → Secrets:
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
   - `AWS_REGION` (ex: `us-east-1`)
   - `AWS_S3_BACKUP_BUCKET` (nome do bucket)
2. Criar bucket S3 dedicado com versionamento + lifecycle:
   - `daily/*` retenção 30 dias
   - `monthly/*` retenção 12 meses
3. Agendar via pg_cron:
   ```sql
   SELECT cron.schedule('db-backup-daily', '0 6 * * *', $$
     SELECT net.http_post(
       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/db-backup-s3',
       headers := jsonb_build_object('Content-Type','application/json',
         'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='email_queue_service_role_key')),
       body := '{}'::jsonb) $$);

   SELECT cron.schedule('storage-mirror-weekly', '0 7 * * 0', $$
     SELECT net.http_post(
       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/storage-mirror-s3',
       headers := jsonb_build_object('Content-Type','application/json',
         'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='email_queue_service_role_key')),
       body := '{}'::jsonb) $$);
   ```
4. Monitorar em `/backoffice/infra-health`.

## 5. Procedimento de restore (dry-run trimestral)

1. Provisionar RDS Postgres 15+ vazio.
2. Aplicar migrations do repo (`supabase/migrations/*.sql`) em ordem.
3. Baixar último `manifest.json` do S3:
   `aws s3 cp s3://<bucket>/daily/YYYY-MM-DD/manifest.json .`
4. Para cada tabela do manifest:
   ```bash
   aws s3 cp s3://<bucket>/daily/YYYY-MM-DD/<tabela>.jsonl.gz - \
     | gunzip \
     | psql "$RDS_URL" -c "COPY <tabela> FROM STDIN WITH (FORMAT text)"
   ```
   (script `scripts/restore-from-s3.sh` a produzir na Fase 3.)
5. Restaurar buckets Storage: `aws s3 sync s3://<bucket>/storage/ ./restore/` e reimportar.
6. Rodar `VACUUM ANALYZE` e validar `SELECT count(*)` por tabela contra manifest.

## 6. Gaps conhecidos

| Item                     | Portabilidade | Nota |
|--------------------------|--------------|------|
| `pg_cron`                | ✅ nativo    | Também disponível em RDS (extensão). |
| `pg_net`                 | ⚠️ substituir| Chamar Lambda direto em vez do DB. |
| Supabase Realtime        | ⚠️ AppSync   | Poucas telas usam; migração pontual. |
| Vault (`decrypted_secrets`) | ⚠️ SSM   | Trocar por SSM Parameter Store / Secrets Manager. |
| `auth.users` FK          | ✅ Cognito   | Sub UUID vira `user_id` em `profiles`. |
| RLS policies             | ✅ nativo    | Portáveis sem alteração. |
| Edge Functions (Deno)    | ⚠️ Node      | Reescrever cada função como Lambda Node/TS (mesma lógica). |

## 7. Fora de escopo da Fase 2

- Terraform / IaC (Fase 3+).
- Migração real de Auth para Cognito (Fase 3+).
- Docker local para QA (Fase 3).
