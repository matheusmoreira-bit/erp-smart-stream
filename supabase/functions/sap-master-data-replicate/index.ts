// Edge function: sap-master-data-replicate
// Replica cadastros mestres (fornecedores, clientes e itens) de uma empresa SAP
// de origem para outra empresa SAP de destino (tipicamente produção → teste).
//
// POST {
//   source_company_db: string,
//   target_company_db: string,
//   scope: "suppliers" | "customers" | "items",
//   offset?: number,      // paginação da origem (default 0)
//   limit?: number,       // registros por chamada (default 50, máx 200)
//   dry_run?: boolean,    // só verifica o que falta, não grava no destino
// }
//
// Resposta: { total, processed, created, skipped, failed, errors[], next_offset }
// Registros já existentes no destino são PULADOS (nunca sobrescritos).
//
// Auth: service-role / scheduler secret / administrador Cloud.

import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireSchedulerOrAdmin, serviceClient } from "../_shared/automation-auth.ts";
import { sapFetch } from "../_shared/sap-fetch.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-company-db",
};

type Scope = "suppliers" | "customers" | "items";

interface Session {
  baseUrl: string;
  sessionId: string;
  routeId: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (!/\/b1s\/v\d+/.test(url)) url = `${url}/b1s/v1`;
  return url;
}

async function loadCreds(sb: any, companyDb: string): Promise<Record<string, string>> {
  const { data, error } = await sb
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (error) throw new Error(`Credenciais SAP (${companyDb}): ${error.message}`);
  const kv: Record<string, string> = {};
  for (const r of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
    kv[r.credential_key] = r.credential_value ?? "";
  }
  if (!kv.service_layer_url || !kv.username || !kv.password) {
    throw new Error(`Empresa ${companyDb} sem credenciais SAP configuradas.`);
  }
  return kv;
}

