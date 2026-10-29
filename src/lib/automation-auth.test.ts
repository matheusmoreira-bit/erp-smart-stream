import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function loadAuth() {
  // Ephemeral synthetic credentials; never use deployment secrets in unit tests.
  const databaseCredential = randomUUID();
  const legacyCredential = randomUUID();
  const environment = new Map([
    ["SCHEDULER_SECRET", legacyCredential],
    ["AUTOMATION_SECRET", legacyCredential],
    ["INTERNAL_FUNCTION_SECRET", legacyCredential],
  ]);
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    maybeSingle: async () => ({ data: { credential_value: databaseCredential }, error: null }),
  };
  const source = readFileSync(new URL("../../supabase/functions/_shared/automation-auth.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(compiled, {
    exports, Request, Response, Date,
    Deno: { env: { get: (key: string) => environment.get(key) } },
    require: (name: string) => {
      if (name.includes("supabase-js")) return { createClient: () => ({ from: () => query }) };
      if (name === "./auth.ts") return {
        requireAdmin: async () => { throw new Error("unauthenticated"); },
        requireUserOrSapSession: async () => { throw new Error("unauthenticated"); },
      };
      throw new Error("Unexpected dependency");
    },
  });
  return {
    databaseCredential, legacyCredential,
    auth: exports as unknown as {
      isSchedulerSecretRequest: (req: Request) => Promise<boolean>;
      requireSchedulerOrAdmin: (req: Request, cors: Record<string, string>) => Promise<
        { ok: true; source: string } | { ok: false; response: Response }
      >;
    },
  };
}

describe("scheduler database-only authentication", () => {
  it("accepts the credential from system_credentials_v", async () => {
    const { auth, databaseCredential } = loadAuth();
    const accepted = await auth.isSchedulerSecretRequest(new Request("https://example.test", {
      headers: { "x-scheduler-secret": databaseCredential },
    }));
    expect(accepted).toBe(true);
  });

  it("rejects the legacy environment credential with HTTP 401", async () => {
    const { auth, legacyCredential } = loadAuth();
    const result = await auth.requireSchedulerOrAdmin(new Request("https://example.test", {
      headers: { "x-scheduler-secret": legacyCredential },
    }), {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Legacy authentication must fail");
    expect(result.response.status).toBe(401);
  });

  it("does not accept legacy environment aliases through alternative headers", async () => {
    const { auth, legacyCredential } = loadAuth();
    for (const header of ["x-internal-key", "x-automation-secret"]) {
      const accepted = await auth.isSchedulerSecretRequest(new Request("https://example.test", {
        headers: { [header]: legacyCredential },
      }));
      expect(accepted).toBe(false);
    }
  });
});