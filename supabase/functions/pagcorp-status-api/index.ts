// Public read-only API: status of credit-card (PagCorp) transactions vs ERP posting.
// Auth: header `x-api-key` must match the PAGCORP_STATUS_API_KEY secret.
// Exposes the minimum necessary: transaction id, status, ERP stage and doc numbers.
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { openapiSpec } from "./openapi.ts";
import { validateApiKey } from "../_shared/api-keys.ts";



const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-api-key, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const QuerySchema = z.object({
  transactionId: z.coerce.number().int().positive().optional(),
  transactionIds: z.string().max(2000).optional(),
  companyDb: z.string().trim().max(64).optional(),
  updatedSince: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

type Row = {
  pagcorp_expense_id: number | null;
  status: string | null;
  settlement_status: string | null;
  sap_doc_num: number | null;
  settlement_invoice_doc_num: number | null;
  settlement_payment_doc_num: number | null;
  company_db: string | null;
  updated_at: string | null;
};

function erpStage(r: Row): "not_posted" | "error" | "posted" | "invoiced" | "settled" {
  if (r.settlement_status === "completed" || r.settlement_payment_doc_num) return "settled";
  if (r.settlement_invoice_doc_num) return "invoiced";
  if (r.sap_doc_num) return "posted";
  if ((r.status ?? "").toLowerCase().includes("error") || r.settlement_status === "error") return "error";
  return "not_posted";
}

function shape(r: Row) {
  return {
    transactionId: r.pagcorp_expense_id,
    status: r.status ?? "unknown",
    erp: {
      stage: erpStage(r),
      purchaseOrderDocNum: r.sap_doc_num ?? null,
      invoiceDocNum: r.settlement_invoice_doc_num ?? null,
      paymentDocNum: r.settlement_payment_doc_num ?? null,
      settlementStatus: r.settlement_status ?? null,
    },
    updatedAt: r.updated_at,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Documentação OpenAPI: pública (não expõe dados, apenas o contrato).
  if (new URL(req.url).searchParams.get("spec") === "openapi") return json(openapiSpec);



  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const keyCheck = await validateApiKey(authClient, req, "pagcorp-status-api", "PAGCORP_STATUS_API_KEY");
  if (!keyCheck.valid) return json({ error: keyCheck.reason || "Unauthorized" }, 401);


  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
  const q = parsed.data;

  const ids = q.transactionIds
    ? q.transactionIds.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200)
    : [];

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let query = supabase
    .from("pagcorp_integration_log")
    .select(
      "pagcorp_expense_id,status,settlement_status,sap_doc_num,settlement_invoice_doc_num,settlement_payment_doc_num,company_db,updated_at",
    )
    .not("pagcorp_expense_id", "is", null)
    .order("updated_at", { ascending: false });

  if (q.transactionId) query = query.eq("pagcorp_expense_id", q.transactionId);
  else if (ids.length) query = query.in("pagcorp_expense_id", ids);
  if (q.companyDb) query = query.eq("company_db", q.companyDb);
  if (q.updatedSince) query = query.gte("updated_at", q.updatedSince);

  const { data, error } = await query.range(q.offset, q.offset + q.limit - 1);
  if (error) {
    console.error("pagcorp-status-api query failed", error.message);
    return json({ error: "Query failed" }, 500);
  }

  const rows = (data ?? []) as Row[];
  // Keep only the most recent record per transaction.
  const byId = new Map<number, Row>();
  for (const r of rows) {
    const id = Number(r.pagcorp_expense_id);
    if (!byId.has(id)) byId.set(id, r);
  }

  const items = [...byId.values()].map(shape);
  if (q.transactionId) {
    return items.length ? json(items[0]) : json({ error: "Not found" }, 404);
  }
  return json({ count: items.length, items });
});