async function login(sb: any, companyDb: string): Promise<Session> {
  const creds = await loadCreds(sb, companyDb);
  const baseUrl = buildBaseUrl(creds.service_layer_url);
  const r = await sapFetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      UserName: creds.username,
      Password: creds.password,
      CompanyDB: creds.company_db || companyDb,
    }),
    timeoutMs: 20_000,
  });
  if (!r.ok) {
    throw new Error(`Login SAP (${companyDb}) falhou ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  }
  const data = await r.json();
  const routeId = (r.headers.get("set-cookie") || "").match(/B1ROUTEID=([^;]+)/)?.[1] ?? "";
  return { baseUrl, sessionId: data.SessionId as string, routeId };
}

function cookie(s: Session) {
  return `B1SESSION=${s.sessionId}${s.routeId ? `; B1ROUTEID=${s.routeId}` : ""}`;
}

async function logout(s: Session) {
  try {
    await sapFetch(`${s.baseUrl}/Logout`, {
      method: "POST",
      headers: { Cookie: cookie(s) },
      timeoutMs: 10_000,
      maxAttempts: 1,
    });
  } catch { /* ignore */ }
}

async function slGet(s: Session, path: string): Promise<any> {
  const r = await sapFetch(`${s.baseUrl}/${path}`, {
    headers: { Cookie: cookie(s), Prefer: "odata.maxpagesize=0" },
    timeoutMs: 45_000,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`SAP GET ${path} -> ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function slPost(s: Session, path: string, payload: unknown): Promise<{ ok: boolean; error?: string }> {
  const r = await sapFetch(`${s.baseUrl}/${path}`, {
    method: "POST",
    headers: { Cookie: cookie(s), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 45_000,
    maxAttempts: 2,
  });
  if (r.ok) {
    await r.body?.cancel().catch(() => {});
    return { ok: true };
  }
  const text = await r.text().catch(() => "");
  let msg = text.slice(0, 300);
  try {
    msg = JSON.parse(text)?.error?.message?.value ?? msg;
  } catch { /* ignore */ }
  return { ok: false, error: `${r.status}: ${msg}` };
}

/* ───────────────── campos copiados ───────────────── */

const BP_FIELDS = [
  "CardCode", "CardName", "CardType", "GroupCode", "AliasName", "Address", "ZipCode",
  "MailAddress", "MailZipCode", "Phone1", "Phone2", "Fax", "ContactPerson", "Notes",
  "Currency", "FederalTaxID", "AdditionalID", "Cellular", "County", "Country", "Block",
  "EmailAddress", "City", "MailCity", "MailCounty", "MailCountry", "MailBlock",
  "StreetNo", "MailStreetNo", "Building", "MailBuilding", "FreeText", "ValidFor",
  "Frozen", "IndustryType", "BusinessType", "VatLiable", "UnifiedFederalTaxID",
  "PayTermsGrpCode", "VatGroup", "Website", "CompanyPrivate", "TaxRoundingRule",
];

const BP_MIN_FIELDS = ["CardCode", "CardName", "CardType", "FederalTaxID", "Currency", "GroupCode"];

const ITEM_FIELDS = [
  "ItemCode", "ItemName", "ForeignName", "ItemsGroupCode", "ItemType", "BarCode",
  "VatLiable", "PurchaseItem", "SalesItem", "InventoryItem", "Valid", "Frozen",
  "InventoryUOM", "SalesUnit", "PurchaseUnit", "PurchaseVATGroup", "SalesVATGroup",
  "MaterialType", "ManageSerialNumbers", "ManageBatchNumbers", "UserText",
  "NCMCode", "MaterialGroup", "ProductSource", "ItemClass", "ServiceCategory",
];

const ITEM_MIN_FIELDS = ["ItemCode", "ItemName", "ItemsGroupCode", "ItemType"];

function pickFields(src: Record<string, unknown>, allowed: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    const v = src[key];
    if (v === undefined || v === null || v === "") continue;
    out[key] = v;
  }
  // Campos de usuário (U_*) costumam existir nas duas bases.
  for (const [k, v] of Object.entries(src)) {
    if (!k.startsWith("U_")) continue;
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out;
}

interface ScopeSpec {
  resource: "BusinessPartners" | "Items";
  keyField: "CardCode" | "ItemCode";
  filter?: string;
  fields: string[];
  minFields: string[];
}

const SPECS: Record<Scope, ScopeSpec> = {
  suppliers: {
    resource: "BusinessPartners",
    keyField: "CardCode",
    filter: "CardType eq 'cSupplier'",
    fields: BP_FIELDS,
    minFields: BP_MIN_FIELDS,
  },
  customers: {
    resource: "BusinessPartners",
    keyField: "CardCode",
    filter: "CardType eq 'cCustomer'",
    fields: BP_FIELDS,
    minFields: BP_MIN_FIELDS,
  },
  items: {
    resource: "Items",
    keyField: "ItemCode",
    fields: ITEM_FIELDS,
    minFields: ITEM_MIN_FIELDS,
  },
};

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    p.set(k, String(v));
  }
  return p.toString() ? `?${p.toString()}` : "";
}

function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

/** Códigos já existentes no destino, entre os códigos informados. */
async function existingCodes(target: Session, spec: ScopeSpec, codes: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const chunkSize = 20;
  for (let i = 0; i < codes.length; i += chunkSize) {
    const chunk = codes.slice(i, i + chunkSize);
    const filter = chunk.map((c) => `${spec.keyField} eq '${escapeOData(c)}'`).join(" or ");
    const data = await slGet(
      target,
      `${spec.resource}${qs({ $select: spec.keyField, $filter: filter })}`,
    );
    for (const row of (data?.value ?? []) as Array<Record<string, string>>) {
      const code = row[spec.keyField];
      if (code) found.add(String(code));
    }
  }
  return found;
}

const DB_RE = /^[A-Za-z0-9_-]{1,64}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;

  let source: Session | null = null;
  let target: Session | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const sourceDb = String(body?.source_company_db || "").trim();
    const targetDb = String(body?.target_company_db || "").trim();
    const scope = String(body?.scope || "").trim() as Scope;
    const offset = Math.max(0, Number(body?.offset) || 0);
    const limit = Math.min(Math.max(Number(body?.limit) || 50, 1), 200);
    const dryRun = Boolean(body?.dry_run);

    if (!DB_RE.test(sourceDb) || !DB_RE.test(targetDb)) {
      return json({ error: "source_company_db e target_company_db obrigatórios" }, 400);
    }
    if (sourceDb === targetDb) return json({ error: "Origem e destino não podem ser iguais" }, 400);
    if (!SPECS[scope]) return json({ error: "scope inválido (suppliers | customers | items)" }, 400);

    const spec = SPECS[scope];
    const sb = serviceClient();

    source = await login(sb, sourceDb);
    target = await login(sb, targetDb);

    // Total na origem (uma vez por execução do painel, mas barato o bastante).
    const countData = await slGet(
      source,
      `${spec.resource}/$count${qs({ $filter: spec.filter })}`,
    ).catch(() => null);
    const total = typeof countData === "number"
      ? countData
      : Number(countData ?? NaN);

    const page = await slGet(
      source,
      `${spec.resource}${qs({
        $filter: spec.filter,
        $orderby: spec.keyField,
        $skip: offset,
        $top: limit,
      })}`,
    );
    const rows = (page?.value ?? []) as Array<Record<string, unknown>>;
    const codes = rows.map((r) => String(r[spec.keyField] ?? "")).filter(Boolean);

    const already = codes.length ? await existingCodes(target, spec, codes) : new Set<string>();

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ code: string; error: string }> = [];

    for (const row of rows) {
      const code = String(row[spec.keyField] ?? "");
      if (!code) continue;
      if (already.has(code)) {
        skipped++;
        continue;
      }
      if (dryRun) {
        created++; // no dry-run, "created" = quantos seriam criados
        continue;
      }

      const payload = pickFields(row, spec.fields);
      let res = await slPost(target, spec.resource, payload);
      if (!res.ok) {
        // segunda tentativa com o conjunto mínimo de campos
        const minimal = pickFields(row, spec.minFields);
        const retry = await slPost(target, spec.resource, minimal);
        if (retry.ok) res = retry;
        else {
          failed++;
          errors.push({ code, error: retry.error || res.error || "erro desconhecido" });
          continue;
        }
      }
      created++;
    }

    const nextOffset = rows.length === limit ? offset + limit : null;

    return json({
      success: true,
      scope,
      source_company_db: sourceDb,
      target_company_db: targetDb,
      dry_run: dryRun,
      total: Number.isFinite(total) ? total : null,
      processed: rows.length,
      created,
      skipped,
      failed,
      errors: errors.slice(0, 50),
      next_offset: nextOffset,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  } finally {
    if (source) await logout(source);
    if (target) await logout(target);
  }
});
