// Helpers compartilhados pelos watchers de cache SAP (sap-nf-entrada-sync,
// sap-po-cache-sync, sap-vendor-payment-cache-sync, sap-fluxo-analise-sync).
//
// Consolida: buildBaseUrl, sapLogin(cookie|session), sapLogout, loadCreds,
// toIsoTimestamp, iteração por company_db e pager OData incremental.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { tryWatcherLock, releaseWatcherLock, isTestCompanyDb } from "./watcher-lock.ts";
import { sapFetch } from "./sap-fetch.ts";

export type Sb = ReturnType<typeof createClient>;

export function buildSapBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

/** Login SAP retornando cookie B1SESSION[; ROUTEID=…] para uso em headers Cookie. */
export async function sapCookieLogin(
  baseUrl: string,
  companyDb: string,
  username: string,
  password: string,
): Promise<string> {
  const r = await sapFetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: username, Password: password, CompanyDB: companyDb }),
  });
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}`);
  await r.json().catch(() => ({}));
  const sc = r.headers.get("set-cookie") || "";
  const s = sc.match(/B1SESSION=([^;]+)/)?.[1];
  const rt = sc.match(/ROUTEID=([^;]+)/)?.[1];
  if (!s) throw new Error("B1SESSION ausente");
  return `B1SESSION=${s}${rt ? `; ROUTEID=${rt}` : ""}`;
}

/** Login SAP retornando SessionId (necessário para chamadas HanaAPI). */
export async function sapSessionLogin(
  baseUrl: string,
  companyDb: string,
  username: string,
  password: string,
): Promise<{ sessionId: string; routeId: string }> {
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: username, Password: password, CompanyDB: companyDb }),
  });
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}: ${await r.text().catch(() => "")}`);
  const json = await r.json();
  const cookies = r.headers.get("set-cookie") || "";
  const routeMatch = cookies.match(/B1ROUTEID=([^;]+)/);
  return { sessionId: json.SessionId as string, routeId: routeMatch?.[1] ?? "" };
}

export async function sapLogout(baseUrl: string, cookie: string): Promise<void> {
  try {
    await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } });
  } catch { /* ignore */ }
}

export async function sapLogoutSession(
  baseUrl: string,
  session: { sessionId: string; routeId: string },
): Promise<void> {
  const cookie = `B1SESSION=${session.sessionId}${session.routeId ? `; B1ROUTEID=${session.routeId}` : ""}`;
  await sapLogout(baseUrl, cookie);
}

export interface LoadCredsOpts {
  /** Se true, exige que username seja "apiuser". Default: false. */
  requireApiuser?: boolean;
  /** Se true, exige credencial com use_hana_db != "false". Default: false. */
  requireHana?: boolean;
}

export async function loadSapCreds(
  sb: Sb,
  companyDb: string,
  opts: LoadCredsOpts = {},
): Promise<Record<string, string> | null> {
  const { data, error } = await sb
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (error) throw new Error(`Credenciais SAP erro: ${error.message}`);
  const kv: Record<string, string> = {};
  for (const r of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
    kv[r.credential_key] = r.credential_value ?? "";
  }
  if (!kv.service_layer_url || !kv.username || !kv.password) return null;
  if (opts.requireApiuser && (kv.username || "").trim().toLowerCase() !== "apiuser") return null;
  if (opts.requireHana && kv.use_hana_db === "false") return null;
  return kv;
}

