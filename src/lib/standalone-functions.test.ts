import { describe, expect, it } from "vitest";
import { standaloneFunctionResponse } from "./standalone-functions";

describe("standaloneFunctionResponse", () => {
  it("responde consultas SAP conhecidas sem acessar a rede", async () => {
    const response = standaloneFunctionResponse("sap-list-service", {
      method: "POST",
      body: JSON.stringify({ company_db: "SBO_ANAGAMING" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ rows: [], standalone: true });
  });

  it("permite ações explicitamente classificadas como leitura", async () => {
    const response = standaloneFunctionResponse("item-save", {
      method: "POST",
      body: JSON.stringify({ action: "previewCode" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ standalone: true });
  });

  it("rejeita mutações desconhecidas em vez de simular sucesso", async () => {
    const response = standaloneFunctionResponse("unknown-writer", {
      method: "POST",
      body: JSON.stringify({ payload: { id: 1 } }),
    });

    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({
      code: "standalone_feature_unavailable",
      standalone: true,
    });
  });
});
