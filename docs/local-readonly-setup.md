# PostgreSQL local independente — 28/09/2026

O ambiente usa apenas o banco local. A configuração com credenciais da réplica Supabase foi removida; não há importação, sincronização nem acesso remoto configurado. O script de inspeção remoto não funciona sem seu arquivo de configuração e não possui mais target no Makefile.

## Acesso

- PostgreSQL: `127.0.0.1:54322`
- Banco: `postgres`
- Usuário: `postgres`
- Senha: campo `POSTGRES_PASSWORD` em `docker/.env` (local, ignorado pelo Git, permissão 0600).
- Terminal: `make qa-local-shell` (usa psql do container, dispensa instalação no host).
- Iniciar serviços: `make qa-isolated-up`.
- Estado: `make qa-isolated-status`.
- Frontend: `http://127.0.0.1:8080`, comando `make dev-local`.
- API Auth/REST local: `http://127.0.0.1:8000`.

O banco está disponível para leitura e escrita locais. Nenhum dado remoto foi importado. O schema de negócio do ERP ainda não foi aplicado; isso e o provisionamento de usuário da aplicação são etapas separadas. Auth/REST estão iniciados, mas isso não significa que o ERP já esteja funcional com dados.

## Isolamento

PostgreSQL, Auth e REST estão somente na rede Docker interna, sem saída externa. Kong expõe as portas em loopback e encaminha TCP 54322 para o banco isolado; participa também da rede de ingresso. As rotas HTTP apontam somente para Auth/REST locais. Não há Edge Functions, jobs de cron, Storage ou integrações externas em execução. O frontend aponta exclusivamente para a API local.

Os arquivos `.env.development.local`, `docker/.env`, `docker/docker-compose.local.yml` e `docker/local/` são locais e ignorados pelo Git. Não usar `make qa-up` para este perfil: esse target antigo não aplica o override de isolamento.

## Preparação já realizada

Docker Desktop corrigido desativando Rosetta, com backup das configurações em `settings-store.before-erp-local.json` no diretório do Docker. Dependências instaladas com `bun install --frozen-lockfile`. PostgreSQL 15.6 inicializado, roles e senhas locais ajustadas e search_path do Auth corrigido. Esses ajustes estão no volume atual; este documento não descreve ainda um instalador completo para volume vazio.
