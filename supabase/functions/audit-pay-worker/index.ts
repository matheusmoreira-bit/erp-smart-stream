// audit-pay-worker — processa a fila de auditoria de pagamentos (ou um documento avulso).
// Somente leitura no SAP (GET). Idempotente por (company_db, document_ref, document_type).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { admin, getSapCreds, sapLogin, sapGet } from "../_shared/audit-pay/sap.ts";
import {
  buildFlowBaselineSnapshot,
  buildPoBaselineSnapshot,
  buildSettlementSnapshot,
  basePoEntryFromInvoice,
  bpBank,
  emptySnapshot,
} from "../_shared/audit-pay/snapshots.ts";
import { compareSnapshots, maxSeverity, riskScore, DEFAULT_CONFIG, type AuditConfig } from "../_shared/audit-pay/engine.ts";

const SERVICE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authorize(req: Request, companyDb: string) {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
  const sb = createClient(SERVICE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const token = auth.replace("Bearer ", "");
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims) throw new Error("UNAUTHORIZED");
  const { data: allowed } = await sb.rpc("can_access_audit_console", { _company_db: companyDb });
  if (!allowed) throw new Error("FORBIDDEN");
  return String(data.claims.email ?? data.claims.sub ?? "");
}

async function loadConfig(companyDb: string): Promise<AuditConfig> {
  const { data } = await admin().from("audit_pay_config").select("*").eq("company_db", companyDb).maybeSingle();
  if (!data) return DEFAULT_CONFIG;
  return {
    tolerance_pct_baixa: Number(data.tolerance_pct_baixa ?? DEFAULT_CONFIG.tolerance_pct_baixa),
    tolerance_pct_media: Number(data.tolerance_pct_media ?? DEFAULT_CONFIG.tolerance_pct_media),
    approval_thresholds: data.approval_thresholds ?? [],
    fornecedor_risco: data.fornecedor_risco ?? [],
    bank_change_window_days: Number(data.bank_change_window_days ?? DEFAULT_CONFIG.bank_change_window_days),
  };
}

