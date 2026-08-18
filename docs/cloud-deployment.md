# Deploy portatil em GCP e AWS

Este perfil executa a mesma stack Docker em Compute Engine ou EC2. Ele e o
primeiro passo de migracao; Cloud Run, Cloud SQL, ECS e RDS exigem separar os
servicos persistentes e substituir extensoes PostgreSQL especificas.

## Arquitetura inicial

```text
Internet
   |
   | 80/443
   v
Caddy (TLS) ---> React/Nginx
   |
   +----------> Kong ---> Auth, PostgREST, Storage, Realtime, Edge Functions
                              |
                              v
                         PostgreSQL 15

Edge Functions -- HTTPS publico --> SAP B1 e demais integracoes
```

O frontend e as APIs usam o mesmo dominio. Apenas Caddy publica portas. As
portas de Postgres, Kong, Studio e servicos Supabase permanecem em
`127.0.0.1` ou somente nas redes Docker.

## Requisitos

- VM Linux `amd64` com 4 vCPU, 16 GB RAM e SSD de 80 GB.
- Docker Engine com Compose v2.
- IP publico estatico.
- DNS `A` apontando o dominio para o IP da VM.
- Firewall liberando TCP 80/443; SSH apenas a partir dos IPs administrativos.
- Bucket privado para backups, opcional no primeiro boot mas obrigatorio antes
  de operar dados reais.

## Configuracao

```bash
cp docker/.env.cloud.example docker/.env.cloud
chmod 600 docker/.env.cloud
```

Preencha os valores e gere JWTs assinados com o `JWT_SECRET` do ambiente:

```bash
make cloud-jwt
```

Copie as duas linhas geradas para `docker/.env.cloud`. Depois valide e suba:

```bash
make cloud-preflight
make cloud-up
make cloud-migrate
make cloud-status
make cloud-smoke
```

## Rotacao de credenciais expostas

Antes do primeiro deploy, revogue no provedor a chave JumpCloud e o token de
WhatsApp que existiam em commits anteriores. Crie valores novos no Secret
Manager da GCP ou Secrets Manager da AWS e injete-os somente pelo arquivo de
ambiente protegido da VM. Remover o valor do arquivo atual nao invalida a
credencial antiga.

Depois da revogacao, reescreva o historico do repositorio com `git filter-repo`
em uma janela coordenada, force-push em todas as refs afetadas e exija novo
clone dos colaboradores. Nao reutilize nenhum segredo que tenha aparecido no
historico. A migration de sanitizacao protege novos bancos, mas nao substitui
a revogacao no JumpCloud e no provedor de WhatsApp.

O `cloud-preflight` bloqueia login fake, HTTP, placeholders e integracao SAP
habilitada sem os segredos obrigatorios. `cloud-migrate` e destinado a um banco
novo: ele aplica schema, ignora reconciliacoes ligadas a dados produtivos e
remove agendamentos que apontavam para o projeto Supabase anterior. Para um
banco restaurado, siga o procedimento de restore e nao reaplique todo o
historico automaticamente.

## GCP Compute Engine

Configuracao inicial recomendada:

- Regiao `southamerica-east1`.
- `e2-standard-4`, Ubuntu LTS e Persistent Disk balanced de 80 GB.
- IP externo estatico associado a VM.
- Regras de ingress TCP 80/443; porta 22 limitada ou acesso via IAP.
- Service Account com permissao apenas para o bucket de backup e monitoramento.

Para backup em Cloud Storage:

```dotenv
BACKUP_TARGET=gcs
BACKUP_BUCKET_URI=gs://nome-do-bucket/erp-flow
```

Instale e autentique o `gcloud` no host com a Service Account da VM. Nao grave
uma chave JSON no repositorio ou na imagem.

## AWS EC2

Configuracao inicial recomendada:

