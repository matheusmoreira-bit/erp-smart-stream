# ERP Flow

Aplicação corporativa para compras, vendas, aprovações, cartões, cadastros,
financeiro e auditoria, integrada ao SAP Business One. O frontend usa React,
Vite e Supabase; integrações privilegiadas vivem em Edge Functions.

## Desenvolvimento

Requisitos: Node.js 22, npm e Docker com Compose.

```bash
npm ci
npm run dev
```

Comandos de qualidade:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Testes de RLS remotos são desabilitados por padrão. Eles exigem
`VITE_RUN_RLS_TESTS=true`, `VITE_RLS_TEST_URL` e
`VITE_RLS_TEST_PUBLISHABLE_KEY` apontando para um ambiente não produtivo.

## Stand-alone

O modo stand-alone sobe Postgres/Supabase local, autenticação fake restrita ao
loopback e dados sintéticos. Ele não baixa dumps nem sobe Edge Runtime.

```bash
make standalone-up
```

Serviços:

- Aplicação: `http://127.0.0.1:8080`
- API local: `http://127.0.0.1:8000`
- Postgres: `127.0.0.1:54322`

Use `make standalone-down` para parar e `make standalone-nuke` para apagar o
volume local. Operações de catálogo suportadas são persistidas no banco local;
integrações externas sem adapter local respondem explicitamente como
indisponíveis.

## QA Local

O stack de QA está em `docker/docker-compose.yml`. Ele pode carregar dados
sensíveis e, por isso, usa uma rede Docker interna sem saída para a internet.
Nunca remova esse isolamento para testar com dump produtivo.

## Arquitetura

- `src/pages`: rotas e fluxos de tela.
- `src/hooks`: acesso a dados e estado dos módulos.
- `src/lib`: clientes compartilhados, autenticação e regras de domínio.
- `supabase/functions`: integrações e operações privilegiadas.
- `supabase/migrations`: schema, RLS e funções PostgreSQL.
- `docker`: stacks stand-alone e QA.
- `docs`: contratos de API, operação e decisões técnicas.

Novas chamadas de Edge Functions devem usar `authFetch`, `sapFunctionFetch` ou
`invokeFn`. Endpoints que usam `service_role` precisam validar a identidade no
handler, mesmo quando `verify_jwt` estiver habilitado.
