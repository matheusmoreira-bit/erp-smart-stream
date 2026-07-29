# PagCorp Transaction Status API

API somente-leitura para outro projeto consultar o status das transações de cartão de crédito (PagCorp) e o respectivo lançamento no ERP (SAP B1).

- **Base URL:** `https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/pagcorp-status-api`
- **Autenticação:** header `x-api-key` (chave compartilhada, guardada como secret nos dois lados — nunca no front-end)
- **OpenAPI 3.1:** `GET ...?spec=openapi` (público, só o contrato)
- **Swagger UI:** `/docs/pagcorp-status-api.html` no site publicado

## Exemplos

### Uma transação (`transactionId`)

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

Transação inexistente → `404 { "error": "Not found" }`.

### Várias transações (`transactionIds`, máx. 200)

```bash
curl -s "$BASE/pagcorp-status-api?transactionIds=483921,483922" -H "x-api-key: $KEY"
```

```json
{
  "count": 2,
  "items": [
    { "transactionId": 483921, "status": "integrated", "erp": { "stage": "settled", "purchaseOrderDocNum": 2451, "invoiceDocNum": 8890, "paymentDocNum": 1204, "settlementStatus": "completed" }, "updatedAt": "2026-07-28T19:41:02.113Z" },
    { "transactionId": 483922, "status": "pending", "erp": { "stage": "not_posted", "purchaseOrderDocNum": null, "invoiceDocNum": null, "paymentDocNum": null, "settlementStatus": null }, "updatedAt": "2026-07-28T18:02:55.007Z" }
  ]
}
```

### Filtros adicionais

```bash
curl -s "$BASE/pagcorp-status-api?companyDb=PRD_ANAGAMING&updatedSince=2026-07-01T00:00:00Z&limit=100&offset=0" \
  -H "x-api-key: $KEY"
```

## Payload mínimo

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `transactionId` | integer | ID da transação no PagCorp |
| `status` | string | Status da integração no ERP Flow |
| `erp.stage` | enum | `not_posted` \| `error` \| `posted` \| `invoiced` \| `settled` |
| `erp.purchaseOrderDocNum` | integer \| null | Nº do pedido de compra no SAP |
| `erp.invoiceDocNum` | integer \| null | Nº da NF de entrada no SAP |
| `erp.paymentDocNum` | integer \| null | Nº do pagamento/liquidação no SAP |
| `erp.settlementStatus` | string \| null | Status bruto da liquidação |
| `updatedAt` | date-time \| null | Última atualização (UTC) |

Nada além disso é exposto: sem valores, fornecedor, número de cartão, portador, anexos ou mensagens de erro internas.

## Códigos de status

`200` ok · `400` parâmetros inválidos · `401` chave ausente/inválida · `404` transação não encontrada · `500` falha na consulta · `503` API sem chave configurada no servidor.
