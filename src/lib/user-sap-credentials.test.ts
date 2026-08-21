import { beforeEach, describe, expect, it, vi } from "vitest";
import { sapAutoLogin } from "./user-sap-credentials";

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock("@/lib/auth-fetch", () => mocks);

describe("sapAutoLogin", () => {
  beforeEach(() => mocks.authFetch.mockReset());

  it("accepts a successful managed session", async () => {
    mocks.authFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      sessionId: "session-1",
      routeId: ".node1",
      companyDB: "EMPRESA",
      sapUser: "apiuser",
      sessionTimeout: 30,
      service: true,
    }), { status: 200 }));

    await expect(sapAutoLogin("EMPRESA")).resolves.toMatchObject({
      sessionId: "session-1",
      service: true,
    });
    const request = mocks.authFetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({ application_errors: true });
  });

  it("turns an application-level SAP rejection into a controlled error", async () => {
    mocks.authFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: false,
      error: "sap_login_failed",
      message: "A credencial SAP configurada não permite login sem SSO.",
      sapCode: -304,
      sapStatus: 401,
      retryable: false,
    }), { status: 200 }));

    const error = await sapAutoLogin("EMPRESA").catch((value) => value) as Error & {
      code?: string;
      sapCode?: number;
      status?: number;
    };
    expect(error.message).toContain("não permite login sem SSO");
    expect(error.code).toBe("sap_login_failed");
    expect(error.sapCode).toBe(-304);
    expect(error.status).toBe(401);
  });

  it("continues to understand legacy non-2xx responses", async () => {
    mocks.authFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      error: "Falha no login SAP",
      sapCode: -304,
    }), { status: 401 }));

    await expect(sapAutoLogin("EMPRESA")).rejects.toThrow("Falha no login SAP");
  });
});