/** Converte data (YYYY-MM-DD) + time SAP (HH:MM[:SS] ou "1035") em ISO UTC. */
export function toIsoTimestamp(date?: string | null, time?: string | null): string | null {
  if (!date) return null;
  let t = "00:00:00";
  if (time) {
    if (/^\d{1,4}$/.test(time)) {
      const padded = time.padStart(4, "0");
      t = `${padded.slice(0, 2)}:${padded.slice(2, 4)}:00`;
    } else if (/^\d{2}:\d{2}(:\d{2})?$/.test(time)) {
      t = time.length === 5 ? `${time}:00` : time;
    }
  }
  return `${date}T${t}Z`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner comum de watcher: parseia opções, adquire lock, itera company_db,
// respeita time budget e responde.

export interface WatcherResult {
  companyDb: string;
  synced: number;
  skipped?: string;
  error?: string;
  mode?: string;
}

export interface RunnerOpts {
  backfill: boolean;
  fromDate?: string;
  onlyCompany?: string;
}

export interface RunWatcherOpts {
  watcherName: string;
  timeBudgetMs?: number;
  /** Se false, não faz parse de backfill/from_date (apenas company_db). Default: true. */
  supportBackfill?: boolean;
  syncCompany: (sb: Sb, companyDb: string, opts: RunnerOpts) => Promise<WatcherResult>;
}

export async function runSapCacheWatcher(
  req: Request,
  { watcherName, timeBudgetMs = 90_000, supportBackfill = true, syncCompany }: RunWatcherOpts,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const gotLock = await tryWatcherLock(sb, watcherName, 10);
  if (!gotLock) {
    return new Response(
      JSON.stringify({ ok: true, skipped: "another_run_in_progress" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const startedAt = Date.now();
  const results: WatcherResult[] = [];

  let backfill = false;
  let fromDate: string | undefined;
  let onlyCompany: string | undefined;
  try {
    const url = new URL(req.url);
    if (supportBackfill && (url.searchParams.get("backfill") === "1" || url.searchParams.get("mode") === "backfill")) {
      backfill = true;
    }
    if (supportBackfill) fromDate = url.searchParams.get("from_date") || undefined;
    onlyCompany = url.searchParams.get("company_db") || undefined;
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (supportBackfill && body?.backfill) backfill = true;
      if (supportBackfill && body?.from_date) fromDate = body.from_date;
      if (body?.company_db) onlyCompany = body.company_db;
    }
  } catch { /* ignore */ }

  try {
    const { data: creds, error } = await sb
      .from("system_credentials")
      .select("company_db")
      .eq("system_name", "sap");
    if (error) throw new Error(error.message);
    let companyDbs = Array.from(new Set(
      (creds || []).map((c: { company_db: string }) => c.company_db).filter(Boolean),
    )) as string[];
    if (onlyCompany) companyDbs = companyDbs.filter((c) => c === onlyCompany);

    for (const companyDb of companyDbs) {
      if (Date.now() - startedAt > timeBudgetMs) {
        results.push({ companyDb, synced: 0, skipped: "time_budget_exceeded" });
        continue;
      }
      try {
        results.push(await syncCompany(sb, companyDb, { backfill, fromDate, onlyCompany }));
      } catch (e) {
        results.push({ companyDb, synced: 0, error: (e as Error).message });
      }
    }

    const totalSynced = results.reduce((s, r) => s + (r.synced || 0), 0);
    await releaseWatcherLock(sb, watcherName, "ok", `synced=${totalSynced} companies=${companyDbs.length}`);
    return new Response(
      JSON.stringify({ ok: true, total_synced: totalSynced, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    await releaseWatcherLock(sb, watcherName, "error", (e as Error).message);
    return new Response(
      JSON.stringify({ error: (e as Error).message, results }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pager incremental OData: itera páginas de uma entidade SAP mantendo cursor
// (UpdateDate + DocEntry) em uma tabela de state e fazendo upsert em uma tabela
// de cache. Devolve o resultado consolidado para o watcher.

export interface OdataDoc {
  DocEntry: number;
  UpdateDate?: string;
  UpdateTime?: string;
}

export interface IncrementalPagerOpts<T extends OdataDoc, R> {
  sb: Sb;
  companyDb: string;
  cookie: string;
  baseUrl: string;
  /** Nome da entidade OData: "PurchaseOrders" | "PurchaseInvoices" | "VendorPayments". */
  entity: string;
  /** Valor do $select (sem "$select="). */
  select: string;
  /** Tabela de state (cursor incremental). */
  stateTable: string;
  /** Tabela de cache alvo do upsert. */
  cacheTable: string;
  /** Chave de conflito do upsert. Default: "company_db,doc_entry". */
  onConflict?: string;
  /** Converte item SAP em linha para upsert. */
  mapRow: (item: T) => R;
  /** Backfill: ignora cursor de UpdateDate, avança apenas por DocEntry. */
  backfill?: boolean;
  fromDate?: string;
  pageSize?: number;
  maxPages?: number;
  timeBudgetMs?: number;
}

export async function runIncrementalPager<T extends OdataDoc, R>(
  o: IncrementalPagerOpts<T, R>,
): Promise<{ totalSynced: number; error: string | null; cursorEntry: number; cursorUpdate: string | null }> {
  const pageSize = o.pageSize ?? 100;
  const maxPages = o.maxPages ?? 40;
  const timeBudgetMs = o.timeBudgetMs ?? 90_000;
  const onConflict = o.onConflict ?? "company_db,doc_entry";

  const { data: stateRow } = await o.sb
    .from(o.stateTable)
    .select("last_update_date, last_doc_entry, total_synced")
    .eq("company_db", o.companyDb)
    .maybeSingle();

  const lastUpdate: string | null = o.backfill
    ? null
    : ((stateRow as { last_update_date?: string | null } | null)?.last_update_date ?? null);
  const lastDocEntry: number = o.backfill
    ? 0
    : ((stateRow as { last_doc_entry?: number | null } | null)?.last_doc_entry ?? 0);
  const totalPrev: number = Number((stateRow as { total_synced?: number | null } | null)?.total_synced ?? 0);

  let totalSynced = 0;
  let cursorUpdate = lastUpdate;
  let cursorEntry = lastDocEntry;
  let lastError: string | null = null;
  const startedAt = Date.now();

  for (let page = 0; page < maxPages; page++) {
    if (Date.now() - startedAt > timeBudgetMs) { lastError = "time_budget_exceeded"; break; }
    const filterParts: string[] = [];
    if (o.backfill) {
      if (o.fromDate) filterParts.push(`DocDate ge '${o.fromDate}'`);
      if (cursorEntry) filterParts.push(`DocEntry gt ${cursorEntry}`);
    } else {
      if (cursorUpdate) filterParts.push(`UpdateDate ge '${cursorUpdate.slice(0, 10)}'`);
      if (cursorEntry) filterParts.push(`DocEntry gt ${cursorEntry}`);
    }
    const filter = filterParts.length ? `&$filter=${encodeURIComponent(filterParts.join(" and "))}` : "";
    const url = `${o.baseUrl}/${o.entity}?$select=${o.select}&$orderby=DocEntry asc&$top=${pageSize}${filter}`;

    const r = await sapFetch(url, { headers: { Cookie: o.cookie, Prefer: "odata.maxpagesize=" + pageSize } });
    if (!r.ok) {
      lastError = `${o.entity} ${r.status}: ${(await r.text()).slice(0, 200)}`;
      break;
    }
    const j = await r.json();
    const items: T[] = j.value || [];
    if (items.length === 0) break;

    const rows = items.map(o.mapRow);
    const { error: upErr } = await o.sb.from(o.cacheTable).upsert(rows, { onConflict });
    if (upErr) { lastError = `upsert: ${upErr.message}`; break; }

    totalSynced += rows.length;
    const last = items[items.length - 1];
    cursorEntry = last.DocEntry;
    if (!o.backfill && last.UpdateDate) cursorUpdate = toIsoTimestamp(last.UpdateDate, last.UpdateTime);
    if (items.length < pageSize) break;
  }

  const basePayload: Record<string, unknown> = {
    company_db: o.companyDb,
    last_run_at: new Date().toISOString(),
    last_status: lastError ? "error" : "ok",
    last_batch_count: totalSynced,
    total_synced: totalPrev + totalSynced,
  };
  if (o.backfill) {
    basePayload.last_error = lastError ? `backfill: ${lastError}` : null;
  } else {
    basePayload.last_update_date = cursorUpdate;
    basePayload.last_doc_entry = cursorEntry;
    basePayload.last_error = lastError;
  }
  await o.sb.from(o.stateTable).upsert(basePayload, { onConflict: "company_db" });

  return { totalSynced, error: lastError, cursorEntry, cursorUpdate };
}
