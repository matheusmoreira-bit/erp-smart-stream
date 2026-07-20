# HanaAPI V2 — chamada direta ao servidor de origem

Nova variante das chamadas HANA que bate direto no servidor de origem, sem passar pelo webhook n8n (`HANA_VIEWS_URL`). V1 permanece funcionando; V2 é opt-in por empresa.

## Contrato do V2

```
GET {hana_api_base}/data/{SCHEMA}.{VIEW}
Headers:
  dynamictoken: {token}
  sessionid:    {SAP SessionId}
```

- `hana_api_base`: URL do servidor de origem por empresa (ex.: `http://201.48.79.205:8001`).
- Path `/data/{SCHEMA}.{VIEW}` (schema + view separados por ponto). Ex.: `/data/SBO_OPENGAMING.VW_APROVACOES_DETALHADAS`.
- Headers em lowercase (`dynamictoken`, `sessionid`) — V1 continua com `X-Dynamic-Token` / `X-SessionId` + query string.
- Sem query string. Sem `X-DB` / `X-View` / `X-Schema`.
- `dynamictoken`: mesmo algoritmo do V1 (`hex(HMAC_SHA256(SAP_MIDDLEWARE_SECRET, floor(now/3600)))`).
- `sessionid`: obtido via Login normal do Service Layer (`Apiuser` + `CompanyDB`).

## Seleção V1 vs V2 (por empresa)

Nova entrada em `system_credentials`:
- `system_name = 'sap'`, `company_db = '<db>'`, `credential_key = 'hana_api_url'`, `credential_value = 'http://IP:PORT'`.
- Presente e não vazio → V2 nessa empresa.
- Ausente → mantém V1 (n8n).

Sem alteração de schema. Zero risco para as empresas atuais até o cadastro ser feito.

## Mudanças no código

### 1. Helper compartilhado
`supabase/functions/_shared/hana-views.ts` — novo:
- Export `fetchHanaView({ sb, companyDb, schema, view, sessionId })`.
- Lê `hana_api_url` da `system_credentials`.
- V2: `GET {url}/data/{schema}.{view}` com headers `dynamictoken` + `sessionid`.
- V1 (fallback): usa `HANA_VIEWS_URL` + headers `X-*` + query string, como hoje.
- Parser unificado aceita `[{data:[…]}]`, `[…]`, `{data:[…]}`.
- Reaproveita `generateDynamicToken` do helper existente.

### 2. Refactor das edge functions HANA para usar o helper
Trocam `fetchView` local pelo helper (comportamento sem alteração quando `hana_api_url` não está setado):
- `supabase/functions/sap-suppliers-hana/index.ts`
- `supabase/functions/sap-purchase-orders-hana/index.ts`
- `supabase/functions/sap-fluxo-analise-sync/index.ts`
- `supabase/functions/sap-sl-cache-refresh/index.ts` (se usa view HANA — confirmar no read; caso não use, fica de fora)

### 3. Cadastrar Open Gaming como primeira empresa V2
Inserir/atualizar em `system_credentials`:
- `open_gaming_sa` → `hana_api_url = http://201.48.79.205:8001`.

O override de schema `open_gaming_sa → OPENGAMING` já existe e continua valendo — path fica `/data/OPENGAMING.VW_FORNECEDORES`, `/data/OPENGAMING.VW_PEDIDOS_COMPRA`, etc.

### 4. Documentação
Criar `docs/hana-api.md` com seções V1 e V2 (algoritmo do token, headers, exemplo curl e Postman).

## Fora de escopo desta entrega

- UI em Integrações para editar `hana_api_url` sem SQL (posso incluir num próximo passo).
- Migração das outras empresas para V2 (feita depois, uma a uma, cadastrando `hana_api_url`).

## Decisões que preciso confirmar antes de construir

1. **Secret do `dynamictoken` no V2**: usar o **mesmo** `SAP_MIDDLEWARE_SECRET` do V1, ou o servidor de origem valida com uma **chave diferente**? Se for diferente, crio o secret `SAP_HANA_API_SECRET` (via `add_secret`) e o helper prioriza ele quando existir.
2. **HTTP puro (`http://IP:8001`)**: confirmo que o servidor não expõe HTTPS? Edge Functions permitem chamada, mas quero registrar a decisão.
3. **Endpoint de teste**: posso testar contra `http://201.48.79.205:8001/data/SBO_OPENGAMING.VW_APROVACOES_DETALHADAS` durante a implementação, ou uso outra view/empresa como sanidade?

Confirmando esses três pontos, implemento em modo build.
