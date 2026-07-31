// Edge function: pagcorp-settlement-audit
//
// SOMENTE LEITURA. Não cria, não altera e não cancela nada no SAP.
//
// Objetivo: para cada baixa (VendorPayment) que o watcher do PagCorp criou,
// comparar o que foi efetivamente aplicado no SAP com o valor esperado da
// transação PagCorp e com o total da NF de compra, para expor:
//   - divergência de valor (baixa maior/menor que a transação)
//   - baixa em lote (TransferSum > soma aplicada às NFs deste log)
//   - dupla baixa da mesma NF por pagamentos diferentes
//   - baixa cancelada no SAP mas ainda marcada como "settled" no ERP Flow
//
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

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
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

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

interface PaymentLine {
  DocEntry: number;
  InvoiceType?: string;
  SumApplied?: number;
  AppliedFC?: number;
  AppliedSys?: number;
}

interface SapPayment {
  DocEntry: number;
  DocNum: number;
  DocDate: string;
  Cancelled?: string;
  DocumentStatus?: string;
  CardCode?: string;
  CardName?: string;
  TransferSum?: number;
  CashSum?: number;
  DocCurrency?: string;
  DocRate?: number;
  PaymentInvoices?: PaymentLine[];
}

async function fetchPayment(baseUrl: string, cookie: string, docEntry: number): Promise<SapPayment | null> {
  const r = await fetch(`${baseUrl}/VendorPayments(${docEntry})`, {
    headers: { Cookie: cookie, Prefer: "odata.maxpagesize=0" },
  });
  if (!r.ok) return null;
  return (await r.json()) as SapPayment;
}

