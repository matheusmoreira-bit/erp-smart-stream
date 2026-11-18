import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

class AuthError extends Error { constructor(message: string, public status = 403) { super(message); } }
type Row = Record<string, unknown>;
type Scope = { companyDb: string; action: string };
function compile(path: string, dependencies: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Request, Response, URL, TextEncoder, TextDecoder, console, Set, Date, ...extra, require: (name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`);
    return dependencies[name];
  } });
  return exports;
}
function fixture(identity = "juliana.gavineli", targetCompany = "TEST", role = "cloud_module", allowedAction = "view") {
  const effects: string[] = [];
  const calls: Scope[] = [];
  let rows: Row[] = [];
  const sb = { from: (table: string) => {
    let single = false;
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "not", "order", "limit", "is", "in", "neq", "range", "or", "gte", "lte"]) query[method] = () => query;
    for (const method of ["insert", "update", "delete", "upsert"]) query[method] = () => { effects.push(`${table}:${method}`); return query; };
    query.single = query.maybeSingle = () => { single = true; return query; };
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve);
    return query;
  }, rpc: async () => ({ data: null, error: null }) };
  const auth = {
    AuthError,
    requireUserOrSapSession: async () => ({ id: identity, email: `${identity}@example.test` }),
    requireUserOrSapSessionHeaders: async () => ({ id: identity, email: `${identity}@example.test` }),
    requireAdminOrSapModule: async (_req: Request, _module: string, scope?: Scope) => {
      if (scope) {
        calls.push(scope);
        if (scope.companyDb !== targetCompany || (role !== "cloud_admin" && scope.action !== "view" && scope.action !== allowedAction)) throw new AuthError("Denied", 403);
      }
      return { id: identity, email: `${identity}@example.test`, source: role };
    },
    requireAdminOrSapAdmin: async () => { if (role !== "cloud_admin") throw new AuthError("Denied"); return { id: identity }; },
    requireUser: async () => ({ id: identity }),
    parseSapHeaders: () => ({ sapSession: "synthetic", routeId: "" }),
    validateSapSession: async () => ({ companyDB: targetCompany, userName: identity }),
    authErrorResponse: (err: unknown) => err instanceof AuthError ? new Response(JSON.stringify({ error: err.message }), { status: err.status }) : null,
  };
  const helpers = compile("supabase/functions/_shared/resource-access.ts", {
    "./auth.ts": auth,
    "./user-aliases.ts": { normalizeIdentity: (v: string) => v.toLowerCase().split("@")[0], resolveCallerAliases: async () => new Set([identity]) },
  }) as {
    authorizeCompany: (req: Request, company: unknown, module: string, action: string) => Promise<unknown>;
    authorizeDocument: (req: Request, sb: unknown, row: Row, module: string, action: string, options?: Row) => Promise<unknown>;
    requireUuid: (value: unknown, label: string) => string;
  };
  return { sb, auth, helpers, effects, calls, setRows: (value: Row[]) => { rows = value; } };
}
const uuid = "00000000-0000-4000-8000-000000000001";
const req = new Request("https://example.test");
describe("persisted company and responsible-person authorization", () => {
  for (const person of ["mauricio.farias", "juliana.gavineli", "artur.angelo"]) {
    it(`${person} retains integration of own document without changing profile`, async () => {
      const f = fixture(person);
      await f.helpers.authorizeDocument(req, f.sb, { company_db: "TEST", requester_email: `${person}@example.test` }, "expenses", "integrate");
      expect(f.calls).toEqual([{ companyDb: "TEST", action: "view" }]);
      expect(f.effects).toEqual([]);
    });
  }
  it("preserves the verified approver integration after the current approver is cleared", async () => {
    const f = fixture(); f.setRows([{ approver_email: "juliana.gavineli@example.test" }]);
    await expect(f.helpers.authorizeDocument(req, f.sb, { company_db: "TEST" }, "expenses", "integrate", { expenseId: uuid })).resolves.toBeDefined();
  });
  it("denies another company even for the document owner", async () => {
    const f = fixture();
    await expect(f.helpers.authorizeDocument(req, f.sb, { company_db: "OTHER", requester_id: "juliana.gavineli" }, "expenses", "integrate")).rejects.toMatchObject({ status: 403 });
  });
  it("denies another person's document to a view-only user", async () => {
    const f = fixture();
    await expect(f.helpers.authorizeDocument(req, f.sb, { company_db: "TEST", requester_email: "other@example.test" }, "expenses", "integrate")).rejects.toMatchObject({ status: 403 });
  });
  it("allows a financial operator with an existing integrate grant", async () => {
    const f = fixture("artur.angelo", "TEST", "cloud_module", "integrate");
    await expect(f.helpers.authorizeDocument(req, f.sb, { company_db: "TEST", requester_email: "other@example.test" }, "expenses", "integrate")).resolves.toBeDefined();
  });
  it("owner-only backfill denies even an unrelated operator with edit permission", async () => {
    const f = fixture("artur.angelo", "TEST", "cloud_module", "edit");
    await expect(f.helpers.authorizeDocument(req, f.sb, { company_db: "TEST", requester_email: "other@example.test" }, "expenses", "edit", { ownerOnly: true })).rejects.toMatchObject({ status: 403 });
  });
});

const functions = ["advance-to-sap", "expense-to-sap", "advance-reconcile", "sales-nfse-emit", "pagcorp-settlement-watcher", "pagcorp-card-mapping", "pagcorp-proxy", "cashflow-forecast", "nf-entrada-erp-status", "expense-backfill-due-date"];
async function runHandler(name: string, f: ReturnType<typeof fixture>, body: Row, search = "") {
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const dependencies: Record<string, unknown> = {};
  const source = readFileSync(`supabase/functions/${name}/index.ts`, "utf8");
  const neutral = new Proxy({}, { get: (_t, key) => {
    if (["getIntegrationPause", "getStandaloneMode", "blockIfIntegrationsDisabled", "rejectForeignOrigin", "isExpenseIntegrationCancelled"].includes(String(key))) return asyncOrSyncFalse(String(key));
    if (String(key) === "withEdgeMetrics") return (_name: string, fn: unknown) => fn;
    if (String(key) === "corsFor") return () => ({});
    return () => { f.effects.push(String(key)); return Promise.resolve(null); };
  } });
  for (const match of source.matchAll(/from ["']([^"']+)["']/g)) dependencies[match[1]] = neutral;
  for (const key of Object.keys(dependencies)) if (key.includes("supabase-js")) dependencies[key] = { createClient: () => f.sb, corsHeaders: {} };
  dependencies["../_shared/auth.ts"] = f.auth;
  dependencies["../_shared/resource-access.ts"] = f.helpers;
  dependencies["../_shared/automation-auth.ts"] = { isServiceRoleRequest: () => false, requireSchedulerAdminOrUserSession: async () => ({ ok: true, source: "user_or_sap" }), requireSchedulerOrAdmin: async () => ({ ok: false, response: new Response(null, { status: 401 }) }) };
  compile(`supabase/functions/${name}/index.ts`, dependencies, {
    Deno: { env: { get: () => undefined }, serve: (fn: typeof handler) => { handler = fn; } },
    crypto: { randomUUID: () => uuid },
    fetch: async () => { f.effects.push("fetch"); throw new Error("External write prohibited in synthetic tests"); },
  });
  if (!handler) throw new Error("Handler not registered");
  return handler(new Request(`https://example.test/functions/v1/${name}${search}`, { method: name === "pagcorp-proxy" ? "GET" : "POST", ...(name === "pagcorp-proxy" ? {} : { body: JSON.stringify(body) }), headers: { "content-type": "application/json" } }));
}
function asyncOrSyncFalse(key: string) { return key.startsWith("get") || key === "isExpenseIntegrationCancelled" ? async () => null : () => null; }
const bodies: Record<string, Row> = {
  "advance-to-sap": { advance_id: uuid }, "expense-to-sap": { expense_id: uuid },
  "advance-reconcile": { advance_id: uuid, data_recebimento: "2026-11-18", conta_codigo: "TESTBANK" },
  "sales-nfse-emit": { action: "cancel", company_db: "OTHER", sap_invoice_doc_entry: 42 },
  "pagcorp-settlement-watcher": { logId: uuid }, "pagcorp-card-mapping": { action: "delete", id: uuid },
  "pagcorp-proxy": {}, "cashflow-forecast": { company_db: "OTHER", from: "2026-11-01", to: "2026-11-18" },
  "nf-entrada-erp-status": { import_id: uuid }, "expense-backfill-due-date": { expense_id: uuid },
};
describe("all ten real handlers reject forbidden scope before any side effect", () => {
  for (const name of functions) it(`${name}: denies foreign company with no update, retry, lock or external call`, async () => {
    const f = fixture(); f.setRows([{ id: uuid, company_db: "OTHER", sap_company_db: "OTHER", requester_email: "juliana.gavineli@example.test" }]);
    const response = await runHandler(name, f, bodies[name], "?companyDb=OTHER");
    expect(response.status).toBe(403);
    // The proxy's existing audit is allowed, but business effects are not.
    expect(f.effects.filter((v) => v !== "logIntegrationCall")).toEqual([]);
  });
  it("authorized advance reads back its existing integration without a duplicate SAP write", async () => {
    const f = fixture("mauricio.farias"); f.setRows([{ id: uuid, company_db: "TEST", requester_email: "mauricio.farias@example.test", sap_doc_entry: 42, sap_doc_num: 123 }]);
    const response = await runHandler("advance-to-sap", f, { advance_id: uuid });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ success: true, docEntry: 42, docNum: 123 }); expect(f.effects).toEqual([]);
  });
  for (const name of ["advance-to-sap", "expense-to-sap", "advance-reconcile", "sales-nfse-emit", "pagcorp-settlement-watcher", "pagcorp-card-mapping"]) {
    it(`${name}: denies missing action permission in the same company`, async () => {
      const f = fixture(); f.setRows([{ id: uuid, company_db: "TEST", requester_email: "other@example.test", advance_type: "customer" }]);
      const response = await runHandler(name, f, { ...bodies[name], company_db: "TEST" });
      expect(response.status).toBe(403); expect(f.effects).toEqual([]);
    });
  }
  it("backfill denies an unrelated responsible person before accessing attachments or AI", async () => {
    const f = fixture(); f.setRows([{ id: uuid, company_db: "TEST", requester_email: "other@example.test" }]);
    const response = await runHandler("expense-backfill-due-date", f, { expense_id: uuid });
    expect(response.status).toBe(403); expect(f.effects).toEqual([]);
  });
  it("PagCorp validates every company before writing a mixed batch", async () => {
    const f = fixture("artur.angelo", "TEST", "cloud_module", "edit");
    const response = await runHandler("pagcorp-card-mapping", f, { action: "save", rows: [
      { company_db: "TEST", card_identifier: "1111" }, { company_db: "OTHER", card_identifier: "2222" },
    ] });
    expect(response.status).toBe(403); expect(f.effects).toEqual([]);
  });
  it("PagCorp edit-only permission cannot create new mapping rows", async () => {
    const f = fixture("artur.angelo", "TEST", "cloud_module", "edit");
    const response = await runHandler("pagcorp-card-mapping", f, { action: "save", rows: [{ company_db: "TEST", card_identifier: "1111" }] });
    expect(response.status).toBe(403); expect(f.effects).toEqual([]);
  });
  it("authorized Juliana can trigger integration while pending without sending an unapproved document", async () => {
    const f = fixture(); f.setRows([{ id: uuid, company_db: "TEST", requester_email: "juliana.gavineli@example.test", status: "pendente_aprovacao" }]);
    const response = await runHandler("expense-to-sap", f, { expense_id: uuid });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ skipped: true, reason: "pending_approval" }); expect(f.effects).toEqual([]);
  });
  it("authorized Artur can list PagCorp mappings", async () => {
    const f = fixture("artur.angelo"); f.setRows([{ id: uuid, company_db: "TEST" }]);
    const response = await runHandler("pagcorp-card-mapping", f, { action: "list-mappings", company_db: "TEST" });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ success: true, mappings: [{ id: uuid }] }); expect(f.effects).toEqual([]);
  });
});

describe("PagCorp receipt bearer containment", () => {
  const urls = compile("supabase/functions/_shared/pagcorp-receipt-url.ts", {}) as { pagcorpReceiptUrl: (raw: string, base: string) => string };
  const base = "https://api.example.test/v1/";
  it("retains the API receipt path", () => expect(urls.pagcorpReceiptUrl(`${base}Receipt/42/File`, base)).toBe(`${base}Receipt/42/File`));
  for (const raw of ["https://attacker.test/file", "http://api.example.test/v1/file", "https://api.example.test/admin", "https://api.example.test/v1/../admin", "https://user:password@api.example.test/v1/file", "https://api.example.test/v1/file#fragment"]) {
    it(`rejects unsafe target ${raw}`, () => expect(() => urls.pagcorpReceiptUrl(raw, base)).toThrow());
  }
});
