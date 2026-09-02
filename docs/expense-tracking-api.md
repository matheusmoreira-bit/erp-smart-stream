# API de acompanhamento de documentos

API somente leitura para acompanhar despesas e pedidos de compra do ERP Flow. Cada credencial possui um escopo próprio de projetos e recebe apenas os valores e dados das linhas autorizadas.

## URLs

Base Supabase:

```text
https://ryxlofwbyhkqcvzavbwn.supabase.co
```

Endpoint:

```http
GET https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/expense-tracking-api
```

Contrato OpenAPI:

```http
GET https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/expense-tracking-api?spec=openapi
```

## Credencial

No ERP Flow, acesse **Backoffice > Chaves de API**, crie uma chave para o serviço **Acompanhamento de despesas (expense-tracking-api)** e informe os códigos dos projetos permitidos.

A chave é exibida somente uma vez. Envie-a em todas as consultas no header `x-api-key`:

```http
x-api-key: erpf_exp_SUA_CHAVE
```

Cada credencial precisa ter ao menos um projeto autorizado. Não existe acesso global implícito.

## Consulta básica

```bash
curl --request GET \
  --url 'https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/expense-tracking-api?limit=50&offset=0' \
  --header 'accept: application/json' \
  --header 'x-api-key: erpf_exp_SUA_CHAVE'
```

Exemplo em JavaScript:

```javascript
const endpoint = new URL(
  "https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/expense-tracking-api",
);

endpoint.searchParams.set("limit", "50");
endpoint.searchParams.set("offset", "0");

const response = await fetch(endpoint, {
  headers: {
    Accept: "application/json",
    "x-api-key": process.env.ERP_FLOW_EXPENSE_API_KEY,
  },
});

if (!response.ok) {
  throw new Error(`ERP Flow retornou HTTP ${response.status}: ${await response.text()}`);
}

const result = await response.json();
console.log(result.items);
```

## Filtros

| Parâmetro | Formato | Descrição |
| --- | --- | --- |
| `expenseId` | UUID | Retorna uma despesa específica |
| `companyDb` | texto | Filtra pela base da empresa |
| `status` | texto | Filtra pelo status interno do ERP Flow |
| `updatedSince` | ISO 8601 com fuso | Retorna documentos atualizados a partir da data informada |
| `limit` | inteiro de 1 a 200 | Quantidade por página. Padrão: `50` |
| `offset` | inteiro de 0 a 5000 | Deslocamento nos documentos autorizados. Padrão: `0` |

Exemplo incremental:

```http
GET https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/expense-tracking-api?updatedSince=2026-09-01T00%3A00%3A00-03%3A00&limit=100&offset=0
```

Exemplo de uma despesa:

```http
GET https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/expense-tracking-api?expenseId=b89dd7e0-ce39-40bd-a892-518eedf337c5
```

Quando `expenseId` é usado, a resposta é o objeto da despesa, sem o envelope de paginação. Caso o documento não exista ou esteja fora do escopo da credencial, a API retorna `404`.

## Resposta paginada

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

## Campos do documento

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `supplierCode` | string ou `null` | Código do fornecedor no ERP |
| `supplierName` | string | Nome do fornecedor |
| `supplierTaxId` | string ou `null` | CNPJ ou identificador fiscal do fornecedor |
| `erpFlowId` | UUID | ID interno do documento no ERP Flow |
| `sapDocumentId` | número ou `null` | `DocNum` do ERP e, na ausência, `DocEntry` |
| `invoiceDate` | data ou `null` | Data do documento ou da nota fiscal |
| `createdAt` | data/hora | Data de criação no ERP Flow |
| `dueDate` | data ou `null` | Data de vencimento |
| `totalAmount` | número | Valor das linhas pertencentes aos projetos autorizados |
| `currency` | string | Moeda do documento, como `BRL`, `USD` ou `EUR` |
| `description` | string ou `null` | Descrições das linhas visíveis, separadas por ` | ` |
| `observation` | string ou `null` | Observação do cabeçalho do pedido |
| `costCenters` | array de string | Centros de custo das linhas visíveis |
| `projects` | array de string | Projetos das linhas visíveis |
| `status` | string | Status interno atual do documento |
| `pendingApprovers` | array | Aprovadores atuais das ramificações visíveis |

O endpoint inclui documentos aprovados e documentos em processo de autorização. Quando o status representa uma aprovação em aberto, `pendingApprovers` informa com quem está cada ramificação autorizada. Nos demais status, o array é vazio.

## Escopo por projeto

Em pedidos rateados, a API considera somente as linhas cujo projeto está autorizado para a credencial. Os campos abaixo são reconstruídos apenas com essas linhas:

- `totalAmount`
- `description`
- `costCenters`
- `projects`
- `pendingApprovers`

Se nenhuma linha estiver no escopo, o documento não é retornado. Para registros legados sem itens, são usados o projeto e o valor do cabeçalho, desde que o projeto esteja autorizado.

## Paginação

Use `limit` e `offset` até que `hasMore` seja `false`:

```text
Página 1: ?limit=100&offset=0
Página 2: ?limit=100&offset=100
Página 3: ?limit=100&offset=200
```

`count` representa a quantidade retornada na página atual, não o total global.

## Respostas HTTP

| Código | Significado |
| --- | --- |
| `200` | Consulta realizada |
| `400` | Filtro ou formato inválido |
| `401` | Chave ausente, inválida, expirada ou revogada |
| `403` | Credencial sem projetos autorizados |
| `404` | Documento não encontrado ou fora do escopo |
| `405` | Método diferente de `GET` |
| `429` | Limite de requisições excedido |
| `500` | Falha interna ao consultar os dados |

O limite atual é de 120 requisições por minuto por combinação de credencial e endereço IP.

## Segurança

- Não envie a chave em query string, logs, planilhas públicas ou código versionado.
- Armazene a chave em um cofre de segredos ou variável de ambiente.
- Gere credenciais distintas por consumidor e conceda somente os projetos necessários.
- Revogue imediatamente chaves expostas ou que não sejam mais utilizadas.
