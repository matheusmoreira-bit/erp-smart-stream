## Objetivo

Permitir que o sistema externo acesse a `external-approvals-api` sem ser bloqueado pelo Cloudflare Access que protege `erp-flow.cactuscorporation.com`, usando a URL direta da infra do Lovable Cloud.

## Mudança

Nenhuma mudança de código ou configuração de backend é necessária — a Edge Function já está deployada com `verify_jwt = false` e autenticação via `X-API-Key`. Apenas atualizar a documentação para instruir o sistema externo a usar a URL direta do Supabase.

### URL antiga (bloqueada pelo Cloudflare Access)
```
https://erp-flow.cactuscorporation.com/functions/v1/external-approvals-api
```

### URL nova (acesso direto, sem Cloudflare)
```
https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/external-approvals-api
```

A autenticação continua a mesma:
- Header `X-API-Key: <EXTERNAL_APPROVALS_API_KEY>`
- Método `POST` com payload JSON (`op`, `company_db`, `user_code`, ...)

## Arquivo a editar

- `docs/external-approvals-api.md`
  - Substituir a URL base por `https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/external-approvals-api`
  - Adicionar uma nota explicando: **não usar** o domínio customizado `erp-flow.cactuscorporation.com` porque ele está atrás do Cloudflare Access (Google Workspace SSO) e bloqueará chamadas server-to-server
  - Atualizar exemplos `curl` com a URL nova

## O que o outro sistema precisa fazer

1. Trocar a URL base nas chamadas para a URL do Supabase acima.
2. Continuar enviando o header `X-API-Key` que já possui.
3. Nenhum header do Cloudflare é necessário nessa rota.

## Por que isso funciona

A URL `*.supabase.co` aponta direto para a infra do Lovable Cloud e não passa pelo proxy Cloudflare que aplica a política de Access do workspace. A Edge Function valida a `X-API-Key` internamente, então a segurança é mantida.
