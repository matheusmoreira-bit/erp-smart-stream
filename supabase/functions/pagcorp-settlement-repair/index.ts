// Edge function: pagcorp-settlement-repair
//
// Cancela no ERP as baixas (VendorPayments) criadas AUTOMATICAMENTE pelo
// watcher do PagCorp cujo valor divergiu do valor da transação / do pedido de
// compra, e devolve o log para a fila de baixa para que o watcher relance com
// o valor correto (fatia do PC dentro da conta a pagar).
//
// Escopo restrito de propósito:
//   • só documentos referenciados em public.pagcorp_integration_log
//     (ou seja, baixas automáticas do PagCorp);
//   • só pagamentos ainda não cancelados no SAP;
//   • só quando a divergência ultrapassa a tolerância.
//
// Por padrão roda em dryRun (apenas lista o que faria).
// Acesso: apenas administradores.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireAdmin, AuthError } from "../_shared/auth.ts";

const cors = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-auth-token",
};

const TOLERANCE = 0.05;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}`);
  await r.json().catch(() => ({}));
  const sc = r.headers.get("set-cookie") || "";
  const s = sc.match(/B1SESSION=([^;]+)/)?.[1];
  const rt = sc.match(/ROUTEID=([^;]+)/)?.[1];
  if (!s) throw new Error("B1SESSION ausente");
  return `B1SESSION=${s}${rt ? `; ROUTEID=${rt}` : ""}`;
}

// deno-lint-ignore no-explicit-any
async function loadCreds(sb: any, companyDb: string) {
  const { data } = await sb
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  const kv: Record<string, string> = {};
  for (const r of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
    kv[r.credential_key] = r.credential_value ?? "";
  }
  if (!kv.service_layer_url || !kv.username || !kv.password) {
    throw new Error(`Credenciais SAP ausentes para ${companyDb}`);
  }
  return kv;
}

interface PaymentLine {
  DocEntry: number;
  SumApplied?: number;
  AppliedFC?: number;
  AppliedSys?: number;
}

interface SapPayment {
  DocEntry: number;
  DocNum: number;
  DocDate: string;
  Cancelled?: string;
  CardCode?: string;
  CardName?: string;
  TransferSum?: number;
  CashSum?: number;
  DocCurrency?: string;
  PaymentInvoices?: PaymentLine[];
}

async function fetchPayment(baseUrl: string, cookie: string, docEntry: number): Promise<SapPayment | null> {
  const r = await fetch(`${baseUrl}/VendorPayments(${docEntry})`, {
    headers: { Cookie: cookie, Prefer: "odata.maxpagesize=0" },
  });
  if (!r.ok) return null;
  return (await r.json()) as SapPayment;
}

async function cancelPayment(baseUrl: string, cookie: string, docEntry: number): Promise<string | null> {
  const r = await fetch(`${baseUrl}/VendorPayments(${docEntry})/Cancel`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
  });
  if (r.ok) return null;
  const text = (await r.text()).slice(0, 300);
  return `Cancelamento recusado pelo ERP (${r.status}): ${text}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Método não permitido" });

  let adminId = "admin";
  try {
    const admin = await requireAdmin(req);
    adminId = (admin as { id?: string })?.id ?? "admin";
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 401;
    return json(status, { error: e instanceof Error ? e.message : "Não autorizado" });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: {
    companyDbs?: string[];
    limit?: number;
    dryRun?: boolean;
    paymentDocEntries?: number[];
  } = {};
  try {
    body = await req.json();
  } catch { /* corpo opcional */ }

  const companyDbs = Array.isArray(body.companyDbs) && body.companyDbs.length
    ? body.companyDbs.filter((c) => typeof c === "string").slice(0, 5)
    : ["SBO_ANAGAMING", "SBO_CACTUS"];
  const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 500);
  const dryRun = body.dryRun !== false;
  const onlyEntries = Array.isArray(body.paymentDocEntries)
    ? new Set(body.paymentDocEntries.map((n) => Number(n)).filter((n) => Number.isFinite(n)))
    : null;

  const actions: Array<Record<string, unknown>> = [];
  const errors: Array<{ companyDb: string; message: string }> = [];

  for (const companyDb of companyDbs) {
    const { data: rows, error } = await sb
      .from("pagcorp_integration_log")
      .select(
        "id, pagcorp_expense_id, company_db, sap_doc_entry, pagcorp_data, settlement_status, settlement_invoice_doc_entry, settlement_payment_doc_entry, settlement_payment_doc_num, settlement_ptax_rate, settlement_completed_at",
      )
      .eq("company_db", companyDb)
      .not("settlement_payment_doc_entry", "is", null)
      .order("settlement_completed_at", { ascending: false })
      .limit(limit);
    if (error) {
      errors.push({ companyDb, message: error.message });
      continue;
    }
    if (!rows?.length) continue;

    let cookie: string;
    let baseUrl: string;
    try {
      const kv = await loadCreds(sb, companyDb);
      baseUrl = buildBaseUrl(kv.service_layer_url);
      cookie = await sapLogin(baseUrl, companyDb, kv.username, kv.password);
    } catch (e) {
      errors.push({ companyDb, message: e instanceof Error ? e.message : "Falha ao conectar no ERP" });
      continue;
    }

    try {
      // Um mesmo VendorPayment pode cobrir várias transações consolidadas.
      const byPayment = new Map<number, typeof rows>();
      for (const r of rows) {
        const de = Number(r.settlement_payment_doc_entry);
        if (onlyEntries && !onlyEntries.has(de)) continue;
        const arr = byPayment.get(de) || [];
        arr.push(r);
        byPayment.set(de, arr);
      }

      for (const [paymentEntry, logRows] of byPayment) {
        const payment = await fetchPayment(baseUrl, cookie, paymentEntry);
        if (!payment) {
          actions.push({ companyDb, paymentDocEntry: paymentEntry, action: "skipped", reason: "payment_not_found" });
          continue;
        }
        if (String(payment.Cancelled || "tNO") === "tYES") {
          actions.push({ companyDb, paymentDocEntry: paymentEntry, action: "skipped", reason: "already_cancelled" });
          continue;
        }

        // Valor esperado = soma das transações PagCorp deste pagamento,
        // convertidas pela PTAX gravada quando não são BRL.
        let expected = 0;
        let ptaxGap = false;
        for (const r of logRows) {
          const raw = (r.pagcorp_data || {}) as Record<string, unknown>;
          const tx = (raw.transaction || raw) as Record<string, unknown>;
          const amount = num(tx.amount ?? tx.value ?? tx.expenseValue);
          const currency = String(tx.currency || raw.currency || "BRL").toUpperCase();
          const ptax = num(r.settlement_ptax_rate);
          if (currency === "BRL") expected += amount;
          else if (ptax > 0) expected += amount * ptax;
          else ptaxGap = true;
        }
        const expectedRounded = Number(expected.toFixed(2));
        const applied = (payment.PaymentInvoices || []).reduce(
          (a, l) => a + (num(l.SumApplied) || num(l.AppliedFC) || num(l.AppliedSys)),
          0,
        );
        const transferSum = num(payment.TransferSum) || num(payment.CashSum);
        const diff = Number((applied - expectedRounded).toFixed(2));

        if (ptaxGap || expectedRounded <= 0) {
          actions.push({
            companyDb,
            paymentDocEntry: paymentEntry,
            paymentDocNum: payment.DocNum,
            action: "skipped",
            reason: ptaxGap ? "missing_ptax" : "no_expected_value",
          });
          continue;
        }
        if (Math.abs(diff) <= TOLERANCE) {
          actions.push({
            companyDb,
            paymentDocEntry: paymentEntry,
            paymentDocNum: payment.DocNum,
            action: "ok",
            applied: Number(applied.toFixed(2)),
            expected: expectedRounded,
          });
          continue;
        }

        const base = {
          companyDb,
          paymentDocEntry: paymentEntry,
          paymentDocNum: payment.DocNum,
          paymentDate: payment.DocDate,
          cardName: payment.CardName ?? payment.CardCode ?? null,
          currency: payment.DocCurrency ?? null,
          transferSum: Number(transferSum.toFixed(2)),
          applied: Number(applied.toFixed(2)),
          expected: expectedRounded,
          difference: diff,
          logIds: logRows.map((r) => r.id),
        };

        if (dryRun) {
          actions.push({ ...base, action: "would_cancel_and_requeue" });
          continue;
        }

        const cancelErr = await cancelPayment(baseUrl, cookie, paymentEntry);
        if (cancelErr) {
          actions.push({ ...base, action: "cancel_failed", error: cancelErr });
          continue;
        }

        const note = `Baixa ${payment.DocNum} cancelada por divergência (aplicado ${applied.toFixed(2)} × esperado ${expectedRounded.toFixed(2)}). Refila para novo lançamento.`;
        const { error: updErr } = await sb
          .from("pagcorp_integration_log")
          .update({
            settlement_status: "pending",
            settlement_payment_doc_entry: null,
            settlement_payment_doc_num: null,
            settlement_invoice_doc_entry: null,
            settlement_invoice_doc_num: null,
            settlement_completed_at: null,
            settlement_locked_at: null,
            settlement_retry_after: null,
            settlement_error: note,
          })
          .in("id", logRows.map((r) => r.id));

        await sb.rpc("insert_audit_log", {
          p_action: "pagcorp_settlement_cancelled",
          p_entity_type: "vendor_payment",
          p_entity_id: String(paymentEntry),
          p_actor_email: adminId,
          p_company_db: companyDb,
          p_details: base as unknown as Record<string, unknown>,
        }).then(() => {}, () => {});

        actions.push({ ...base, action: "cancelled_and_requeued", updateError: updErr?.message ?? null });
      }
    } finally {
      await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
    }
  }

  return json(200, {
    ok: true,
    dryRun,
    generatedAt: new Date().toISOString(),
    companyDbs,
    total: actions.length,
    toFix: actions.filter((a) => a.action === "would_cancel_and_requeue").length,
    fixed: actions.filter((a) => a.action === "cancelled_and_requeued").length,
    failed: actions.filter((a) => a.action === "cancel_failed").length,
    actions,
    errors,
  });
});
