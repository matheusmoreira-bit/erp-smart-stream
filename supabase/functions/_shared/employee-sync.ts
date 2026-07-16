// Shared helpers for JumpCloud -> SAP EmployeesInfo sync (fase 1: bases TST%)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { sapFetch } from "./sap-fetch.ts";

export const REQUIRED_UDFS = [
  "U_JC_UserId",
  "U_JC_EmployeeId",
  "U_JC_Active",
  "U_JC_Status",
  "U_JC_CreatedAt",
  "U_JC_UpdatedAt",
  "U_JC_LastSync",
  "U_JC_LastHash",
] as const;

export function assertTstCompany(companyDb: string | null | undefined): asserts companyDb is string {
  if (!companyDb || !/^TST/i.test(companyDb)) {
    throw new Error(
      "A integração de colaboradores está limitada a bases de teste com nome iniciado por TST.",
    );
  }
}

export function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/**
 * Load credentials for a given system+company_db from `system_credentials`.
 * Returns a map keyed by credential_key.
 */
export async function loadCredentials(
  supabase: ReturnType<typeof admin>,
  system: "jumpcloud" | "sap",
  companyDb: string,
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", system)
    .eq("company_db", companyDb);
  if (error) throw new Error(`Falha ao carregar credenciais ${system}: ${error.message}`);
  const map: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ credential_key: string; credential_value: string }>) {
    map[row.credential_key] = row.credential_value;
  }
  return map;
}

// -----------------------------------------------------------------------------
// JumpCloud
// -----------------------------------------------------------------------------

export interface JumpCloudUser {
  _id: string;
  username?: string;
  email?: string;
  firstname?: string;
  middlename?: string;
  lastname?: string;
  displayname?: string;
  jobTitle?: string;
  department?: string;
  employeeIdentifier?: string;
  suspended?: boolean;
  activated?: boolean;
  account_locked?: boolean;
  manager?: string | { id?: string; _id?: string };
  phoneNumbers?: Array<{ type?: string; number?: string }>;
  created?: string;
  lastupdated?: string;
}

export async function fetchAllJumpCloudUsers(
  apiKey: string,
  orgId?: string,
): Promise<JumpCloudUser[]> {
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (orgId) headers["x-org-id"] = orgId;

  const all: JumpCloudUser[] = [];
  const limit = 100;
  let skip = 0;
  while (true) {
    const r = await fetch(
      `https://console.jumpcloud.com/api/systemusers?limit=${limit}&skip=${skip}`,
      { headers },
    );
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`JumpCloud API ${r.status}: ${txt.slice(0, 200)}`);
    }
    const data = await r.json();
    const results: JumpCloudUser[] = data?.results ?? data ?? [];
    all.push(...results);
    if (results.length < limit) break;
    skip += limit;
    if (all.length > 10_000) break;
  }
  return all;
}

// -----------------------------------------------------------------------------
// SAP Service Layer
// -----------------------------------------------------------------------------

export interface SapSession {
  baseUrl: string;
  cookies: string;
  companyDB: string;
}

export async function sapLogin(creds: Record<string, string>): Promise<SapSession> {
  const baseUrl = (creds.base_url || creds.url || "").replace(/\/$/, "");
  const companyDB = creds.company_db || creds.CompanyDB;
  const userName = creds.username || creds.UserName;
  const password = creds.password || creds.Password;
  if (!baseUrl || !companyDB || !userName || !password) {
    throw new Error("Credenciais SAP incompletas (base_url, company_db, username, password).");
  }
  const r = await sapFetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ CompanyDB: companyDB, UserName: userName, Password: password }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`SAP Login falhou (${r.status}): ${txt.slice(0, 200)}`);
  }
  await r.body?.cancel().catch(() => {});
  const cookies = r.headers.get("set-cookie") || "";
  return { baseUrl, cookies, companyDB };
}

async function sapCall(
  session: SapSession,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${session.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers = new Headers(init.headers ?? {});
  headers.set("Cookie", session.cookies);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  return await sapFetch(url, { ...init, headers });
}

export async function sapListEmployees(
  session: SapSession,
  select = "EmployeeID,FirstName,MiddleName,LastName,EMail,U_JC_UserId,U_JC_LastHash,U_JC_Active,U_JC_Status",
): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];
  let path: string | null = `/EmployeesInfo?$select=${encodeURIComponent(select)}&$top=100`;
  while (path) {
    const r = await sapCall(session, path);
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`SAP EmployeesInfo GET ${r.status}: ${txt.slice(0, 200)}`);
    }
    const json = await r.json();
    const value = Array.isArray(json?.value) ? json.value : [];
    results.push(...value);
    const next = json?.["odata.nextLink"] ?? json?.["@odata.nextLink"];
    path = next ? `/${String(next).replace(/^\/+/, "")}` : null;
  }
  return results;
}

export async function sapCheckUdfs(session: SapSession): Promise<{
  present: string[];
  missing: string[];
}> {
  // Probe by asking $select for all UDFs; missing fields yield 400 individually,
  // so fetch $top=1 with a broad select and inspect keys.
  const r = await sapCall(
    session,
    `/EmployeesInfo?$top=1&$select=EmployeeID,${REQUIRED_UDFS.join(",")}`,
  );
  if (r.ok) {
    const json = await r.json();
    const sample = Array.isArray(json?.value) && json.value.length > 0 ? json.value[0] : null;
    if (sample) {
      const present = REQUIRED_UDFS.filter((k) => k in sample);
      const missing = REQUIRED_UDFS.filter((k) => !(k in sample));
      return { present, missing };
    }
    // no rows: probe each field individually
  } else {
    await r.body?.cancel().catch(() => {});
  }
  const present: string[] = [];
  const missing: string[] = [];
  for (const f of REQUIRED_UDFS) {
    const rr = await sapCall(session, `/EmployeesInfo?$top=1&$select=EmployeeID,${f}`);
    if (rr.ok) {
      present.push(f);
      await rr.body?.cancel().catch(() => {});
    } else {
      missing.push(f);
      await rr.body?.cancel().catch(() => {});
    }
  }
  return { present, missing };
}

