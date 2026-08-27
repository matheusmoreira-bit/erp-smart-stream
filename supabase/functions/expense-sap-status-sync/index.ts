// Edge function: expense-sap-status-sync
// Sincroniza periodicamente a etapa atual das compras no SAP B1 usando o PO,
// as NFs de entrada e os valores pagos mantidos nos caches de integração.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { tryWatcherLock, releaseWatcherLock } from "../_shared/watcher-lock.ts";
import { blockIfIntegrationsDisabled } from "../_shared/integrations-mode.ts";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import {
  deriveExpenseLifecycleStatus,
  type SapInvoiceLifecycle,
} from "../_shared/expense-status-chain.ts";

interface ExpenseRow {
  id: string;
  company_db: string;
  sap_doc_entry: number | null;
  status: string;
  supplier_name: string;
  total_amount: number | null;
  sap_sync_attempts?: number | null;
  sap_purchase_order_status?: string | null;
}

interface NfCacheRow {
  base_po_doc_entry: number | null;
  doc_total: number | null;
  paid_to_date?: number | null;
  cancelled: string | null;
}

// Backoff exponencial: 1, 2, 4, 8, 16, 32, 60min (cap 60), depois desiste (deixa em sync_error).
const MAX_RETRY_ATTEMPTS = 8;
function nextRetryDelayMs(attempts: number): number {
  const minutes = Math.min(60, Math.pow(2, Math.max(0, attempts - 1)));
  return minutes * 60_000;
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
  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;
  const disabled = blockIfIntegrationsDisabled(corsHeaders);
  if (disabled) return disabled;

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

  const results: Array<{ id: string; docEntry?: number; poStatus?: string; expenseStatus?: string; error?: string; attempts?: number; nextRetryAt?: string | null }> = [];
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

    // Alvos: documentos já aprovados, cuja etapa atual é determinada pelo PO,
    // pelas NFs e pelos pagamentos conhecidos no cache SAP.
    let query = sb
      .from("expenses")
      .select("id, company_db, sap_doc_entry, status, supplier_name, total_amount, sap_sync_attempts, sap_purchase_order_status")
      .not("sap_doc_entry", "is", null)
      .in("status", ["aprovado", "pc_lancado", "nf_entrada", "pagamento", "finalizado"])
      .order("sap_status_last_check_at", { ascending: true, nullsFirst: true })
      .limit(200);

    if (expenseIdsFilter) {
      // Execução manual ignora janela de backoff — usuário decidiu forçar.
      query = query.in("id", expenseIdsFilter);
    } else {
      // Execução automática respeita sap_sync_next_retry_at (backoff).
      query = query.or("sap_sync_next_retry_at.is.null,sap_sync_next_retry_at.lte." + new Date().toISOString());
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    // Agrupar por company_db para reaproveitar sessão SAP
    const byCompany = new Map<string, ExpenseRow[]>();
    for (const r of (rows || []) as ExpenseRow[]) {
      if (!r.company_db || r.sap_doc_entry == null) continue;
      const arr = byCompany.get(r.company_db) || [];
      arr.push(r);
      byCompany.set(r.company_db, arr);
    }

    // Helper: registra falha em uma despesa com backoff exponencial.
    const recordFailure = async (row: ExpenseRow, msg: string, extra?: { nextRetryAt?: string }) => {
      const attempts = (row.sap_sync_attempts ?? 0) + 1;
      const delayMs = nextRetryDelayMs(attempts);
      const nextRetryAt = extra?.nextRetryAt ?? (
        attempts >= MAX_RETRY_ATTEMPTS ? null : new Date(Date.now() + delayMs).toISOString()
      );
      await sb.from("expenses").update({
        sap_integration_last_attempt_at: new Date().toISOString(),
        sap_status_last_check_at: new Date().toISOString(),
        sap_integration_error: msg.slice(0, 500),
        sap_sync_state: "sync_error",
        sap_sync_attempts: attempts,
        sap_sync_next_retry_at: nextRetryAt,
      }).eq("id", row.id);
      return { attempts, nextRetryAt };
    };

    // Freshness do cache PO: 3h. Watcher sap-po-cache-sync roda a cada minuto (delta por
    // UpdateDate), então em condições normais os dados estarão a segundos. Usamos margem
    // ampla para tolerar janelas em que o cache está atrasado.
    const CACHE_MAX_AGE_MS = 3 * 60 * 60 * 1000;
    const cacheCutoffIso = new Date(Date.now() - CACHE_MAX_AGE_MS).toISOString();

    // Aplica um resultado de status (vindo de cache OU do SL) na expense.
    const applyStatus = async (
      row: ExpenseRow,
      docEntry: number,
      documentStatus: string | null,
      cancelledRaw: string | null,
      invoices: SapInvoiceLifecycle[],
      source: "cache" | "sl",
    ) => {
      const now = new Date().toISOString();
      const cancelled = cancelledRaw === "tYES";
      const closed = documentStatus === "bost_Close";
      const poStatus = cancelled ? "cancelled" : closed ? "closed" : "open";
      const patch: Record<string, unknown> = {
        sap_purchase_order_status: poStatus,
        sap_status_last_check_at: now,
        sap_integration_error: null,
        sap_sync_state: "ok",
        sap_sync_attempts: 0,
        sap_sync_next_retry_at: null,
      };
      const derivedStatus = deriveExpenseLifecycleStatus({
        currentStatus: row.status,
        expenseTotal: row.total_amount,
        poDocumentStatus: documentStatus,
        poCancelled: cancelledRaw,
        invoices,
      });
      let newExpenseStatus: string | undefined;
      if (derivedStatus !== row.status) {
        patch.status = derivedStatus;
        newExpenseStatus = derivedStatus;
      }
      const poStatusChanged = row.sap_purchase_order_status !== poStatus;
      if (poStatusChanged || newExpenseStatus) patch.sap_integration_last_attempt_at = now;
      await sb.from("expenses").update(patch).eq("id", row.id);
      results.push({ id: row.id, docEntry, poStatus, expenseStatus: newExpenseStatus, source } as typeof results[number] & { source?: string });
    };

    for (const [companyDb, list] of byCompany) {
      // 1) Cache-first: tenta resolver via sap_purchase_order_cache para evitar login SAP.
      const docEntries = list
        .map((r) => Number(r.sap_doc_entry))
        .filter((n) => Number.isFinite(n));
      const cacheMap = new Map<number, { document_status: string | null; cancelled: string | null }>();
      const invoicesByPo = new Map<number, SapInvoiceLifecycle[]>();
      if (docEntries.length) {
        const { data: cacheRows } = await sb
          .from("sap_purchase_order_cache")
          .select("doc_entry, document_status, cancelled")
          .eq("company_db", companyDb)
          .in("doc_entry", docEntries)
          .gte("synced_at", cacheCutoffIso);
        for (const c of (cacheRows || []) as Array<{ doc_entry: number; document_status: string | null; cancelled: string | null }>) {
          cacheMap.set(Number(c.doc_entry), { document_status: c.document_status, cancelled: c.cancelled });
        }

        let { data: nfRows, error: nfError } = await sb
          .from("sap_nf_entrada_cache")
          .select("base_po_doc_entry, doc_total, paid_to_date, cancelled")
          .eq("company_db", companyDb)
          .in("base_po_doc_entry", docEntries);
        // Compatibilidade durante rollout: a presença da NF continua atualizando
        // o status mesmo se a coluna de valor pago ainda não estiver no schema.
        if (nfError && nfError.message.includes("paid_to_date")) {
          const fallback = await sb
            .from("sap_nf_entrada_cache")
            .select("base_po_doc_entry, doc_total, cancelled")
            .eq("company_db", companyDb)
            .in("base_po_doc_entry", docEntries);
          nfRows = fallback.data;
          nfError = fallback.error;
        }
        if (nfError) throw new Error(`Cache de NF erro: ${nfError.message}`);
        for (const nf of (nfRows || []) as NfCacheRow[]) {
          const poEntry = Number(nf.base_po_doc_entry);
          if (!Number.isFinite(poEntry)) continue;
          const invoices = invoicesByPo.get(poEntry) || [];
          invoices.push({
            docTotal: nf.doc_total,
            paidToDate: nf.paid_to_date ?? null,
            cancelled: nf.cancelled,
          });
          invoicesByPo.set(poEntry, invoices);
        }
      }

      const pending: ExpenseRow[] = [];
      for (const row of list) {
        const de = Number(row.sap_doc_entry);
        const hit = cacheMap.get(de);
        if (hit) {
          await applyStatus(
            row,
            de,
            hit.document_status,
            hit.cancelled,
            invoicesByPo.get(de) || [],
            "cache",
          );
        }
        else pending.push(row);
      }

      if (pending.length === 0) continue;

      // 2) Restantes → Service Layer (comportamento anterior).
      let cookie = "";
      let baseUrl = "";
      try {
        const creds = await loadCreds(sb, companyDb);
        baseUrl = buildBaseUrl(creds.service_layer_url);
        cookie = await sapLogin(baseUrl, creds.company_db || companyDb, creds.username, creds.password);
      } catch (e) {
        const msg = (e as Error).message;
        for (const row of pending) {
          const info = await recordFailure(row, `SAP login: ${msg}`);
          results.push({ id: row.id, error: msg, attempts: info.attempts, nextRetryAt: info.nextRetryAt });
        }
        continue;
      }

      try {
        for (const row of pending) {
          const docEntry = Number(row.sap_doc_entry);
          try {
            const r = await fetch(
              `${baseUrl}/PurchaseOrders(${docEntry})?$select=DocEntry,DocNum,DocumentStatus,Cancelled`,
              { headers: { Cookie: cookie } },
            );

            const now = new Date().toISOString();

            if (r.status === 404) {
              const changed404 = row.sap_purchase_order_status !== "not_found";
              const patch404: Record<string, unknown> = {
                sap_purchase_order_status: "not_found",
                sap_status_last_check_at: now,
                sap_integration_error: null,
                sap_sync_state: "ok",
                sap_sync_attempts: 0,
                sap_sync_next_retry_at: null,
              };
              if (changed404) patch404.sap_integration_last_attempt_at = now;
              await sb.from("expenses").update(patch404).eq("id", row.id);
              results.push({ id: row.id, docEntry, poStatus: "not_found" });
              continue;
            }
            if (!r.ok) throw new Error(`PO fetch ${r.status}: ${(await r.text()).slice(0, 200)}`);

            const po = await r.json();
            await applyStatus(
              row,
              docEntry,
              po.DocumentStatus ?? null,
              po.Cancelled ?? null,
              invoicesByPo.get(docEntry) || [],
              "sl",
            );
          } catch (e) {
            const msg = (e as Error).message;
            const info = await recordFailure(row, msg);
            results.push({
              id: row.id,
              docEntry,
              error: msg,
              attempts: info.attempts,
              nextRetryAt: info.nextRetryAt,
            });
          }
        }
      } finally {
        await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
      }
    }


    const errors = results.filter((r) => r.error);
    const updated = results.filter((r) => r.expenseStatus);
    if (runId) {
      await sb.from("expense_sap_sync_runs").update({
        status: "ok",
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        processed_count: results.length,
        updated_count: updated.length,
        error_count: errors.length,
        skipped_count: 0,
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