async function fetchInvoiceTotal(
  baseUrl: string,
  cookie: string,
  docEntry: number,
): Promise<{ docTotal: number; paidSum: number; docNum: number | null; cancelled: boolean } | null> {
  const r = await fetch(
    `${baseUrl}/PurchaseInvoices(${docEntry})?$select=DocEntry,DocNum,DocTotal,PaidToDate,Cancelled,DocumentStatus`,
    { headers: { Cookie: cookie } },
  );
  if (!r.ok) return null;
  const j = await r.json();
  return {
    docTotal: num(j?.DocTotal),
    paidSum: num(j?.PaidToDate),
    docNum: j?.DocNum ?? null,
    cancelled: String(j?.Cancelled || "tNO") === "tYES",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Método não permitido" });

  try {
    await requireAdmin(req);
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 401;
    return json(status, { error: e instanceof Error ? e.message : "Não autorizado" });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { companyDbs?: string[]; limit?: number } = {};
  try {
    body = await req.json();
  } catch { /* corpo opcional */ }

  const companyDbs = Array.isArray(body.companyDbs) && body.companyDbs.length
    ? body.companyDbs.filter((c) => typeof c === "string").slice(0, 5)
    : ["SBO_ANAGAMING", "SBO_CACTUS"];
  const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 500);

  const findings: Array<Record<string, unknown>> = [];
  const errors: Array<{ companyDb: string; message: string }> = [];

  for (const companyDb of companyDbs) {
    const { data: rows, error } = await sb
      .from("pagcorp_integration_log")
      .select(
        "id, pagcorp_expense_id, company_db, pagcorp_data, settlement_status, settlement_invoice_doc_entry, settlement_invoice_doc_num, settlement_payment_doc_entry, settlement_payment_doc_num, settlement_ptax_rate, settlement_completed_at",
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

    // Agrupa por pagamento: um mesmo VendorPayment pode cobrir várias
    // transações consolidadas na mesma NF (cenário legítimo).
    const byPayment = new Map<number, typeof rows>();
    for (const r of rows) {
      const de = Number(r.settlement_payment_doc_entry);
      const arr = byPayment.get(de) || [];
      arr.push(r);
      byPayment.set(de, arr);
    }

    const invoiceCache = new Map<number, Awaited<ReturnType<typeof fetchInvoiceTotal>>>();

    for (const [paymentEntry, logRows] of byPayment) {
      const payment = await fetchPayment(baseUrl, cookie, paymentEntry);
      const invoiceEntry = Number(logRows[0].settlement_invoice_doc_entry) || null;
      let invoice = invoiceEntry != null ? invoiceCache.get(invoiceEntry) : null;
      if (invoiceEntry != null && invoice === undefined) {
        invoice = await fetchInvoiceTotal(baseUrl, cookie, invoiceEntry);
        invoiceCache.set(invoiceEntry, invoice);
      }

      // Valor esperado: soma das transações PagCorp ligadas a este pagamento,
      // convertidas pela PTAX gravada quando a moeda não é BRL.
      let expected = 0;
      const txs: Array<Record<string, unknown>> = [];
      for (const r of logRows) {
        const raw = (r.pagcorp_data || {}) as Record<string, unknown>;
        const tx = (raw.transaction || raw) as Record<string, unknown>;
        const amount = num(tx.amount ?? tx.value ?? tx.expenseValue);
        const currency = String(tx.currency || raw.currency || "BRL").toUpperCase();
        const ptax = num(r.settlement_ptax_rate);
        const local = currency === "BRL" ? amount : (ptax > 0 ? amount * ptax : NaN);
        if (Number.isFinite(local)) expected += local;
        txs.push({
          logId: r.id,
          pagcorpExpenseId: r.pagcorp_expense_id,
          amount,
          currency,
          ptax: ptax || null,
          expectedLocal: Number.isFinite(local) ? Number(local.toFixed(2)) : null,
        });
      }

      const transferSum = num(payment?.TransferSum) || num(payment?.CashSum);
      const lines = payment?.PaymentInvoices || [];
      const appliedToInvoice = lines
        .filter((l) => invoiceEntry == null || Number(l.DocEntry) === invoiceEntry)
        .reduce((a, l) => a + (num(l.SumApplied) || num(l.AppliedFC) || num(l.AppliedSys)), 0);
      const appliedTotal = lines.reduce(
        (a, l) => a + (num(l.SumApplied) || num(l.AppliedFC) || num(l.AppliedSys)),
        0,
      );

      const cancelledInSap =
        String(payment?.Cancelled || "tNO") === "tYES" || payment?.DocumentStatus === "bost_Close" && !payment;
      const expectedRounded = Number(expected.toFixed(2));
      const diff = Number((appliedToInvoice - expectedRounded).toFixed(2));
      const hasPtaxGap = txs.some((t) => t.currency !== "BRL" && !t.ptax);

      // Diferenças pequenas em documentos em moeda estrangeira são variação
      // cambial (PTAX do dia da baixa × PTAX gravada) e vão para conta de
      // juros/variação no ERP — não são erro de lançamento.
      const hasForeignCurrency = txs.some((t) => t.currency !== "BRL");
      const fxLimit = Math.min(Math.max(expectedRounded * FX_REL_TOLERANCE, 0.05), FX_ABS_CAP);
      const isFxVariation = hasForeignCurrency && Math.abs(diff) > 0.05 && Math.abs(diff) <= fxLimit;
      const diffPct = expectedRounded > 0 ? Number(((diff / expectedRounded) * 100).toFixed(2)) : null;

      const issues: string[] = [];
      if (!payment) issues.push("payment_not_found");
      if (payment && String(payment.Cancelled || "tNO") === "tYES") issues.push("cancelled_in_sap");
      if (payment && expectedRounded > 0 && Math.abs(diff) > 0.05) {
        if (isFxVariation) issues.push("fx_variation");
        else issues.push(diff > 0 ? "applied_greater_than_expected" : "applied_less_than_expected");
      }
      if (payment && Math.abs(transferSum - appliedTotal) > 0.05) issues.push("batch_payment");
      if (hasPtaxGap) issues.push("missing_ptax");
      if (invoice && invoice.cancelled) issues.push("invoice_cancelled");
      if (invoice && invoice.docTotal > 0 && appliedToInvoice - invoice.docTotal > 0.05) {
        issues.push("applied_greater_than_invoice");
      }
      if (invoice && invoice.docTotal > 0 && invoice.paidSum - invoice.docTotal > 0.05) {
        issues.push("invoice_overpaid");
      }

      findings.push({
        companyDb,
        paymentDocEntry: paymentEntry,
        paymentDocNum: payment?.DocNum ?? logRows[0].settlement_payment_doc_num ?? null,
        paymentDate: payment?.DocDate ?? null,
        cardName: payment?.CardName ?? payment?.CardCode ?? null,
        currency: payment?.DocCurrency ?? null,
        transferSum: Number(transferSum.toFixed(2)),
        appliedTotal: Number(appliedTotal.toFixed(2)),
        appliedToInvoice: Number(appliedToInvoice.toFixed(2)),
        expectedFromPagcorp: expectedRounded,
        difference: diff,
        differencePct: diffPct,
        fxVariation: isFxVariation,

        invoiceDocEntry: invoiceEntry,
        invoiceDocNum: invoice?.docNum ?? logRows[0].settlement_invoice_doc_num ?? null,
        invoiceTotal: invoice ? Number(invoice.docTotal.toFixed(2)) : null,
        invoicePaid: invoice ? Number(invoice.paidSum.toFixed(2)) : null,
        transactions: txs,
        settledAt: logRows[0].settlement_completed_at,
        issues,
        cancelledInSap,
      });
    }

    await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
  }

  const isReal = (f: Record<string, unknown>) =>
    (f.issues as string[]).some((i) => i !== "fx_variation");
  findings.sort((a, b) => {
    const ra = isReal(a) ? 1 : 0;
    const rb = isReal(b) ? 1 : 0;
    if (ra !== rb) return rb - ra;
    return Math.abs(Number(b.difference)) - Math.abs(Number(a.difference));
  });

  return json(200, {
    ok: true,
    generatedAt: new Date().toISOString(),
    companyDbs,
    fxTolerancePct: FX_REL_TOLERANCE * 100,
    total: findings.length,
    withIssues: findings.filter((f) => (f.issues as string[]).length > 0).length,
    fxOnly: findings.filter((f) => f.fxVariation === true && !isReal(f)).length,
    findings,
    errors,
  });
});
