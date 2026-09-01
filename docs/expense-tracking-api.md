# API de acompanhamento de despesas

Endpoint de leitura para acompanhar pedidos de compra do ERP Flow com isolamento por projeto.

## Credencial

Crie a chave em **Backoffice > Chaves de API**, selecione o serviço `expense-tracking-api` e informe os códigos dos projetos permitidos. A chave só é exibida uma vez.

Envie a credencial no header:

```http
x-api-key: erpf_exp_...
```

Uma credencial deste serviço precisa ter pelo menos um projeto. Não existe acesso global implícito.

## Consulta

```http
GET {SUPABASE_URL}/functions/v1/expense-tracking-api?limit=50&offset=0
```

Filtros opcionais:

| Parâmetro | Formato | Descrição |
| --- | --- | --- |
| `expenseId` | UUID | Retorna uma despesa específica |
| `companyDb` | texto | Filtra pela base da empresa |
| `status` | texto | Filtra pelo status do ERP Flow |
| `updatedSince` | ISO 8601 | Retorna despesas atualizadas a partir da data |
| `limit` | 1 a 200 | Tamanho da página, padrão 50 |
| `offset` | 0 a 5000 | Deslocamento nos resultados autorizados |

O contrato OpenAPI está disponível em:

```http
GET {SUPABASE_URL}/functions/v1/expense-tracking-api?spec=openapi
```

## Resposta

```json
{
  "count": 1,
  "limit": 50,
  "offset": 0,
  "hasMore": false,
  "items": [
    {
      "supplierCode": "F000123",
      "supplierName": "FORNECEDOR LTDA",
      "supplierTaxId": "12345678000199",
      "erpFlowId": "b89dd7e0-ce39-40bd-a892-518eedf337c5",
      "sapDocumentId": 9876,
      "invoiceDate": "2026-08-20",
      "createdAt": "2026-08-21T10:00:00.000Z",
      "dueDate": "2026-09-20",
      "totalAmount": 150.25,
      "currency": "BRL",
      "description": "Licenciamento mensal",
      "observation": "Competência agosto/2026",
      "costCenters": ["1.2.3.4"],
      "projects": ["PROJETO-A"],
      "status": "pendente_aprovacao",
      "pendingApprovers": [
        {
          "name": "Maria Aprovadora",
          "email": "maria@example.com",
          "level": 2,
          "costCenter": "1.2.3.4",
          "project": "PROJETO-A"
        }
      ]
    }
  ]
}
```

`sapDocumentId` usa o `DocNum` e, quando ele não estiver disponível, o `DocEntry`.

`description` é formada pelas descrições das linhas visíveis à credencial e usa a observação do cabeçalho como fallback. `observation` preserva a observação do pedido.

O endpoint não se limita a documentos aprovados: despesas com status `pendente_aprovacao` também são retornadas. Para elas, `pendingApprovers` informa com quem está cada ramificação autorizada. Em outros status, o array é vazio.

## Regra de escopo

Em despesas rateadas, apenas linhas cujo projeto pertence à credencial são consideradas. `totalAmount`, `description`, `costCenters`, `projects` e `pendingApprovers` são reconstruídos com essas linhas e ramificações. Se nenhuma linha estiver no escopo, a despesa não é retornada.

Para registros legados sem itens, o projeto e o valor do cabeçalho são usados, desde que o projeto do cabeçalho esteja autorizado.
