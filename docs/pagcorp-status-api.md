# PagCorp Transaction Status API — v1.0.0

API somente-leitura para que outro projeto consulte o **status das transações de cartão de crédito (PagCorp)** e o respectivo **lançamento no ERP (SAP Business One)**.

## 1. Visão geral

- Retorna, por transação, o status da integração no ERP Flow e em que estágio o documento está no SAP.
- Sempre devolve **o registro mais recente por transação** (deduplicação por `transactionId`).
- Somente leitura: não existe endpoint de escrita.

**O que a API deliberadamente NÃO expõe:** valores, fornecedor, número/portador do cartão, centro de custo, projeto, anexos, usuários, mensagens de erro internas ou qualquer PII.

## 2. Endpoint

| Item | Valor |
| --- | --- |
| Base URL | `https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1` |
| Recurso | `GET /pagcorp-status-api` |
| Contrato OpenAPI 3.1 | `GET /pagcorp-status-api?spec=openapi` (público, sem chave) |
| Swagger UI | `/docs/pagcorp-status-api.html` no site publicado |
| Versão | 1.0.0 |

CORS liberado para consumo servidor-a-servidor; `OPTIONS` respondido normalmente.

## 3. Autenticação

Header obrigatório:

```
x-api-key: <chave compartilhada>
```

- A chave é emitida pelo time do ERP Flow e guardada como **secret nos dois lados**.
- Comparação feita no servidor; chave ausente ou inválida → `401`.
- **Nunca** embarque a chave em código de front-end, repositório ou URL (query string). Use apenas header, a partir de um backend.
- Se o servidor estiver sem a chave configurada, a API responde `503`.
- O parâmetro `?spec=openapi` é a única rota que dispensa a chave (devolve apenas o contrato, sem dados).

## 4. Parâmetros de consulta

| Parâmetro | Tipo | Padrão | Descrição |
| --- | --- | --- | --- |
| `transactionId` | integer ≥ 1 | — | ID da transação PagCorp. Quando informado, a resposta é um **objeto único**. |
| `transactionIds` | string (máx. 2000 chars) | — | IDs separados por vírgula, **máx. 200**. Ignorado se `transactionId` for informado. |
| `companyDb` | string (máx. 64) | — | Filtra pela base da empresa no ERP (ex.: `PRD_ANAGAMING`). |
| `updatedSince` | date-time ISO 8601 UTC | — | Retorna apenas transações atualizadas a partir da data/hora. |
| `limit` | integer 1–200 | `50` | Tamanho da página. |
| `offset` | integer 0–100000 | `0` | Deslocamento para paginação. |
| `spec` | `openapi` | — | Devolve o documento OpenAPI (não requer chave). |

Parâmetros fora dos limites → `400` com o detalhe por campo.

## 5. Formato da resposta

- Com `transactionId`: objeto `Transaction` direto (ou `404` se não existir).
- Sem `transactionId`: `{ "count": <int>, "items": [Transaction, ...] }`, ordenado por `updatedAt` decrescente.

### Dicionário de campos

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `transactionId` | integer | ID da transação no PagCorp. |
| `status` | string | Status da integração no ERP Flow (`unknown` quando ausente). |
| `erp.stage` | enum | Estágio consolidado no SAP (ver abaixo). |
| `erp.purchaseOrderDocNum` | integer \| null | Nº do pedido de compra no SAP. |
| `erp.invoiceDocNum` | integer \| null | Nº da NF de entrada no SAP. |
| `erp.paymentDocNum` | integer \| null | Nº do pagamento/liquidação no SAP. |
| `erp.settlementStatus` | string \| null | Status bruto da liquidação. |
| `updatedAt` | date-time \| null | Última atualização do registro (UTC). |

### Como `erp.stage` é derivado

Avaliado nesta ordem, o primeiro que casar vence:

| Estágio | Condição |
| --- | --- |
| `settled` | `settlementStatus = "completed"` **ou** existe `paymentDocNum` |
| `invoiced` | existe `invoiceDocNum` |
| `posted` | existe `purchaseOrderDocNum` |
| `error` | `status` contém "error" **ou** `settlementStatus = "error"` |
| `not_posted` | nenhum dos anteriores |