function parseRef(documentRef: string): number | null {
  const m = String(documentRef).match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

async function auditDocument(opts: {
  companyDb: string;
  documentRef: string;
  documentType: string;
  baselineSource: string;
  queueId?: string | null;
}) {
  const { companyDb, documentRef, documentType, baselineSource, queueId } = opts;
  const cfg = await loadConfig(companyDb);
  const creds = await getSapCreds(companyDb);
  const cookie = await sapLogin(creds);
  const docEntry = parseRef(documentRef);
  if (!docEntry) throw new Error(`document_ref inválido: ${documentRef}`);

  const settlement = await buildSettlementSnapshot(creds.baseUrl, cookie, documentType, docEntry);

  const rawInv = await sapGet<any>(
    creds.baseUrl,
    cookie,
    `${documentType === "purchase_order" ? "PurchaseOrders" : "PurchaseInvoices"}(${docEntry})?$select=DocEntry,DocumentLines`,
  ).catch(() => null);
  const poEntry = rawInv ? basePoEntryFromInvoice(rawInv) : null;

  let baseline;
  if (baselineSource === "sap_purchase_order" && poEntry) {
    baseline = await buildPoBaselineSnapshot(creds.baseUrl, cookie, poEntry);
  } else {
    baseline = await buildFlowBaselineSnapshot(
      companyDb,
      { poDocEntry: poEntry, invoiceDocEntry: docEntry, cardCode: settlement.fornecedor_code },
      (cc) => bpBank(creds.baseUrl, cookie, cc),
    );
    if (!baseline.document_ref && poEntry) {
      baseline = await buildPoBaselineSnapshot(creds.baseUrl, cookie, poEntry);
    }
  }
  if (!baseline) baseline = emptySnapshot(baselineSource);

  const { findings, desvioAbs, desvioPct } = compareSnapshots(baseline, settlement, cfg);
  const overall = maxSeverity(findings.map((f) => f.severity));

  const sb = admin();
  const { data: result, error } = await sb
    .from("audit_pay_result")
    .upsert(
      {
        company_db: companyDb,
        queue_id: queueId ?? null,
        document_ref: documentRef,
        document_type: documentType,
        baseline_source: baseline.source === "erp_flow_approval" ? "erp_flow_approval" : "sap_purchase_order",
        fornecedor_code: settlement.fornecedor_code ?? baseline.fornecedor_code,
        fornecedor_name: settlement.fornecedor_name ?? baseline.fornecedor_name,
        solicitante: baseline.solicitante,
        projeto: baseline.project ?? settlement.project,
        centro_custo: baseline.cost_center ?? settlement.cost_center,
        baseline_snapshot: baseline,
        settlement_snapshot: settlement,
        valor_baseline: baseline.valor ?? 0,
        valor_pago: settlement.valor ?? 0,
        desvio_valor_abs: desvioAbs,
        desvio_valor_pct: desvioPct,
        overall_severity: overall,
        risk_score: riskScore(findings, desvioPct),
        has_findings: findings.length > 0,
        audited_at: new Date().toISOString(),
      },
      { onConflict: "company_db,document_ref,document_type" },
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Reprocessamento não duplica: apaga os findings anteriores do documento.
  await sb.from("audit_pay_finding").delete().eq("audit_result_id", result.id);
  if (findings.length) {
    const { error: fErr } = await sb.from("audit_pay_finding").insert(
      findings.map((f) => ({
        company_db: companyDb,
        audit_result_id: result.id,
        finding_type: f.finding_type,
        severity: f.severity,
        field_name: f.field_name,
        value_before: f.value_before ?? null,
        value_after: f.value_after ?? null,
        delta: f.delta,
        explanation: f.explanation,
      })),
    );
    if (fErr) throw new Error(fErr.message);
  }

  return { audit_result_id: result.id, overall_severity: overall, findings: findings.length, desvioAbs, desvioPct };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "run");

    if (action === "run") {
      const companyDb = String(body.company_db ?? "");
      const documentRef = String(body.document_ref ?? "");
      const documentType = String(body.document_type ?? "ap_invoice");
      const baselineSource = String(body.baseline_source ?? "erp_flow_approval");
      if (!companyDb || !documentRef) return json({ error: "company_db e document_ref são obrigatórios" }, 400);
      await authorize(req, companyDb);
      const out = await auditDocument({ companyDb, documentRef, documentType, baselineSource });
      return json({ ok: true, ...out });
    }

    if (action === "process_queue") {
      const companyDb = String(body.company_db ?? "");
      if (!companyDb) return json({ error: "company_db é obrigatório" }, 400);
      await authorize(req, companyDb);
      const limit = Math.min(Number(body.limit ?? 10), 50);
      const sb = admin();
      const { data: items } = await sb
        .from("audit_pay_queue")
        .select("*")
        .eq("company_db", companyDb)
        .eq("status", "pending")
        .order("priority", { ascending: false })
        .order("enqueued_at", { ascending: true })
        .limit(limit);

      const results: unknown[] = [];
      for (const item of items ?? []) {
        await sb
          .from("audit_pay_queue")
          .update({ status: "processing", started_at: new Date().toISOString(), attempts: (item.attempts ?? 0) + 1 })
          .eq("id", item.id);
        try {
          const out = await auditDocument({
            companyDb,
            documentRef: item.document_ref,
            documentType: item.document_type,
            baselineSource: item.baseline_source,
            queueId: item.id,
          });
          await sb
            .from("audit_pay_queue")
            .update({ status: "done", finished_at: new Date().toISOString(), error_message: null })
            .eq("id", item.id);
          results.push({ id: item.id, ...out });
        } catch (e) {
          await sb
            .from("audit_pay_queue")
            .update({
              status: "error",
              finished_at: new Date().toISOString(),
              error_message: String((e as Error).message).slice(0, 500),
            })
            .eq("id", item.id);
          results.push({ id: item.id, error: String((e as Error).message) });
        }
      }
      return json({ ok: true, processed: results.length, results });
    }

    return json({ error: "action inválida" }, 400);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    const status = msg === "UNAUTHORIZED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return json({ error: msg }, status);
  }
});