- Regiao `sa-east-1`.
- `t3a.xlarge`, Ubuntu LTS e EBS gp3 de 80 GB.
- Elastic IP associado a instancia.
- Security Group com TCP 80/443; porta 22 limitada ou acesso via SSM.
- Instance Profile com permissao apenas para o bucket de backup e CloudWatch.

Para backup em S3:

```dotenv
BACKUP_TARGET=s3
BACKUP_BUCKET_URI=s3://nome-do-bucket/erp-flow
```

Use o Instance Profile para o AWS CLI. Nao configure access keys permanentes
na VM quando a role da instancia puder ser usada.

## SAP sem VPN

Nesta fase, as Edge Functions acessam o SAP por HTTPS publico.

1. Configure `SAP_CONNECTIVITY_MODE=public`.
2. Use somente uma URL `https://` em `SAP_DEFAULT_BASE_URL`.
3. Cadastre o IP estatico da VM na allowlist do firewall/middleware SAP.
4. Restrinja o endpoint SAP as rotas necessarias e aplique rate limit.
5. Mantenha credenciais separadas por empresa no modulo de credenciais.
6. Comece com `INTEGRATIONS_MODE=disabled`; habilite somente depois do smoke
   test e de validar uma empresa piloto.

O IP de saida e o IP estatico da propria VM. Se a arquitetura futura mover as
Functions para Cloud Run ou Fargate em sub-rede privada, sera necessario
Cloud NAT ou NAT Gateway para preservar um IP de allowlist.

## Google OAuth

Cadastre no Google Cloud Console:

```text
https://SEU_DOMINIO/auth/v1/callback
```

Depois configure `GOOGLE_AUTH_ENABLED=true`, `GOOGLE_CLIENT_ID` e
`GOOGLE_CLIENT_SECRET`. Mantenha `AUTH_DISABLE_SIGNUP=true` quando apenas
usuarios previamente provisionados puderem entrar.

## Backup e operacao

```bash
make cloud-backup
make cloud-logs
make cloud-status
```

O backup inclui os schemas `public`, `auth`, `storage` e o ledger de migrations,
preservando owners e permissoes. Tambem inclui roles sem senhas e, quando
suportado pela imagem, o volume do Storage. Agende `make cloud-backup`
diariamente com systemd timer ou cron e combine-o com snapshots do disco. Um
backup so e considerado valido depois de um restore testado em outra VM.

Em uma stack cloud nova e vazia, restaure um diretorio de timestamp com:

```bash
CLOUD_RESTORE_FROM=docker/backups/AAAAMMDDTHHMMSSZ \
CLOUD_RESTORE_CONFIRM=restore-erp-flow \
make cloud-restore
make cloud-smoke
```

O comando valida checksums, preserva as extensoes internas do destino, restaura
o banco e os arquivos do Storage e reinicia os servicos. Nao o execute sobre um
ambiente que ainda precise dos dados atuais.

Os jobs antigos de `pg_cron` ficam desabilitados neste perfil, inclusive os que
continham URLs fixas do Supabase gerenciado. Migre cada agenda validada para um
systemd timer/cron do host agora e, posteriormente, para Cloud Scheduler ou
EventBridge.

Antes de habilitar producao:

- confirmar HTTPS e renovacao automatica do certificado;
- executar restore de teste;
- configurar alertas de disco, RAM, CPU e indisponibilidade;
- confirmar que `VITE_ENABLE_FAKE_AUTH=false`;
- rotacionar todos os segredos que tenham sido usados localmente;
- validar SAP com uma unica empresa e liberar as demais gradualmente.

## Evolucao posterior

O perfil mantem frontend, URLs e segredos configuraveis por ambiente. Isso
permite mover primeiro o frontend/API para Cloud Run ou ECS. O PostgreSQL deve
permanecer na VM ate que usos de `pg_net`, `pgsodium` e Vault sejam removidos
ou substituidos por Scheduler/EventBridge e Secret Manager/Secrets Manager.
