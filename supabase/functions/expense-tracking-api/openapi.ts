export const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "ERP Flow - Acompanhamento de Despesas",
    version: "1.0.0",
    description: "Consulta despesas de compra limitadas aos projetos autorizados na credencial.",
  },
  paths: {
    "/expense-tracking-api": {
      get: {
        summary: "Lista despesas no escopo da credencial",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "expenseId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "companyDb", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "updatedSince", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: {
          "200": {
            description: "Despesas aprovadas ou em autorização dentro do escopo de projetos da credencial",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    count: { type: "integer" },
                    limit: { type: "integer" },
                    offset: { type: "integer" },
                    hasMore: { type: "boolean" },
                    items: { type: "array", items: { $ref: "#/components/schemas/Expense" } },
                  },
                },
              },
            },
          },
          "401": { description: "Credencial inválida" },
          "403": { description: "Credencial sem projetos autorizados" },
          "429": { description: "Limite de requisições excedido" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
    },
    schemas: {
      Expense: {
        type: "object",
        properties: {
          supplierCode: { type: "string", nullable: true },
          supplierName: { type: "string" },
          supplierTaxId: { type: "string", nullable: true },
          erpFlowId: { type: "string", format: "uuid" },
          sapDocumentId: { type: "integer", nullable: true },
          invoiceDate: { type: "string", format: "date", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          dueDate: { type: "string", format: "date", nullable: true },
          totalAmount: { type: "number" },
          currency: { type: "string" },
          description: { type: "string", nullable: true },
          observation: { type: "string", nullable: true },
          costCenters: { type: "array", items: { type: "string" } },
          projects: { type: "array", items: { type: "string" } },
          status: { type: "string" },
          pendingApprovers: {
            type: "array",
            description: "Aprovadores atuais das ramificações autorizadas; vazio quando o documento não está em aprovação",
            items: { $ref: "#/components/schemas/PendingApprover" },
          },
        },
      },
      PendingApprover: {
        type: "object",
        properties: {
          name: { type: "string", nullable: true },
          email: { type: "string", format: "email", nullable: true },
          level: { type: "integer", nullable: true },
          costCenter: { type: "string", nullable: true },
          project: { type: "string", nullable: true },
        },
      },
    },
  },
} as const;
