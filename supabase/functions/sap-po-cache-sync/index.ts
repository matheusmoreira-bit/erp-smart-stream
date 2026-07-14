// Edge function: sap-po-cache-sync
// Sincronização incremental de PurchaseOrders (Pedidos de Compra) para
// public.sap_purchase_order_cache, análogo ao sap-nf-entrada-sync.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { tryWatcherLock, releaseWatcherLock, isTestCompanyDb } from "../_shared/watcher-lock.ts";
import { sapFetch } from "../_shared/sap-fetch.ts";

function buildBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function sapLogin(baseUrl: string, companyDB: string, u: string, p: string): Promise<string> {
  const r = await sapFetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: u, Password: p, CompanyDB: companyDB }),
  });
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}`);
  await r.json().catch(() => ({}));
  const sc = r.headers.get("set-cookie") || "";
  const s = sc.match(/B1SESSION=([^;]+)/)?.[1];
  const rt = sc.match(/ROUTEID=([^;]+)/)?.[1];
  if (!s) throw new Error("B1SESSION ausente");
  return `B1SESSION=${s}${rt ? `; ROUTEID=${rt}` : ""}`;
}

async function loadCreds(sb: ReturnType<typeof createClient>, companyDb: string) {
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
  // Watchers só autenticam como Apiuser
  if ((kv.username || "").trim().toLowerCase() !== "apiuser") return null;
  return kv;
}

interface SapPurchaseOrder {
  DocEntry: number;
  DocNum?: number;
  Series?: number;
  CardCode?: string;
  CardName?: string;
  DocDate?: string;
  DocDueDate?: string;
  DocTotal?: number;
  DocTotalFc?: number;
  DocCurrency?: string;
  DocumentStatus?: string;
  Cancelled?: string;
  UpdateDate?: string;
  UpdateTime?: string;
}

function toIsoTimestamp(date?: string, time?: string): string | null {
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

const PAGE_SIZE = 100;
const MAX_PAGES_PER_COMPANY = 40;
const MAX_PAGES_BACKFILL = 200;
const TIME_BUDGET_MS = 90_000;

interface SyncOpts {
  backfill?: boolean;
  fromDate?: string; // YYYY-MM-DD
  onlyCompany?: string;
}

async function syncCompany(
  sb: ReturnType<typeof createClient>,
  companyDb: string,
): Promise<{ companyDb: string; synced: number; skipped?: string; error?: string }> {
  if (isTestCompanyDb(companyDb)) return { companyDb, synced: 0, skipped: "test_base" };
  const creds = await loadCreds(sb, companyDb);
  if (!creds) return { companyDb, synced: 0, skipped: "no_credentials_or_not_apiuser" };

  const baseUrl = buildBaseUrl(creds.service_layer_url);
  let cookie: string;
  try {
    cookie = await sapLogin(baseUrl, creds.company_db || companyDb, creds.username, creds.password);
  } catch (e) {
    return { companyDb, synced: 0, error: (e as Error).message };
  }

  const { data: stateRow } = await sb
    .from("sap_purchase_order_sync_state")
    .select("last_update_date, last_doc_entry, total_synced")
    .eq("company_db", companyDb)
    .maybeSingle();

  const lastUpdate: string | null = (stateRow as { last_update_date?: string | null } | null)?.last_update_date ?? null;
  const lastDocEntry: number = (stateRow as { last_doc_entry?: number | null } | null)?.last_doc_entry ?? 0;
  const totalPrev: number = Number((stateRow as { total_synced?: number | null } | null)?.total_synced ?? 0);

  let totalSynced = 0;
  let cursorUpdate = lastUpdate;
  let cursorEntry = lastDocEntry;
  let lastError: string | null = null;

  try {
    for (let page = 0; page < MAX_PAGES_PER_COMPANY; page++) {
      const filterParts: string[] = [];
      if (cursorUpdate) filterParts.push(`UpdateDate ge '${cursorUpdate.slice(0, 10)}'`);
      if (cursorEntry) filterParts.push(`DocEntry gt ${cursorEntry}`);
      const filter = filterParts.length ? `&$filter=${encodeURIComponent(filterParts.join(" and "))}` : "";
      const select = "$select=DocEntry,DocNum,Series,CardCode,CardName,DocDate,DocDueDate,DocTotal,DocTotalFc,DocCurrency,DocumentStatus,Cancelled,UpdateDate,UpdateTime";
      const url = `${baseUrl}/PurchaseOrders?${select}&$orderby=DocEntry asc&$top=${PAGE_SIZE}${filter}`;

      const r = await sapFetch(url, { headers: { Cookie: cookie, Prefer: "odata.maxpagesize=" + PAGE_SIZE } });
      if (!r.ok) {
        lastError = `PurchaseOrders ${r.status}: ${(await r.text()).slice(0, 200)}`;
        break;
      }
      const j = await r.json();
      const items: SapPurchaseOrder[] = j.value || [];
      if (items.length === 0) break;

      const rows = items.map((inv) => ({
        company_db: companyDb,
        doc_entry: inv.DocEntry,
        doc_num: inv.DocNum ?? null,
        series: inv.Series ?? null,
        card_code: inv.CardCode ?? null,
        card_name: inv.CardName ?? null,
        doc_date: inv.DocDate ?? null,
        doc_due_date: inv.DocDueDate ?? null,
        doc_total: inv.DocTotal ?? null,
        doc_total_fc: inv.DocTotalFc ?? null,
        doc_currency: inv.DocCurrency ?? null,
        document_status: inv.DocumentStatus ?? null,
        cancelled: inv.Cancelled ?? null,
        raw_json: inv as unknown as Record<string, unknown>,
        sap_update_date: toIsoTimestamp(inv.UpdateDate, inv.UpdateTime),
        synced_at: new Date().toISOString(),
      }));

      const { error: upErr } = await sb
        .from("sap_purchase_order_cache")
        .upsert(rows, { onConflict: "company_db,doc_entry" });
      if (upErr) { lastError = `upsert: ${upErr.message}`; break; }

      totalSynced += rows.length;
      const last = items[items.length - 1];
      cursorEntry = last.DocEntry;
      if (last.UpdateDate) cursorUpdate = toIsoTimestamp(last.UpdateDate, last.UpdateTime);
      if (items.length < PAGE_SIZE) break;
    }
  } finally {
    await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
  }

  await sb.from("sap_purchase_order_sync_state").upsert({
    company_db: companyDb,
    last_update_date: cursorUpdate,
    last_doc_entry: cursorEntry,
    last_run_at: new Date().toISOString(),
    last_status: lastError ? "error" : "ok",
    last_error: lastError,
    last_batch_count: totalSynced,
    total_synced: totalPrev + totalSynced,
  }, { onConflict: "company_db" });

  return { companyDb, synced: totalSynced, error: lastError ?? undefined };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const gotLock = await tryWatcherLock(sb, "sap-po-cache-sync", 10);
  if (!gotLock) {
    return new Response(JSON.stringify({ ok: true, skipped: "another_run_in_progress" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const startedAt = Date.now();
  const results: Array<{ companyDb: string; synced: number; skipped?: string; error?: string }> = [];
  try {
    const { data: creds, error } = await sb
      .from("system_credentials")
      .select("company_db")
      .eq("system_name", "sap");
    if (error) throw new Error(error.message);
    const companyDbs = Array.from(new Set((creds || []).map((c: { company_db: string }) => c.company_db).filter(Boolean)));

    for (const companyDb of companyDbs) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) { results.push({ companyDb, synced: 0, skipped: "time_budget_exceeded" }); continue; }
      try { results.push(await syncCompany(sb, companyDb)); }
      catch (e) { results.push({ companyDb, synced: 0, error: (e as Error).message }); }
    }

    const totalSynced = results.reduce((s, r) => s + (r.synced || 0), 0);
    await releaseWatcherLock(sb, "sap-po-cache-sync", "ok", `synced=${totalSynced} companies=${companyDbs.length}`);
    return new Response(JSON.stringify({ ok: true, total_synced: totalSynced, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    await releaseWatcherLock(sb, "sap-po-cache-sync", "error", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message, results }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
