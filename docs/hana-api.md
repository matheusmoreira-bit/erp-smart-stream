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

## Sondagem do gateway (jul/2026) — acesso a qualquer schema/tabela

O HanaAPI é um "Universal Database Gateway" (FastAPI). `GET /openapi.json` expõe:
`/health`, `/metrics`, `/databases`, `/data/{object}`, `/data/{db}/{object}`,
`/execution-logs`, `/executions`. Parâmetros de `/data`: `schema`, `limit`,
`offset`, `CampoData`/`DataInicio`/`DataFim` e filtros livres `Campo__op`.

Confirmado: **não há allowlist de tabelas**. Qualquer schema/tabela é legível,
inclusive `SYS.TABLES`, `SYS.M_TABLES` e `SYS.TABLE_COLUMNS` (ótimos para
descobrir estrutura). Não existe seleção de colunas nem SQL livre.

### Limitação encontrada: colunas BLOB

- Colunas **NCLOB** retornam normalmente (ex.: `TX_RNF_*.XmlDeEnvio`).
- Qualquer linha com coluna **BLOB** faz o gateway responder **HTTP 500**.
  É o caso de `SBO_TaxOne.DocHist` (`XmlFile`, `XmlEnvio`, `XmlRetorno`),
  que é onde ficam os XMLs autorizados da NFS-e.

### Sobre o PDF da NFS-e

- Não existe nenhuma tabela de PDF/DANFSe no `SBO_TaxOne` (busca por
  `%pdf%`, `%danf%`, `%arquiv%`, `%anexo%` → nada).
- `Doc.LinkImpressao` está nulo em todas as notas.
- Os arquivos vão para um share Windows: `SettingEntityEnv."PathXml "`
  (ex.: `\\wy-db-hana\B1_SHF\SHARED_SAP\CACTUS\Fiscal\NFSe\XML`).

### Como destravar (pedido para a infra)

Criar uma view no HANA convertendo o BLOB em texto, que o gateway já sabe
serializar:

```sql
CREATE VIEW SBO_TaxOne.VW_NFSE_XML_AUTORIZADO AS
SELECT BatchId, KeyNfe, SerialNfSe, Evento, StatusId, DateReturn,
       BINTOSTR(XmlFile)  AS XmlFileTexto,
       BINTOSTR(XmlRetorno) AS XmlRetornoTexto
  FROM SBO_TaxOne.DocHist;
```

Com essa view, o ERP Flow lê o XML autorizado direto pelo HanaAPI V2 e passa a
gerar/anexar o documento no fluxo de e-mail da NFS-e sem upload manual.
