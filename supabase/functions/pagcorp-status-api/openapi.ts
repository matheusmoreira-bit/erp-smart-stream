// OpenAPI 3.1 spec for the PagCorp transaction status API.
// Served unauthenticated at GET /pagcorp-status-api?spec=openapi
export const openapiSpec = {
  openapi: "3.1.0",
  info: {
    title: "PagCorp Transaction Status API",
    version: "1.0.0",
    description:
      "Leitura somente-leitura do status das transações de cartão de crédito (PagCorp) e do respectivo lançamento no ERP (SAP Business One). O payload é mínimo por design: não expõe valores, fornecedor, cartão, usuário ou qualquer PII.",
  },
  servers: [
    {
      url: "https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1",
      description: "Produção",
    },
  ],
  security: [{ ApiKeyAuth: [] }],
  tags: [{ name: "Transações", description: "Status de transações e lançamento no ERP" }],
  paths: {
    "/pagcorp-status-api": {
      get: {
        tags: ["Transações"],
        summary: "Consultar status de transações",
        description:
          "Retorna o registro mais recente por transação. Use `transactionId` para consultar uma única transação (retorna o objeto direto) ou `transactionIds` / filtros para consultar uma lista.",
        operationId: "getTransactionStatus",
        parameters: [
          {
            name: "transactionId",
            in: "query",
            description: "ID da transação PagCorp. Quando informado, a resposta é um único objeto `Transaction`.",
            schema: { type: "integer", minimum: 1 },
            example: 483921,
          },
          {
            name: "transactionIds",
            in: "query",
            description: "Lista de IDs separados por vírgula (máx. 200). Ignorado se `transactionId` for informado.",
            schema: { type: "string", maxLength: 2000 },
            example: "483921,483922,483923",
          },
          {
            name: "companyDb",
            in: "query",
            description: "Filtra pela base da empresa no ERP.",
            schema: { type: "string", maxLength: 64 },
            example: "PRD_ANAGAMING",
          },
          {
            name: "updatedSince",
            in: "query",
            description: "Retorna apenas transações atualizadas a partir desta data/hora (ISO 8601 UTC).",
            schema: { type: "string", format: "date-time" },
            example: "2026-07-01T00:00:00Z",
          },
          {
            name: "limit",
            in: "query",
            description: "Tamanho da página (1–200).",
            schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          },
          {
            name: "offset",
            in: "query",
            description: "Deslocamento para paginação.",
            schema: { type: "integer", minimum: 0, maximum: 100000, default: 0 },
          },
          {
            name: "spec",
            in: "query",
            description: "Use `openapi` para obter este documento (não requer chave de API).",
            schema: { type: "string", enum: ["openapi"] },
          },
        ],
        responses: {
          "200": {
            description: "Consulta bem-sucedida.",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/Transaction" },
                    { $ref: "#/components/schemas/TransactionList" },
                  ],
                },
                examples: {
                  porTransactionId: {
                    summary: "GET ?transactionId=483921",
                    value: {
                      transactionId: 483921,
                      status: "integrated",
                      erp: {
                        stage: "settled",
                        purchaseOrderDocNum: 2451,
                        invoiceDocNum: 8890,
                        paymentDocNum: 1204,
                        settlementStatus: "completed",
                      },
                      updatedAt: "2026-07-28T19:41:02.113Z",
                    },
                  },
                  porTransactionIds: {
                    summary: "GET ?transactionIds=483921,483922",
                    value: {
                      count: 2,
                      items: [
                        {
                          transactionId: 483921,
                          status: "integrated",
                          erp: {
                            stage: "settled",
                            purchaseOrderDocNum: 2451,
                            invoiceDocNum: 8890,
                            paymentDocNum: 1204,
                            settlementStatus: "completed",
                          },
                          updatedAt: "2026-07-28T19:41:02.113Z",
                        },
                        {
                          transactionId: 483922,
                          status: "pending",
                          erp: {
                            stage: "not_posted",
                            purchaseOrderDocNum: null,
                            invoiceDocNum: null,
                            paymentDocNum: null,
                            settlementStatus: null,
                          },
                          updatedAt: "2026-07-28T18:02:55.007Z",
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Parâmetros inválidos.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { error: { limit: ["Number must be less than or equal to 200"] } },
              },
            },
          },
          "401": {
            description: "Chave de API ausente ou inválida.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { error: "Unauthorized" },
              },
            },
          },
          "404": {
            description: "Transação não encontrada (apenas quando `transactionId` é informado).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { error: "Not found" },
              },
            },
          },
          "500": { description: "Falha na consulta." },
          "503": { description: "API não configurada (chave ausente no servidor)." },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description: "Chave compartilhada emitida pelo time do ERP Flow. Nunca deve ser embarcada em código de front-end.",
      },
    },
    schemas: {
      Transaction: {
        type: "object",
        description: "Payload mínimo: identificação, status e situação no ERP.",
        required: ["transactionId", "status", "erp", "updatedAt"],
        properties: {
          transactionId: { type: "integer", description: "ID da transação no PagCorp.", example: 483921 },
          status: {
            type: "string",
            description: "Status da integração da transação no ERP Flow.",
            example: "integrated",
          },
          erp: { $ref: "#/components/schemas/ErpStatus" },
          updatedAt: {
            type: ["string", "null"],
            format: "date-time",
            description: "Última atualização do registro (UTC).",
            example: "2026-07-28T19:41:02.113Z",
          },
        },
      },
      ErpStatus: {
        type: "object",
        required: ["stage"],
        properties: {
          stage: {
            type: "string",
            enum: ["not_posted", "error", "posted", "invoiced", "settled"],
            description:
              "Estágio consolidado: `not_posted` (sem lançamento), `error` (falha), `posted` (pedido de compra criado), `invoiced` (NF de entrada criada), `settled` (pagamento/liquidação concluída).",
            example: "settled",
          },
          purchaseOrderDocNum: { type: ["integer", "null"], description: "Nº do pedido de compra no SAP.", example: 2451 },
          invoiceDocNum: { type: ["integer", "null"], description: "Nº da NF de entrada no SAP.", example: 8890 },
          paymentDocNum: { type: ["integer", "null"], description: "Nº do pagamento/liquidação no SAP.", example: 1204 },
          settlementStatus: { type: ["string", "null"], description: "Status bruto da liquidação.", example: "completed" },
        },
      },
      TransactionList: {
        type: "object",
        required: ["count", "items"],
        properties: {
          count: { type: "integer", description: "Quantidade de itens nesta página.", example: 2 },
          items: { type: "array", items: { $ref: "#/components/schemas/Transaction" } },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: {
            oneOf: [{ type: "string" }, { type: "object", additionalProperties: { type: "array", items: { type: "string" } } }],
          },
        },
      },
    },
  },
} as const;
