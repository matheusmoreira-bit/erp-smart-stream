// Edge function: sap-fluxo-analise-sync
// Sincroniza a view HANA VW_FIN_ANALISE_FLUXO em public.sap_fluxo_analise_cache
// para cada empresa SAP com credenciais Apiuser configuradas.
//
// A view retorna uma linha por documento do fluxo financeiro, com as datas
// de atualização do esboço, aprovação, lançamento, vencimento e pagamento,
// além dos IDs que amarram Esboço → Pedido → NF → CP.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { tryWatcherLock, releaseWatcherLock, isTestCompanyDb } from "../_shared/watcher-lock.ts";
import { fetchHanaView } from "../_shared/hana-views.ts";

const TIME_BUDGET_MS = 90_000;

const HANA_SCHEMA_OVERRIDES: Record<string, string> = { open_gaming_sa: "SBO_OPENGAMING" };

function buildBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function sapLogin(baseUrl: string, u: string, p: string, db: string) {
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: u, Password: p, CompanyDB: db }),
  });
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}: ${await r.text().catch(() => "")}`);
  const json = await r.json();
  const cookies = r.headers.get("set-cookie") || "";
  const routeMatch = cookies.match(/B1ROUTEID=([^;]+)/);
  return { sessionId: json.SessionId as string, routeId: routeMatch?.[1] ?? "" };
}

async function sapLogout(baseUrl: string, s: { sessionId: string; routeId: string }) {
  try {
    await fetch(`${baseUrl}/Logout`, {
      method: "POST",
      headers: { Cookie: `B1SESSION=${s.sessionId}${s.routeId ? `; B1ROUTEID=${s.routeId}` : ""}` },
    });
  } catch { /* ignore */ }
}

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const n2 = Number(v);
  return Number.isFinite(n2) ? n2 : null;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function mapRow(raw: Record<string, unknown>, companyDb: string) {
  const dataAtualizacao = toIso(pick(raw, "Data Atualização Esboço", "Data_Atualizacao_Esboco", "dataAtualizacaoEsboco"));
  const solicitante = toStr(pick(raw, "Solicitante", "solicitante"));
  const departamento = toStr(pick(raw, "Departamento", "departamento"));
  const centroCusto = toStr(pick(raw, "Centro de Custo", "Centro_de_Custo", "centroCusto"));
  const marca = toStr(pick(raw, "Marca/Brand", "Marca", "marca", "Brand"));
  const descricao = toStr(pick(raw, "Descrição", "Descricao", "descricao"));
  const aprovador = toStr(pick(raw, "Aprovador", "aprovador"));
  const dataAprovacao = toIso(pick(raw, "Data Aprovação", "Data_Aprovacao", "dataAprovacao"));
  const fornecedor = toStr(pick(raw, "Fornecedor", "fornecedor"));
  const valor = toNum(pick(raw, "Valor", "valor"));
  const dataVencimento = toIso(pick(raw, "Data Vencimento", "Data_Vencimento", "dataVencimento"));
  const dataLancamento = toIso(pick(raw, "Data Lançamento", "Data_Lancamento", "dataLancamento"));
  const dataPagamento = toIso(pick(raw, "Data Pagamento", "Data_Pagamento", "dataPagamento"));
  const idEsboco = toStr(pick(raw, "ID Esboço", "ID_Esboco", "idEsboco"));
  const idPedido = toStr(pick(raw, "ID Pedido", "ID_Pedido", "idPedido"));
  const idNf = toStr(pick(raw, "ID NF", "ID_NF", "idNf"));
  const idCp = toStr(pick(raw, "ID CP", "ID_CP", "idCp"));

  const flowKey =
    (idEsboco && `E:${idEsboco}`) ||
    (idPedido && `P:${idPedido}`) ||
    (idNf && `N:${idNf}`) ||
    (idCp && `C:${idCp}`) ||
    null;
  if (!flowKey) return null;

  return {
    company_db: companyDb,
    flow_key: flowKey,
    data_atualizacao_esboco: dataAtualizacao,
    solicitante,
    departamento,
    centro_custo: centroCusto,
    marca,
    descricao,
    aprovador,
    data_aprovacao: dataAprovacao,
    fornecedor,
    valor,
    data_vencimento: dataVencimento,
    data_lancamento: dataLancamento,
    data_pagamento: dataPagamento,
    id_esboco: idEsboco,
    id_pedido: idPedido,
    id_nf: idNf,
    id_cp: idCp,
    raw_json: raw as unknown as Record<string, unknown>,
    synced_at: new Date().toISOString(),
  };
}

async function loadCreds(sb: any, companyDb: string): Promise<Record<string, string> | null> {
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
  if (kv.use_hana_db === "false") return null;
  if ((kv.username || "").trim().toLowerCase() !== "apiuser") return null;
  return kv;
}

async function syncCompany(sb: any, companyDb: string): Promise<{
  companyDb: string; synced: number; skipped?: string; error?: string;
}> {
  if (isTestCompanyDb(companyDb)) return { companyDb, synced: 0, skipped: "test_base" };
  const creds = await loadCreds(sb, companyDb);
  if (!creds) return { companyDb, synced: 0, skipped: "no_credentials_or_not_apiuser" };

  const baseUrl = buildBaseUrl(creds.service_layer_url);
  const dbName = creds.company_db || companyDb;
  const schema = HANA_SCHEMA_OVERRIDES[companyDb] || dbName;
  let session: { sessionId: string; routeId: string };
  try {
    session = await sapLogin(baseUrl, creds.username, creds.password, dbName);
  } catch (e) {
    return { companyDb, synced: 0, error: (e as Error).message };
  }

  let synced = 0;
  let lastError: string | null = null;
  try {
    const rawRows = await fetchHanaView({
      schema,
      view: "VW_FIN_ANALISE_FLUXO",
      sessionId: session.sessionId,
      hanaApiUrl: creds.hana_api_url,
      useV2: creds.use_hana_v2 === "true" || creds.hana_api_v2 === "true",
    });
    const seen = new Map<string, ReturnType<typeof mapRow>>();
    for (const r of rawRows) {
      const row = mapRow(r, companyDb);
      if (!row) continue;
      seen.set(`${row.company_db}::${row.flow_key}`, row);
    }
    const rows = Array.from(seen.values()).filter((r): r is NonNullable<typeof r> => !!r);

    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const { error } = await sb
        .from("sap_fluxo_analise_cache")
        .upsert(slice, { onConflict: "company_db,flow_key" });
      if (error) { lastError = `upsert: ${error.message}`; break; }
      synced += slice.length;
    }
  } catch (e) {
    lastError = (e as Error).message;
  } finally {
    await sapLogout(baseUrl, session);
  }

  const { data: prev } = await sb
    .from("sap_fluxo_analise_sync_state")
    .select("total_synced")
    .eq("company_db", companyDb)
    .maybeSingle();
  const totalPrev = Number((prev as { total_synced?: number } | null)?.total_synced ?? 0);

  await sb.from("sap_fluxo_analise_sync_state").upsert({
    company_db: companyDb,
    last_run_at: new Date().toISOString(),
    last_status: lastError ? "error" : "ok",
    last_error: lastError,
    last_batch_count: synced,
    total_synced: totalPrev + synced,
  }, { onConflict: "company_db" });

  return { companyDb, synced, error: lastError ?? undefined };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const gotLock = await tryWatcherLock(sb, "sap-fluxo-analise-sync", 10);
  if (!gotLock) {
    return new Response(JSON.stringify({ ok: true, skipped: "another_run_in_progress" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const startedAt = Date.now();
  const results: Array<{ companyDb: string; synced: number; skipped?: string; error?: string }> = [];

  let onlyCompany: string | undefined;
  try {
    const url = new URL(req.url);
    onlyCompany = url.searchParams.get("company_db") || undefined;
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.company_db) onlyCompany = body.company_db;
    }
  } catch { /* ignore */ }

  try {
    const { data: creds, error } = await sb
      .from("system_credentials")
      .select("company_db")
      .eq("system_name", "sap");
    if (error) throw new Error(error.message);
    let companyDbs = Array.from(new Set((creds || [])
      .map((c: { company_db: string }) => c.company_db)
      .filter(Boolean))) as string[];
    if (onlyCompany) companyDbs = companyDbs.filter((c) => c === onlyCompany);

    for (const companyDb of companyDbs) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        results.push({ companyDb, synced: 0, skipped: "time_budget_exceeded" });
        continue;
      }
      try { results.push(await syncCompany(sb, companyDb)); }
      catch (e) { results.push({ companyDb, synced: 0, error: (e as Error).message }); }
    }

    const totalSynced = results.reduce((s, r) => s + (r.synced || 0), 0);
    await releaseWatcherLock(sb, "sap-fluxo-analise-sync", "ok", `synced=${totalSynced} companies=${companyDbs.length}`);
    return new Response(JSON.stringify({ ok: true, total_synced: totalSynced, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    await releaseWatcherLock(sb, "sap-fluxo-analise-sync", "error", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message, results }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
