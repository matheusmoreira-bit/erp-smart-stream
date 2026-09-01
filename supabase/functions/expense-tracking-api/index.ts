// Public read-only API for tracking purchase expenses.
// Every response is scoped to the projects assigned to the API credential.
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { validateApiKey } from "../_shared/api-keys.ts";
import {
  shapeScopedExpense,
  type ExpenseTrackingApprovalSegment,
  type ExpenseTrackingExpense,
  type ExpenseTrackingLine,
} from "../_shared/expense-tracking.ts";
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { openapiSpec } from "./openapi.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-api-key, authorization, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const QuerySchema = z.object({
  expenseId: z.string().uuid().optional(),
  companyDb: z.string().trim().min(1).max(64).optional(),
  status: z.string().trim().min(1).max(64).optional(),
  updatedSince: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});

type SupplierRow = {
  company_db: string;
  card_code: string | null;
  federal_tax_id: string | null;
  u_fgr_taxid0: string | null;
};

function supplierKey(companyDb: string, supplierCode: string): string {
  return `${companyDb}\u0000${supplierCode}`.toLocaleUpperCase("pt-BR");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  if (url.searchParams.get("spec") === "openapi") return json(openapiSpec);
  if (req.method !== "GET") return json({ error: "Use GET" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const keyCheck = await validateApiKey(admin, req, "expense-tracking-api");
  if (!keyCheck.valid) return json({ error: keyCheck.reason || "Unauthorized" }, 401);
  if (!keyCheck.projectCodes?.length) {
    return json({ error: "Credencial sem projetos autorizados" }, 403);
  }

  const rateLimit = await enforceRateLimit(admin, {
    scope: "expense-tracking-api",
    identifier: `${keyCheck.keyId || keyCheck.keyName || "unknown"}:${clientIpFrom(req)}`,
    max: 120,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit, cors);

  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
  const params = parsed.data;

  const targetCount = params.expenseId ? 1 : params.offset + params.limit + 1;
  const authorizedItems: ReturnType<typeof shapeScopedExpense>[] = [];
  const batchSize = 200;
  let scanOffset = 0;
  let exhausted = false;

  while (!exhausted && authorizedItems.length < targetCount) {
    let expenseQuery = admin
      .from("expenses")
      .select(
        "id,company_db,supplier_code,supplier_name,sap_doc_entry,sap_doc_num,doc_date,created_at,due_date,total_amount,currency,cost_center,project,remarks,current_approver,current_level_order,status",
      )
      .eq("doc_type", "purchase")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false });

    if (params.expenseId) expenseQuery = expenseQuery.eq("id", params.expenseId);
    if (params.companyDb) expenseQuery = expenseQuery.eq("company_db", params.companyDb);
    if (params.status) expenseQuery = expenseQuery.eq("status", params.status);
    if (params.updatedSince) expenseQuery = expenseQuery.gte("updated_at", params.updatedSince);

    const { data: expenseData, error: expenseError } = await expenseQuery.range(
      scanOffset,
      scanOffset + batchSize - 1,
    );
    if (expenseError) {
      console.error("[expense-tracking-api] expense query failed", expenseError.message);
      return json({ error: "Falha ao consultar despesas" }, 500);
    }

    const expenses = (expenseData ?? []) as ExpenseTrackingExpense[];
    exhausted = expenses.length < batchSize || Boolean(params.expenseId);
    scanOffset += expenses.length;
    if (expenses.length === 0) break;

    const expenseIds = expenses.map((expense) => expense.id);
    const { data: lineData, error: lineError } = await admin
      .from("expense_items")
      .select("expense_id,line_total,description,cost_center,project")
      .in("expense_id", expenseIds);
    if (lineError) {
      console.error("[expense-tracking-api] item query failed", lineError.message);
      return json({ error: "Falha ao consultar itens das despesas" }, 500);
    }

    const linesByExpense = new Map<string, ExpenseTrackingLine[]>();
    for (const line of (lineData ?? []) as ExpenseTrackingLine[]) {
      const lines = linesByExpense.get(line.expense_id) ?? [];
      lines.push(line);
      linesByExpense.set(line.expense_id, lines);
    }

    const { data: segmentData, error: segmentError } = await admin
      .from("expense_approval_segments")
      .select("expense_id,cost_center,project,current_approver,current_approver_email,current_level,status")
      .in("expense_id", expenseIds);
    if (segmentError) {
      console.error("[expense-tracking-api] approval segment query failed", segmentError.message);
      return json({ error: "Falha ao consultar aprovações das despesas" }, 500);
    }

    const segmentsByExpense = new Map<string, ExpenseTrackingApprovalSegment[]>();
    for (const segment of (segmentData ?? []) as ExpenseTrackingApprovalSegment[]) {
      const segments = segmentsByExpense.get(segment.expense_id) ?? [];
      segments.push(segment);
      segmentsByExpense.set(segment.expense_id, segments);
    }

    const supplierGroups = new Map<string, Set<string>>();
    for (const expense of expenses) {
      if (!expense.supplier_code) continue;
      const codes = supplierGroups.get(expense.company_db) ?? new Set<string>();
      codes.add(expense.supplier_code);
      supplierGroups.set(expense.company_db, codes);
    }

    const supplierResults = await Promise.all(
      [...supplierGroups.entries()].map(async ([companyDb, codes]) => {
        const { data, error } = await admin
          .from("suppliers")
          .select("company_db,card_code,federal_tax_id,u_fgr_taxid0")
          .eq("company_db", companyDb)
          .in("card_code", [...codes]);
        if (error) console.error("[expense-tracking-api] supplier query failed", error.message);
        return (data ?? []) as SupplierRow[];
      }),
    );
    const taxIdBySupplier = new Map<string, string | null>();
    for (const supplier of supplierResults.flat()) {
      if (!supplier.card_code) continue;
      taxIdBySupplier.set(
        supplierKey(supplier.company_db, supplier.card_code),
        supplier.federal_tax_id || supplier.u_fgr_taxid0 || null,
      );
    }

    for (const expense of expenses) {
      const taxId = expense.supplier_code
        ? taxIdBySupplier.get(supplierKey(expense.company_db, expense.supplier_code)) ?? null
        : null;
      const item = shapeScopedExpense(
        expense,
        linesByExpense.get(expense.id) ?? [],
        keyCheck.projectCodes,
        taxId,
        segmentsByExpense.get(expense.id) ?? [],
      );
      if (item) authorizedItems.push(item);
    }
  }

  const compactItems = authorizedItems.filter((item): item is NonNullable<typeof item> => item !== null);
  if (params.expenseId) {
    return compactItems.length ? json(compactItems[0]) : json({ error: "Despesa não encontrada" }, 404);
  }

  const items = compactItems.slice(params.offset, params.offset + params.limit);
  return json({
    count: items.length,
    limit: params.limit,
    offset: params.offset,
    hasMore: compactItems.length > params.offset + params.limit,
    items,
  });
});