export async function sapCreateEmployee(
  session: SapSession,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const r = await sapCall(session, `/EmployeesInfo`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`SAP POST EmployeesInfo ${r.status}: ${txt.slice(0, 400)}`);
  }
  return await r.json();
}

export async function sapPatchEmployee(
  session: SapSession,
  employeeId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const r = await sapCall(session, `/EmployeesInfo(${employeeId})`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`SAP PATCH EmployeesInfo(${employeeId}) ${r.status}: ${txt.slice(0, 400)}`);
  }
  await r.body?.cancel().catch(() => {});
}

// -----------------------------------------------------------------------------
// Normalization & hashing
// -----------------------------------------------------------------------------

export interface NormalizedEmployee {
  jumpCloudUserId: string;
  employeeIdentifier: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  displayName: string | null;
  email: string | null;
  jobTitle: string | null;
  departmentName: string | null;
  managerJumpCloudUserId: string | null;
  workPhone: string | null;
  mobilePhone: string | null;
  active: boolean;
  suspended: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

function s(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

function normPhone(v: unknown): string | null {
  const raw = s(v);
  if (!raw) return null;
  return raw.replace(/\s+/g, " ").trim();
}

function firstPhone(user: JumpCloudUser, type: "work" | "mobile"): string | null {
  if (!Array.isArray(user.phoneNumbers)) return null;
  const match = user.phoneNumbers.find((p) =>
    (p?.type || "").toLowerCase().includes(type)
  );
  return normPhone(match?.number ?? null);
}

export function normalizeJumpCloud(u: JumpCloudUser): NormalizedEmployee {
  const email = s(u.email)?.toLowerCase() ?? null;
  const manager =
    typeof u.manager === "string"
      ? u.manager
      : u.manager && typeof u.manager === "object"
        ? (u.manager as { id?: string; _id?: string }).id ?? (u.manager as { id?: string; _id?: string })._id ?? null
        : null;
  return {
    jumpCloudUserId: u._id,
    employeeIdentifier: s(u.employeeIdentifier),
    firstName: s(u.firstname),
    middleName: s(u.middlename),
    lastName: s(u.lastname),
    displayName: s(u.displayname) ?? ([s(u.firstname), s(u.lastname)].filter(Boolean).join(" ") || null),
    email,
    jobTitle: s(u.jobTitle),
    departmentName: s(u.department),
    managerJumpCloudUserId: s(manager),
    workPhone: firstPhone(u, "work"),
    mobilePhone: firstPhone(u, "mobile"),
    active: u.suspended !== true && u.account_locked !== true,
    suspended: u.suspended === true,
    createdAt: s(u.created),
    updatedAt: s(u.lastupdated),
  };
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashEmployee(
  e: NormalizedEmployee,
  extra: { departmentCode?: string | null; status: string },
): Promise<string> {
  const payload = [
    e.firstName, e.middleName, e.lastName, e.jobTitle, e.email,
    e.workPhone, e.mobilePhone,
    extra.departmentCode ?? "",
    e.managerJumpCloudUserId ?? "",
    extra.status,
  ].map((v) => (v ?? "").toString()).join("|");
  return await sha256Hex(payload);
}

export function buildSapPayload(
  e: NormalizedEmployee,
  opts: { departmentCode?: string | null; branchCode?: string | null; hash: string },
): Record<string, unknown> {
  const status = e.suspended ? "SUSPENDED" : e.active ? "ACTIVE" : "INACTIVE";
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    FirstName: e.firstName,
    MiddleName: e.middleName,
    LastName: e.lastName,
    JobTitle: e.jobTitle,
    EMail: e.email,
    WorkPhone: e.workPhone,
    MobilePhone: e.mobilePhone,
    U_JC_UserId: e.jumpCloudUserId,
    U_JC_EmployeeId: e.employeeIdentifier,
    U_JC_Active: e.active && !e.suspended ? "Y" : "N",
    U_JC_Status: status,
    U_JC_CreatedAt: e.createdAt ? e.createdAt.slice(0, 10) : null,
    U_JC_UpdatedAt: e.updatedAt ? e.updatedAt.slice(0, 10) : null,
    U_JC_LastSync: now,
    U_JC_LastHash: opts.hash,
  };
  if (opts.departmentCode) payload.Department = Number(opts.departmentCode) || opts.departmentCode;
  if (opts.branchCode) payload.Branch = Number(opts.branchCode) || opts.branchCode;
  // strip nulls -> Service Layer aceita null, mas evita zerar valores existentes por engano
  for (const k of Object.keys(payload)) if (payload[k] === null || payload[k] === undefined) delete payload[k];
  return payload;
}

export function computeChangedFields(
  current: Record<string, unknown>,
  desired: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(desired)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (k === "U_JC_LastSync") continue;
    const a = current[k] ?? null;
    const b = desired[k] ?? null;
    const na = typeof a === "string" ? a.trim() : a;
    const nb = typeof b === "string" ? b.trim() : b;
    if (String(na ?? "") !== String(nb ?? "")) changed.push(k);
  }
  return changed;
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
