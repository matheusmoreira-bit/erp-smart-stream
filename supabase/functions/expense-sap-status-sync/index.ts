// Edge function: expense-sap-status-sync
// Sincroniza periodicamente o status dos Pedidos de Compra (PO) no SAP B1
// para expenses que já foram lançadas (sap_doc_entry preenchido).
// Atualiza expenses.sap_purchase_order_status e, quando o PO é cancelado no
// SAP, move expenses.status para 'cancelado'.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { tryWatcherLock, releaseWatcherLock, isTestCompanyDb } from "../_shared/watcher-lock.ts";

interface ExpenseRow {
  id: string;
  company_db: string;
  sap_doc_entry: number | null;
  status: string;
  supplier_name: string;
}

function buildBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function sapLogin(baseUrl: string, companyDB: string, u: string, p: string): Promise<string> {
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: u, Password: p, CompanyDB: companyDB }),
  });
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}: ${(await r.text()).slice(0, 200)}`);
  await r.json();
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
  if (!kv.service_layer_url || !kv.username || !kv.password) {
    throw new Error(`Credenciais SAP ausentes para ${companyDb}`);
  }
  return kv;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const gotLock = await tryWatcherLock(sb, "expense-sap-status-sync", 10);
  if (!gotLock) {
    return new Response(
      JSON.stringify({ ok: true, skipped: "another_run_in_progress" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const results: Array<{ id: string; docEntry?: number; poStatus?: string; expenseStatus?: string; error?: string }> = [];
  const startedAt = Date.now();

  // Permite forçar sincronia de IDs específicos via POST body { expenseIds: string[] }
  let expenseIdsFilter: string[] | null = null;
  let trigger = "cron";
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (Array.isArray(body?.expenseIds) && body.expenseIds.length) {
        expenseIdsFilter = body.expenseIds.map((v: unknown) => String(v));
        trigger = "manual";
      }
    } catch { /* body opcional */ }
  }

  // Registra a execução em curso
  const { data: runRow } = await sb
    .from("expense_sap_sync_runs")
    .insert({ trigger, status: "running" })
    .select("id")
    .single();
  const runId = (runRow as { id?: string } | null)?.id ?? null;

  try {

    // Alvos: expenses com sap_doc_entry preenchido e status não-terminal
    // ('finalizado' e 'cancelado' são terminais e não precisam de polling contínuo).
    let query = sb
      .from("expenses")
      .select("id, company_db, sap_doc_entry, status, supplier_name")
      .not("sap_doc_entry", "is", null)
      .not("status", "in", "(finalizado,cancelado,rascunho)")
      .order("sap_integration_last_attempt_at", { ascending: true, nullsFirst: true })
      .limit(200);

    if (expenseIdsFilter) query = query.in("id", expenseIdsFilter);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    // Agrupar por company_db para reaproveitar sessão SAP
    const byCompany = new Map<string, ExpenseRow[]>();
    for (const r of (rows || []) as ExpenseRow[]) {
      if (!r.company_db || r.sap_doc_entry == null) continue;
      if (isTestCompanyDb(r.company_db)) {
        results.push({ id: r.id, error: "test_base" });
        continue;
      }
      const arr = byCompany.get(r.company_db) || [];
      arr.push(r);
      byCompany.set(r.company_db, arr);
    }

    for (const [companyDb, list] of byCompany) {
      let cookie = "";
      let baseUrl = "";
      try {
        const creds = await loadCreds(sb, companyDb);
        baseUrl = buildBaseUrl(creds.service_layer_url);
        cookie = await sapLogin(baseUrl, creds.company_db || companyDb, creds.username, creds.password);
      } catch (e) {
        for (const row of list) results.push({ id: row.id, error: (e as Error).message });
        continue;
      }

      try {
        for (const row of list) {
          const docEntry = Number(row.sap_doc_entry);
          try {
            const r = await fetch(
              `${baseUrl}/PurchaseOrders(${docEntry})?$select=DocEntry,DocNum,DocumentStatus,Cancelled`,
              { headers: { Cookie: cookie } },
            );

            const now = new Date().toISOString();

            if (r.status === 404) {
              await sb.from("expenses").update({
                sap_purchase_order_status: "not_found",
                sap_integration_last_attempt_at: now,
              }).eq("id", row.id);
              results.push({ id: row.id, docEntry, poStatus: "not_found" });
              continue;
            }
            if (!r.ok) throw new Error(`PO fetch ${r.status}: ${(await r.text()).slice(0, 200)}`);

            const po = await r.json();
            const cancelled = po.Cancelled === "tYES";
            const closed = po.DocumentStatus === "bost_Close";
            const poStatus = cancelled ? "cancelled" : closed ? "closed" : "open";

            const patch: Record<string, unknown> = {
              sap_purchase_order_status: poStatus,
              sap_integration_last_attempt_at: now,
              sap_integration_error: null,
            };

            let newExpenseStatus: string | undefined;
            if (cancelled && row.status !== "cancelado") {
              patch.status = "cancelado";
              newExpenseStatus = "cancelado";
            } else if (closed && (row.status === "pc_lancado" || row.status === "aprovado")) {
              // PO fechado no SAP normalmente indica que foi copiado para NF de entrada.
              patch.status = "nf_entrada";
              newExpenseStatus = "nf_entrada";
            }

            await sb.from("expenses").update(patch).eq("id", row.id);
            results.push({ id: row.id, docEntry, poStatus, expenseStatus: newExpenseStatus });
          } catch (e) {
            const msg = (e as Error).message;
            await sb.from("expenses").update({
              sap_integration_last_attempt_at: new Date().toISOString(),
              sap_integration_error: msg.slice(0, 500),
            }).eq("id", row.id);
            results.push({ id: row.id, docEntry, error: msg });
          }
        }
      } finally {
        await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
      }
    }

    const errors = results.filter((r) => r.error);
    const updated = results.filter((r) => r.expenseStatus);
    const skipped = results.filter((r) => r.error === "test_base");
    if (runId) {
      await sb.from("expense_sap_sync_runs").update({
        status: "ok",
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        processed_count: results.length,
        updated_count: updated.length,
        error_count: errors.length,
        skipped_count: skipped.length,
        results,
        errors,
      }).eq("id", runId);
    }
    await releaseWatcherLock(sb, "expense-sap-status-sync", "ok", `processed=${results.length}`);
    return new Response(JSON.stringify({ ok: true, runId, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message;
    const errors = results.filter((r) => r.error);
    if (runId) {
      await sb.from("expense_sap_sync_runs").update({
        status: "error",
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        processed_count: results.length,
        error_count: errors.length,
        results,
        errors,
        error_message: msg,
      }).eq("id", runId);
    }
    await releaseWatcherLock(sb, "expense-sap-status-sync", "error", msg);
    return new Response(JSON.stringify({ ok: false, runId, error: msg, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
