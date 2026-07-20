# HanaAPI — chamadas às views HANA do SAP B1

Duas variantes coexistem. A escolha é por empresa, via `system_credentials`.

- **V1 (middleware n8n)** — default. Webhook `HANA_VIEWS_URL` recebe query string + headers `X-*`.
- **V2 (servidor direto)** — opt-in por empresa. Basta cadastrar `hana_api_url` para aquela empresa que o helper `fetchHanaView` passa a chamar direto.

Helper compartilhado: `supabase/functions/_shared/hana-views.ts`.
Consumidores atualizados: `sap-suppliers-hana`, `sap-purchase-orders-hana`, `sap-fluxo-analise-sync`.

## Passo comum — Login no Service Layer (SessionId)

```
POST {service_layer_url}/b1s/v2/Login
Content-Type: application/json

{ "UserName": "Apiuser", "Password": "…", "CompanyDB": "SBO_OPENGAMING" }
```

- Body: `{ "SessionId": "<GUID>", "SessionTimeout": 30 }`.
- Header `Set-Cookie`: `B1SESSION=…; B1ROUTEID=…`.
- Sessão ≈ 30 min. Reuse enquanto válida.

## Passo comum — DynamicToken (mesmo algoritmo nas duas versões)

1. `now = floor(Date.now()/1000)`
2. `hourBlock = floor(now / 3600)`
3. `msg = String(hourBlock)`
4. `sig = HMAC_SHA256(SAP_MIDDLEWARE_SECRET, msg)`
5. `DynamicToken = hex(sig)` — 64 chars, lowercase.

Renovar a cada virada de hora UTC.

Postman Pre-request Script:
```javascript
const secret    = pm.environment.get("SAP_MIDDLEWARE_SECRET");
const hourBlock = Math.floor(Date.now() / 1000 / 3600).toString();
const sig       = CryptoJS.HmacSHA256(hourBlock, secret);
pm.variables.set("DynamicToken", CryptoJS.enc.Hex.stringify(sig));
```

## V1 — via middleware n8n

```
GET {HANA_VIEWS_URL}
    ?SessionId={SessionId}
    &DB={schema}
    &Schema={schema}
    &View={view}
    &DynamicToken={DynamicToken}
    &_t={epoch_ms}
Headers:
  X-SessionId:     {SessionId}
  X-DB:            {schema}
  X-Schema:        {schema}
  X-View:          {view}
  X-Dynamic-Token: {DynamicToken}
```

## V2 — direto no servidor de origem (sem middleware)

```
GET {hana_api_url}/data/{SCHEMA}.{VIEW}
Headers:
  dynamictoken: {DynamicToken}
  sessionid:    {SessionId}
```

Sem query string, headers em lowercase. Exemplo Open Gaming:

```
GET http://201.48.79.205:8001/data/OPENGAMING.VW_APROVACOES_DETALHADAS
```

`curl` equivalente:
```bash
curl -s "http://201.48.79.205:8001/data/OPENGAMING.VW_FORNECEDORES" \
  -H "dynamictoken: $DYNAMIC_TOKEN" \
  -H "sessionid: $SESSION_ID"
```

## Como habilitar V2 numa empresa

Inserir uma credencial em `public.system_credentials`:

```sql
INSERT INTO public.system_credentials (system_name, company_db, credential_key, credential_value)
VALUES ('sap', '<company_db>', 'hana_api_url', 'http://IP:PORT')
ON CONFLICT (system_name, company_db, credential_key)
DO UPDATE SET credential_value = EXCLUDED.credential_value, updated_at = now();
```

- Se `hana_api_url` está setado e não vazio → helper usa V2.
- Se não está setado → helper mantém V1 (n8n).

## Schema HANA vs CompanyDB

Em algumas empresas o schema publicado difere do `CompanyDB`. Overrides atuais nas edge functions:

| CompanyDB         | Schema HANA  |
| ----------------- | ------------ |
| `open_gaming_sa`  | `OPENGAMING` |

Nas demais, `schema = CompanyDB`.

## Formato de resposta (V1 e V2)

O parser (`hana-views.ts`) aceita:
- `[ { data: [ {row}, … ] }, … ]`
- `[ {row}, … ]`
- `{ data: [ {row}, … ] }`

## Logout (opcional)

```
POST {service_layer_url}/b1s/v2/Logout
Cookie: B1SESSION={SessionId}; B1ROUTEID={B1ROUTEID}
```

## Erros comuns

- **401/403 no middleware ou servidor** → token fora do bloco de hora, secret errado, usuário ≠ `Apiuser`.
- **Empresa cai em `hana_unavailable`** → não tem `use_hana_db=true` ou `username=Apiuser` em `system_credentials`.
- **`value: []`** → view ou coluna inexistente naquele schema; conferir override de schema.
