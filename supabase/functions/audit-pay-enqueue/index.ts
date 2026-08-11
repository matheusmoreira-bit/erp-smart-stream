// audit-pay-enqueue — varre faturas de compra no SAP (GET) e popula a fila de auditoria.
// Pode ser chamada pelo cron externo (n8n) com o header x-audit-key, ou pela UI com JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { admin, getSapCreds, sapLogin, sapList } from "../_shared/audit-pay/sap.ts";

const SERVICE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authorize(req: Request, companyDb: string) {
  const cronKey = Deno.env.get("AUDIT_ENQUEUE_KEY");
  const provided = req.headers.get("x-audit-key");
  if (cronKey && provided && provided === cronKey) return "cron";

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
  const sb = createClient(SERVICE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data, error } = await sb.auth.getClaims(auth.replace("Bearer ", ""));
  if (error || !data?.claims) throw new Error("UNAUTHORIZED");
  const { data: allowed } = await sb.rpc("can_access_audit_console", { _company_db: companyDb });
  if (!allowed) throw new Error("FORBIDDEN");
  return String(data.claims.email ?? "");
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const companyDb = String(body.company_db ?? "");
    if (!companyDb) return json({ error: "company_db é obrigatório" }, 400);
    await authorize(req, companyDb);

    const days = Math.min(Number(body.days ?? 30), 365);
    const documentType = String(body.document_type ?? "ap_invoice");
    const baselineSource = String(body.baseline_source ?? "erp_flow_approval");
    const since = String(body.since ?? isoDaysAgo(days));

    const { data: cfg } = await admin()
      .from("audit_pay_config")
      .select("fornecedor_risco, enabled")
      .eq("company_db", companyDb)
      .maybeSingle();
    if (cfg && cfg.enabled === false) return json({ ok: true, enqueued: 0, skipped: "auditoria desabilitada" });
    const riskList = new Set(
      (Array.isArray(cfg?.fornecedor_risco) ? cfg!.fornecedor_risco : [])
        .map((f: any) => String(f?.card_code ?? f).toUpperCase()),
    );

    const creds = await getSapCreds(companyDb);
    const cookie = await sapLogin(creds);
    const resource = documentType === "purchase_order" ? "PurchaseOrders" : "PurchaseInvoices";
    const docs = await sapList<any>(
      creds.baseUrl,
      cookie,
      `${resource}?$select=DocEntry,DocNum,DocDate,CardCode,DocTotal&$filter=${encodeURIComponent(
        `DocDate ge '${since}'`,
      )}&$orderby=DocEntry desc&$top=${Math.min(Number(body.max ?? 200), 500)}`,
    );

    const rows = docs.map((d) => {
      const total = Number(d.DocTotal ?? 0);
      const risky = riskList.has(String(d.CardCode ?? "").toUpperCase());
      const priority = risky ? 100 : total >= 100000 ? 80 : total >= 20000 ? 50 : 20;
      return {
        company_db: companyDb,
        document_ref: `${resource}:${d.DocEntry}`,
        document_type: documentType,
        baseline_source: baselineSource,
        status: "pending",
        priority,
        enqueued_at: new Date().toISOString(),
      };
    });

    if (!rows.length) return json({ ok: true, enqueued: 0 });

    const { error } = await admin()
      .from("audit_pay_queue")
      .upsert(rows, { onConflict: "company_db,document_ref,document_type", ignoreDuplicates: true });
    if (error) throw new Error(error.message);

    return json({ ok: true, enqueued: rows.length, since });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    const status = msg === "UNAUTHORIZED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return json({ error: msg }, status);
  }
});
