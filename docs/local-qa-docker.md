# QA Local com Docker — ERP Flow

Stack completo do Supabase self-hosted (Postgres, Auth, PostgREST, Storage,
Realtime, Edge Runtime, Studio, Kong) rodando em `docker compose`, com dados
carregados a partir do dump produtivo gerado pela edge function `db-backup-s3`
(Fase 2 — Portabilidade AWS).

## Aviso importante

Você optou por importar o dump **sem mascaramento**. Isso significa que
**dados reais de clientes, valores financeiros, credenciais SAP e e-mails**
estarão no seu Postgres local. Consequências obrigatórias:

- Não subir o volume `qa-db-data` para lugar nenhum.
- Não expor as portas do compose para fora de `127.0.0.1` (já vem assim).
- Manter `INTEGRATIONS_MODE=disabled` no `.env` — o Edge Runtime local
  não deve conseguir chamar SAP/OMIE/PagCorp/JumpCloud/Google/SMTP.
- Rodar `make qa-nuke` ao encerrar o QA para não deixar dados esquecidos.

## Pré-requisitos

- Docker Desktop (ou Docker Engine + Compose v2)
- `awscli` (para `make qa-seed`) — com credenciais de leitura no bucket
- `psql` local (opcional — dá para usar o do container com `docker exec`)
- `python3` + `pip install pyjwt` (para gerar chaves JWT)

## Setup inicial (uma vez)

```bash
# 1. Configuração local
cp docker/.env.example docker/.env
$EDITOR docker/.env         # troque POSTGRES_PASSWORD, JWT_SECRET, SECRET_KEY_BASE

# 2. Gera ANON_KEY e SERVICE_ROLE_KEY a partir do JWT_SECRET
make qa-jwt
# Copie a saída para docker/.env (linhas ANON_KEY e SERVICE_ROLE_KEY)

# 3. Sobe o stack
make qa-up
docker ps                    # confira que erp-qa-* estão healthy

# 4. Popula com dump de produção (mais recente)
make qa-seed
# ou uma data específica:
make qa-seed DATE=2026-07-22
```

Após isso o QA está pronto:

| Serviço            | URL                          |
| ------------------ | ---------------------------- |
| API (compat. app)  | `http://localhost:8000`      |
| Studio (admin UI)  | `http://localhost:54323`     |
| Postgres           | `localhost:54322` (`postgres`) |
| Storage direto     | `http://localhost:5000`      |
| Edge Functions     | `http://localhost:54325`     |

## Apontar o app para o QA local

Crie um `.env.local` (não commite) na raiz do projeto:

```
VITE_SUPABASE_URL=http://localhost:8000
VITE_SUPABASE_PUBLISHABLE_KEY=<seu ANON_KEY do docker/.env>
VITE_SUPABASE_PROJECT_ID=qa-local
```

`bun run dev` — o app agora conversa com o Postgres local em vez de
produção.

## Comandos frequentes

```bash
make qa-status              # status dos containers
make qa-logs                # tail agregado
make qa-shell               # abre psql no banco QA
make qa-migrate             # reaplica supabase/migrations/*.sql
make qa-down                # desliga (mantém volume)
make qa-nuke                # desliga e APAGA volume (reset total)
```

## Edge Functions — kill-switch de integrações

Todas as ~80 edge functions do repositório são montadas em
`/home/deno/functions` (read-only) e servidas pelo Edge Runtime local.
O container recebe `INTEGRATIONS_MODE=disabled` — funções que fazem HTTP
externo (SAP Service Layer, HanaAPI, PagCorp, JumpCloud, OMIE, Google,
SMTP, LovableAI) devem verificar essa flag e recusar antes de sair para a
rede:

```typescript
if (Deno.env.get("INTEGRATIONS_MODE") === "disabled") {
  return new Response(
    JSON.stringify({ error: "external_integrations_disabled_in_qa" }),
    { status: 503, headers: corsHeaders },
  );
}
```

Uma tarefa de acompanhamento é anotar essa guarda em cada função de
integração — hoje, se `INTEGRATIONS_MODE=disabled` e o segredo é o
placeholder, a função apenas falha na autenticação externa, o que também
é seguro, mas menos explícito.

## Restore inverso — subir alterações do QA para prod

O QA local é somente de leitura estruturada. Alterações validadas devem
ser reproduzidas em produção via:

1. Migrations no repositório (`supabase/migrations/`) — aplicadas pelo
   fluxo normal do Lovable Cloud.
2. Scripts de dados: gerar SQL idempotente e revisá-lo antes de rodar em
   produção via `supabase--insert` / `supabase--migration`.

**Nunca** despejar dados do QA de volta em prod — o QA pode ter side
effects de testes exploratórios.

## Troubleshooting

| Sintoma                                     | Provável causa / ação                                        |
| ------------------------------------------- | ------------------------------------------------------------ |
| Studio abre mas API responde 401            | `ANON_KEY` no `.env` divergente do `JWT_SECRET`. Rode `make qa-jwt` novamente e atualize. |
| `qa-seed` falha em uma tabela específica    | Coluna nova em prod ainda não migrada localmente. Rode `make qa-migrate`. |
| Edge function local devolve 500 em SAP      | Esperado com `INTEGRATIONS_MODE=disabled`. Não aponte para prod. |
| `pg_cron` reclamando em loop nos logs       | Rodar `make qa-seed` novamente — ele derruba todos cron jobs. |
| Porta 8000/54322 ocupada                    | Outro Supabase local rodando. `docker ps` e derrube o antigo. |
| Realtime não conecta                        | Verifique `SECRET_KEY_BASE` no `.env` — precisa 64+ chars.   |

## Roadmap

- [ ] Anotar guarda `INTEGRATIONS_MODE` em todas as edge functions de integração.
- [ ] Rotina `make qa-snapshot` que exporta o Postgres local para reuso em CI.
- [ ] Terraform reproduzindo o mesmo stack em EC2 para QA compartilhado.
