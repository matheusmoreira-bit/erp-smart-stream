# Runbook — Backup e Restauração (F07)

Nenhuma senha, token ou string de conexão deve ser escrita neste documento.

## Camadas de backup
1. **Backup gerenciado da plataforma (primário)** — diário, automático, no próprio banco em nuvem. Restauração solicitada pela área de Cloud/suporte da plataforma. PITR depende do plano contratado.
2. **Backup lógico cifrado no S3 (secundário, fora da plataforma)** — função `db-backup-s3`:
   - todas as tabelas `public` (inclusive `audit_trail`/`audit_trail_archive`), exceto `sap_cache` (reconstruível);
   - contas de login (`auth.users`, sem hashes de senha — as pessoas voltam via Google/Okta ou convite);
   - partes JSONL gzip cifradas com AES-256-GCM (`BACKUP_ENC_KEY`), hash SHA-256 por parte no `manifest.json`;
   - SSE-S3 e Object Lock COMPLIANCE por `BACKUP_OBJECT_LOCK_DAYS` dias.
3. **Anexos** — `storage-mirror-s3` (SSE-S3).
4. **Google Drive** — `backup-to-gdrive` **pausado** (job 69 inativo) desde 24/09/2026.

## Acesso às funções
Todas exigem segredo do agendador (`x-scheduler-secret`), service role ou administrador. Chamadas anônimas recebem 401.

## Pré-requisitos do bucket (AWS)
- Bucket dedicado com **Versionamento** e **Object Lock** ligados na criação.
- Usuário IAM só com `s3:PutObject`, `s3:PutObjectRetention`, `s3:GetObject`, `s3:ListBucket` nesse bucket (sem `DeleteObject`).
- Secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BACKUP_BUCKET`, `AWS_REGION`, `BACKUP_OBJECT_LOCK_DAYS` (ex.: 35).
- `BACKUP_ENC_KEY` já gerada. Guardar uma cópia fora da plataforma (cofre corporativo) — sem ela o backup não abre.

## Restauração (teste trimestral obrigatório)
1. Baixar a pasta `daily/<data>/<carimbo>/` do S3 para uma máquina controlada.
2. Conferir integridade: `BACKUP_ENC_KEY=… deno run -A scripts/backup-restore.ts <pasta> --verify-only`.
3. Restaurar num banco **de teste** (nunca produção): mesmo comando sem `--verify-only`, com `TARGET_DB_URL` apontando ao banco com o schema já aplicado (migrações).
4. Conferir contagens por tabela contra o `manifest.json` e abrir o app apontado ao banco de teste.
5. Registrar data, responsável, duração e resultado na tabela abaixo.

| Data | Responsável | Backup usado | Resultado | Duração |
|------|-------------|--------------|-----------|---------|
| — | — | — | pendente (bucket ainda não configurado) | — |

## Pendências conhecidas
- Senha do banco de réplica foi exposta em chat: trocar.
- Rotina `audit-console-monthly` tem o segredo do agendador escrito no agendamento: mover para leitura segura e trocar `SCHEDULER_SECRET`.
- Limite de tempo das funções: bases muito grandes podem exigir rodar por grupos de tabelas (`{"tables":[...]}`).