Ou seja, o estágio é cumulativo: `settled` implica que as etapas anteriores já ocorreram.

## 6. Exemplos

Defina antes:

```bash
BASE="https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1"
KEY="<sua chave>"
```

### 6.1 Uma transação

```bash
curl -s "$BASE/pagcorp-status-api?transactionId=483921" -H "x-api-key: $KEY"
```

```json
{
  "transactionId": 483921,
  "status": "integrated",
  "erp": {
    "stage": "settled",
    "purchaseOrderDocNum": 2451,
    "invoiceDocNum": 8890,
    "paymentDocNum": 1204,
    "settlementStatus": "completed"
  },
  "updatedAt": "2026-07-28T19:41:02.113Z"
}
```

Transação inexistente:

```json
{ "error": "Not found" }
```

### 6.2 Várias transações (lote)

```bash
curl -s "$BASE/pagcorp-status-api?transactionIds=483921,483922" -H "x-api-key: $KEY"
```

```json
{
  "count": 2,
  "items": [
    {
      "transactionId": 483921,
      "status": "integrated",
      "erp": { "stage": "settled", "purchaseOrderDocNum": 2451, "invoiceDocNum": 8890, "paymentDocNum": 1204, "settlementStatus": "completed" },
      "updatedAt": "2026-07-28T19:41:02.113Z"
    },
    {
      "transactionId": 483922,
      "status": "pending",
      "erp": { "stage": "not_posted", "purchaseOrderDocNum": null, "invoiceDocNum": null, "paymentDocNum": null, "settlementStatus": null },
      "updatedAt": "2026-07-28T18:02:55.007Z"
    }
  ]
}
```

### 6.3 Filtro por empresa e paginação

```bash
curl -s "$BASE/pagcorp-status-api?companyDb=PRD_ANAGAMING&limit=100&offset=0" \
  -H "x-api-key: $KEY"
```

### 6.4 Sincronização incremental

Guarde o maior `updatedAt` recebido e use-o na próxima chamada:

```bash
curl -s "$BASE/pagcorp-status-api?updatedSince=2026-07-28T19:41:02.113Z&limit=200" \
  -H "x-api-key: $KEY"
```

### 6.5 Contrato OpenAPI

```bash
curl -s "$BASE/pagcorp-status-api?spec=openapi"
```

## 7. Códigos de status

| Código | Significado | Ação recomendada |
| --- | --- | --- |
| `200` | Consulta bem-sucedida | Processar payload. |
| `400` | Parâmetros inválidos | Corrigir a requisição; o corpo indica o campo. Não repetir igual. |
| `401` | Chave ausente/inválida | Verificar o secret. Não repetir automaticamente. |
| `404` | Transação não encontrada (só com `transactionId`) | Tratar como "ainda não integrada"; pode reconsultar depois. |
| `500` | Falha na consulta | Retentar com backoff exponencial. |
| `503` | API sem chave configurada no servidor | Acionar o time do ERP Flow. |

Respostas de erro seguem `{ "error": <string | objeto de campos> }`.

## 8. Boas práticas de consumo

- **Paginação:** use `limit` (máx. 200) + `offset`; pare quando `count < limit`.
- **Lotes:** prefira `transactionIds` (até 200 por chamada) a várias chamadas unitárias.
- **Polling incremental:** use `updatedSince` com o último `updatedAt` processado, em vez de varrer tudo.
- **Cache:** as respostas vêm com `Cache-Control: no-store`; faça cache do seu lado se necessário.
- **Retentativas:** backoff exponencial apenas para `5xx`; nunca para `400`/`401`.
- **Estados finais:** trate `settled` como terminal; `not_posted` e `error` devem ser reconsultados.
- **Segurança:** chamada sempre server-side, chave em variável de ambiente, nunca em URL ou log.

## 9. Changelog

| Versão | Data | Mudanças |
| --- | --- | --- |
| 1.0.0 | 2026-07 | Versão inicial: consulta por `transactionId`/`transactionIds`, filtros `companyDb` e `updatedSince`, paginação e contrato OpenAPI 3.1. |
