// Audit Console - Engine
// Spins up a new audit_console_runs row, fetches SAP data, applies rules,
// generates divergences and an AI executive summary. Background-processed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sapFetch } from "../_shared/sap-fetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Severity = "low" | "medium" | "high" | "critical";
type DivergenceType =
  | "missing_order" | "missing_grpo" | "missing_ap" | "value_mismatch"
  | "vendor_mismatch" | "payment_terms_mismatch" | "document_mismatch"
  | "date_anomaly" | "duplicate_suspected" | "fraud_flag" | "missing_request"
  | "missing_quotation" | "missing_approval" | "missing_invoice" | "missing_payment";

interface Rule {
  id: string;
  divergence_type: DivergenceType;
  default_severity: Severity;
  tolerance: number | null;
  config: Record<string, unknown>;
  is_active: boolean;
  company_db: string | null;
}

interface SapDoc {
  DocEntry: number;
  DocNum: number;
  DocDate: string;
  DocDueDate?: string;
  CardCode: string;
  CardName?: string;
  DocTotal: number;
  PaymentGroupCode?: number;
  DocumentLines?: Array<{ BaseEntry?: number; BaseType?: number; LineTotal?: number; ItemCode?: string }>;
}

const SERVICE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

function admin() {
  return createClient(SERVICE_URL, SERVICE_KEY);
}

async function requireAdmin(req: Request): Promise<{ userId: string; email: string }> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
  const sb = createClient(SERVICE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user }, error } = await sb.auth.getUser();
  if (error || !user) throw new Error("UNAUTHORIZED");
  const { data: isAdmin } = await sb.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isAdmin) throw new Error("FORBIDDEN");
  return { userId: user.id, email: user.email ?? "" };
}

async function log(runId: string, level: string, message: string, ctx: Record<string, unknown> = {}) {
  await admin().from("audit_console_logs").insert({
    audit_run_id: runId,
    company_db: ctx.company_db ?? "",
    level,
    message,
    context: ctx,
  });
}

async function updateRun(runId: string, patch: Record<string, unknown>) {
  await admin().from("audit_console_runs").update(patch).eq("id", runId);
}

async function getSapCreds(companyDB: string) {
  const sb = admin();
  const { data } = await sb
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("company_db", companyDB)
    .eq("system_name", "sap");
  const map = new Map((data ?? []).map((r) => [r.credential_key, r.credential_value as string]));
  const url = map.get("service_layer_url");
  const username = map.get("username");
  const password = map.get("password");
  const sapCompanyDb = map.get("company_db") || companyDB;
  if (!url || !username || !password) {
    throw new Error(`Credenciais SAP ausentes para ${companyDB} (necessário url/username/password)`);
  }
  let baseUrl = url.replace(/\/+$/, "");
  if (baseUrl.includes("/b1s/v1")) baseUrl = baseUrl.replace("/b1s/v1", "/b1s/v2");
  else if (!baseUrl.includes("/b1s/v2")) baseUrl = `${baseUrl}/b1s/v2`;
  return { baseUrl, username, password, sapCompanyDb };
}

async function sapLogin(creds: { baseUrl: string; username: string; password: string; sapCompanyDb: string }) {
  const resp = await sapFetch(`${creds.baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      UserName: creds.username,
      Password: creds.password,
      CompanyDB: creds.sapCompanyDb,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`SAP Login failed: ${resp.status} ${txt.slice(0, 200)}`);
  }
  const setCookie = resp.headers.get("set-cookie") ?? "";
  const sessionId = setCookie.match(/B1SESSION=([^;]+)/)?.[1];
  const routeId = setCookie.match(/ROUTEID=([^;]+)/)?.[1];
  if (!sessionId) throw new Error("SAP Login: B1SESSION ausente");
  await resp.body?.cancel().catch(() => {});
  return { cookie: `B1SESSION=${sessionId}${routeId ? `; ROUTEID=${routeId}` : ""}` };
}

async function sapFetchAll<T = SapDoc>(
  baseUrl: string,
  cookie: string,
  resource: string,
  filter: string,
  select: string,
  maxPages = 5,
): Promise<T[]> {
  const rows: T[] = [];
  let skip = 0;
  for (let page = 0; page < maxPages; page++) {
    const url = `${baseUrl}/${resource}?$select=${encodeURIComponent(select)}&$filter=${encodeURIComponent(filter)}&$top=200&$skip=${skip}`;
    const resp = await sapFetch(url, {
      headers: { Cookie: cookie, Prefer: "odata.maxpagesize=200" },
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`SAP ${resource} ${resp.status}: ${txt.slice(0, 200)}`);
    }
    const body = await resp.json();
    const batch: T[] = body.value ?? [];
    rows.push(...batch);
    if (batch.length < 200) break;
    skip += 200;
  }
  return rows;
}

interface DivergenceInsert {
  audit_run_id: string;
  company_db: string;
  divergence_type: DivergenceType;
  severity: Severity;
  description: string;
  expected_value?: number | null;
  actual_value?: number | null;
  delta_value?: number | null;
  is_fraud_flag?: boolean;
  card_code?: string | null;
  source_table?: string | null;
  source_id?: string | null;
}

function ruleFor(rules: Rule[], type: DivergenceType): Rule | undefined {
  // prefer company-specific over global
  return rules.find((r) => r.divergence_type === type && r.is_active);
}

function applyRules(
  runId: string,
  companyDB: string,
  rules: Rule[],
  data: {
    orders: SapDoc[];
    grpos: SapDoc[];
    invoices: SapDoc[];
    payments: Array<{ DocEntry: number; DocDate: string; CardCode: string; DocTotal: number; PaymentInvoices?: Array<{ DocEntry: number }> }>;
  },
): DivergenceInsert[] {
  const out: DivergenceInsert[] = [];
  const { orders, grpos, invoices, payments } = data;
  const orderByEntry = new Map(orders.map((o) => [o.DocEntry, o]));
  const grpoByEntry = new Map(grpos.map((g) => [g.DocEntry, g]));

  // 1. missing_order — PI/GRPO sem PO de origem
  const r1 = ruleFor(rules, "missing_order");
  if (r1) {
    for (const inv of invoices) {
      const baseEntries = (inv.DocumentLines ?? []).map((l) => l.BaseEntry).filter(Boolean);
      const hasBase = baseEntries.some((e) => orderByEntry.has(e!) || grpoByEntry.has(e!));
      if (!hasBase && (inv.DocumentLines?.length ?? 0) > 0) {
        out.push({
          audit_run_id: runId, company_db: companyDB,
          divergence_type: "missing_order", severity: r1.default_severity,
          description: `Fatura ${inv.DocNum} (${inv.CardName ?? inv.CardCode}) sem PO/GRPO de origem`,
          actual_value: inv.DocTotal, card_code: inv.CardCode,
          source_table: "PurchaseInvoices", source_id: String(inv.DocEntry),
        });
      }
    }
  }

  // 2. value_mismatch — PO vs PI
  const r2 = ruleFor(rules, "value_mismatch");
  if (r2) {
    const tolerance = r2.tolerance ?? 1;
    const mode = (r2.config?.mode as string) ?? "percent";
    for (const inv of invoices) {
      const baseEntries = (inv.DocumentLines ?? []).map((l) => l.BaseEntry).filter(Boolean) as number[];
      const linkedOrder = baseEntries.map((e) => orderByEntry.get(e)).find(Boolean);
      if (!linkedOrder) continue;
      const delta = Math.abs(linkedOrder.DocTotal - inv.DocTotal);
      const exceeded = mode === "percent"
        ? (linkedOrder.DocTotal > 0 && (delta / linkedOrder.DocTotal) * 100 > tolerance)
        : delta > tolerance;
      if (exceeded) {
        out.push({
          audit_run_id: runId, company_db: companyDB,
          divergence_type: "value_mismatch", severity: r2.default_severity,
          description: `Valor da fatura ${inv.DocNum} difere do PO ${linkedOrder.DocNum} (${mode === "percent" ? `${((delta / linkedOrder.DocTotal) * 100).toFixed(2)}%` : delta.toFixed(2)})`,
          expected_value: linkedOrder.DocTotal, actual_value: inv.DocTotal, delta_value: delta,
          card_code: inv.CardCode, source_table: "PurchaseInvoices", source_id: String(inv.DocEntry),
        });
      }
    }
  }

  // 3. vendor_mismatch — PI com CardCode diferente do PO
  const r3 = ruleFor(rules, "vendor_mismatch");
  if (r3) {
    for (const inv of invoices) {
      const baseEntries = (inv.DocumentLines ?? []).map((l) => l.BaseEntry).filter(Boolean) as number[];
      for (const e of baseEntries) {
        const po = orderByEntry.get(e);
        if (po && po.CardCode !== inv.CardCode) {
          out.push({
            audit_run_id: runId, company_db: companyDB,
            divergence_type: "vendor_mismatch", severity: r3.default_severity,
            description: `Fatura ${inv.DocNum} (${inv.CardCode}) tem PO ${po.DocNum} de outro fornecedor (${po.CardCode})`,
            card_code: inv.CardCode, is_fraud_flag: true,
            source_table: "PurchaseInvoices", source_id: String(inv.DocEntry),
          });
          break;
        }
      }
    }
  }

  // 4. duplicate_suspected — mesmo fornecedor, mesmo valor, ±N dias
  const r4 = ruleFor(rules, "duplicate_suspected");
  if (r4) {
    const windowDays = (r4.config?.window_days as number) ?? 3;
    const flagFraud = (r4.config?.flag_fraud as boolean) ?? true;
    for (let i = 0; i < invoices.length; i++) {
      for (let j = i + 1; j < invoices.length; j++) {
        const a = invoices[i], b = invoices[j];
        if (a.CardCode !== b.CardCode) continue;
        if (Math.abs(a.DocTotal - b.DocTotal) > 0.01) continue;
        const days = Math.abs((new Date(a.DocDate).getTime() - new Date(b.DocDate).getTime()) / 86400000);
        if (days > windowDays) continue;
        out.push({
          audit_run_id: runId, company_db: companyDB,
          divergence_type: "duplicate_suspected", severity: r4.default_severity,
          description: `Possível duplicidade: faturas ${a.DocNum} e ${b.DocNum} (${a.CardName ?? a.CardCode}) valor ${a.DocTotal.toFixed(2)} em ${days.toFixed(0)} dias`,
          actual_value: a.DocTotal, card_code: a.CardCode, is_fraud_flag: flagFraud,
          source_table: "PurchaseInvoices", source_id: `${a.DocEntry}|${b.DocEntry}`,
        });
      }
    }
  }

  // 5. payment_terms_mismatch
  const r5 = ruleFor(rules, "payment_terms_mismatch");
  if (r5) {
    for (const inv of invoices) {
      const baseEntries = (inv.DocumentLines ?? []).map((l) => l.BaseEntry).filter(Boolean) as number[];
      const po = baseEntries.map((e) => orderByEntry.get(e)).find(Boolean);
      if (po && po.PaymentGroupCode != null && inv.PaymentGroupCode != null && po.PaymentGroupCode !== inv.PaymentGroupCode) {
        out.push({
          audit_run_id: runId, company_db: companyDB,
          divergence_type: "payment_terms_mismatch", severity: r5.default_severity,
          description: `Condição de pagamento da fatura ${inv.DocNum} (${inv.PaymentGroupCode}) difere do PO ${po.DocNum} (${po.PaymentGroupCode})`,
          card_code: inv.CardCode, source_table: "PurchaseInvoices", source_id: String(inv.DocEntry),
        });
      }
    }
  }

  // 6. date_anomaly — PI antes do PO ou final de semana
  const r6 = ruleFor(rules, "date_anomaly");
  if (r6) {
    for (const inv of invoices) {
      const d = new Date(inv.DocDate);
      const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
      const baseEntries = (inv.DocumentLines ?? []).map((l) => l.BaseEntry).filter(Boolean) as number[];
      const po = baseEntries.map((e) => orderByEntry.get(e)).find(Boolean);
      const before = po && new Date(inv.DocDate) < new Date(po.DocDate);
      if (weekend || before) {
        out.push({
          audit_run_id: runId, company_db: companyDB,
          divergence_type: "date_anomaly", severity: r6.default_severity,
          description: before
            ? `Fatura ${inv.DocNum} datada antes do PO ${po!.DocNum}`
            : `Fatura ${inv.DocNum} emitida em fim de semana (${inv.DocDate})`,
          card_code: inv.CardCode, source_table: "PurchaseInvoices", source_id: String(inv.DocEntry),
        });
      }
    }
  }

  // 7. missing_grpo — PI sem GRPO
  const r7 = ruleFor(rules, "missing_grpo");
  if (r7) {
    for (const inv of invoices) {
      const baseEntries = (inv.DocumentLines ?? []).map((l) => l.BaseEntry).filter(Boolean) as number[];
      const hasGrpo = baseEntries.some((e) => grpoByEntry.has(e));
      if (!hasGrpo && (inv.DocumentLines?.length ?? 0) > 0) {
        out.push({
          audit_run_id: runId, company_db: companyDB,
          divergence_type: "missing_grpo", severity: r7.default_severity,
          description: `Fatura ${inv.DocNum} sem GRPO (recebimento) correspondente`,
          card_code: inv.CardCode, source_table: "PurchaseInvoices", source_id: String(inv.DocEntry),
        });
      }
    }
  }

  // 8. missing_ap — GRPO antigo sem PI
  const r8 = ruleFor(rules, "missing_ap");
  if (r8) {
    const days = (r8.config?.days as number) ?? 30;
    const cutoff = Date.now() - days * 86400000;
    const invoiceBaseEntries = new Set(
      invoices.flatMap((i) => (i.DocumentLines ?? []).map((l) => l.BaseEntry)).filter(Boolean) as number[],
    );
    for (const g of grpos) {
      if (new Date(g.DocDate).getTime() > cutoff) continue;
      if (!invoiceBaseEntries.has(g.DocEntry)) {
        out.push({
          audit_run_id: runId, company_db: companyDB,
          divergence_type: "missing_ap", severity: r8.default_severity,
          description: `GRPO ${g.DocNum} há mais de ${days} dias sem fatura`,
          actual_value: g.DocTotal, card_code: g.CardCode,
          source_table: "PurchaseDeliveryNotes", source_id: String(g.DocEntry),
        });
      }
    }
  }

  // 9. missing_payment — PI vencida sem pagamento
  const r9 = ruleFor(rules, "missing_payment");
  if (r9) {
    const overdueDays = (r9.config?.days_overdue as number) ?? 30;
    const cutoff = Date.now() - overdueDays * 86400000;
    const paidInvoices = new Set(
      payments.flatMap((p) => (p.PaymentInvoices ?? []).map((pi) => pi.DocEntry)),
    );
    for (const inv of invoices) {
      const due = inv.DocDueDate ? new Date(inv.DocDueDate).getTime() : null;
      if (!due || due > cutoff) continue;
      if (!paidInvoices.has(inv.DocEntry)) {
        out.push({
          audit_run_id: runId, company_db: companyDB,
          divergence_type: "missing_payment", severity: r9.default_severity,
          description: `Fatura ${inv.DocNum} (${inv.CardName ?? inv.CardCode}) vencida há +${overdueDays}d sem pagamento`,
          actual_value: inv.DocTotal, card_code: inv.CardCode,
          source_table: "PurchaseInvoices", source_id: String(inv.DocEntry),
        });
      }
    }
  }

  return out;
}

async function generateAiInsights(runId: string, companyDB: string, divergences: DivergenceInsert[], totals: { docs: number }) {
  if (!LOVABLE_API_KEY || divergences.length === 0) return;
  const summary = divergences.slice(0, 50).map((d) =>
    `[${d.severity}] ${d.divergence_type}: ${d.description}`
  ).join("\n");
  const fraudCount = divergences.filter((d) => d.is_fraud_flag).length;

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": LOVABLE_API_KEY,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "Você é um auditor sênior de SAP B1. Gere de 3 a 5 insights executivos, curtos e acionáveis, em português, sobre as divergências de uma auditoria. Cada insight deve ter um título de até 80 caracteres e um corpo de até 240 caracteres. Responda APENAS em JSON: {\"insights\":[{\"headline\":\"\",\"body\":\"\",\"severity\":\"low|medium|high|critical\"}]}" },
          { role: "user", content: `Empresa: ${companyDB}\nDocs analisados: ${totals.docs}\nTotal divergências: ${divergences.length}\nAlertas de fraude: ${fraudCount}\n\nAmostra:\n${summary}` },
        ],
      }),
    });
    if (!resp.ok) {
      await log(runId, "warn", "Falha ao gerar insights IA", { status: resp.status, company_db: companyDB });
      return;
    }
    const body = await resp.json();
    const content = body.choices?.[0]?.message?.content ?? "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const parsed = JSON.parse(jsonMatch[0]);
    const insights = (parsed.insights ?? []) as Array<{ headline: string; body: string; severity: Severity }>;
    if (insights.length === 0) return;
    await admin().from("audit_console_insights").insert(
      insights.map((i) => ({
        audit_run_id: runId, company_db: companyDB,
        headline: i.headline.slice(0, 200),
        body: i.body?.slice(0, 1000) ?? null,
        severity: i.severity ?? "medium",
        category: "executive_summary",
      })),
    );
  } catch (e) {
    await log(runId, "warn", `Insights IA falhou: ${(e as Error).message}`, { company_db: companyDB });
  }
}

async function processRun(runId: string, companyDB: string, dateFrom: string, dateTo: string) {
  const sb = admin();
  try {
    await updateRun(runId, { status: "running", current_step: "Carregando regras", progress_pct: 5 });
    const { data: rulesData } = await sb
      .from("audit_console_rules")
      .select("*")
      .or(`company_db.eq.${companyDB},company_db.is.null`)
      .eq("is_active", true);
    const rules = (rulesData ?? []) as Rule[];
    await log(runId, "info", `${rules.length} regras ativas`, { company_db: companyDB });

    await updateRun(runId, { current_step: "Autenticando no SAP", progress_pct: 10 });
    const creds = await getSapCreds(companyDB);
    const { cookie } = await sapLogin(creds);

    const filter = `DocDate ge '${dateFrom}' and DocDate le '${dateTo}'`;
    const docSelect = "DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocTotal,PaymentGroupCode,DocumentLines";

    await updateRun(runId, { current_step: "Buscando Pedidos de Compra", progress_pct: 25 });
    const orders = await sapFetchAll<SapDoc>(creds.baseUrl, cookie, "PurchaseOrders", filter, docSelect);
    await log(runId, "info", `${orders.length} PO carregadas`, { company_db: companyDB });

    await updateRun(runId, { current_step: "Buscando Recebimentos (GRPO)", progress_pct: 40 });
    const grpos = await sapFetchAll<SapDoc>(creds.baseUrl, cookie, "PurchaseDeliveryNotes", filter, docSelect);

    await updateRun(runId, { current_step: "Buscando Faturas de Compra", progress_pct: 55 });
    const invoices = await sapFetchAll<SapDoc>(creds.baseUrl, cookie, "PurchaseInvoices", filter, docSelect);

    await updateRun(runId, { current_step: "Buscando Pagamentos", progress_pct: 70 });
    const payments = await sapFetchAll<{ DocEntry: number; DocDate: string; CardCode: string; DocTotal: number; PaymentInvoices: Array<{ DocEntry: number }> }>(
      creds.baseUrl, cookie, "VendorPayments", filter,
      "DocEntry,DocDate,CardCode,DocTotal,PaymentInvoices",
    );

    const totalDocs = orders.length + grpos.length + invoices.length + payments.length;
    await log(runId, "info", `Total docs: ${totalDocs}`, { company_db: companyDB, orders: orders.length, grpos: grpos.length, invoices: invoices.length, payments: payments.length });

    await updateRun(runId, { current_step: "Aplicando regras", progress_pct: 80 });
    const divergences = applyRules(runId, companyDB, rules, { orders, grpos, invoices, payments });

    if (divergences.length > 0) {
      // chunked insert
      for (let i = 0; i < divergences.length; i += 500) {
        const chunk = divergences.slice(i, i + 500);
        const { error } = await sb.from("audit_console_divergences").insert(chunk);
        if (error) throw new Error(`Erro ao gravar divergências: ${error.message}`);
      }
    }

    await updateRun(runId, { current_step: "Gerando insights IA", progress_pct: 92 });
    await generateAiInsights(runId, companyDB, divergences, { docs: totalDocs });

    const fraudFlags = divergences.filter((d) => d.is_fraud_flag).length;
    await updateRun(runId, {
      status: "completed",
      current_step: "Concluída",
      progress_pct: 100,
      total_docs_analyzed: totalDocs,
      total_divergences: divergences.length,
      total_fraud_flags: fraudFlags,
      finished_at: new Date().toISOString(),
    });
    await log(runId, "info", `Auditoria finalizada: ${divergences.length} divergências, ${fraudFlags} alertas de fraude`, { company_db: companyDB });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await log(runId, "error", msg, { company_db: companyDB });
    await updateRun(runId, {
      status: "failed",
      error_message: msg.slice(0, 1000),
      finished_at: new Date().toISOString(),
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { email } = await requireAdmin(req);
    const { companyDB, scope, dateFrom, dateTo } = await req.json();
    if (!companyDB || typeof companyDB !== "string") {
      return new Response(JSON.stringify({ error: "companyDB obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const from = dateFrom || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to = dateTo || new Date().toISOString().slice(0, 10);

    // block parallel runs for the same company
    const sb = admin();
    const { data: existing } = await sb
      .from("audit_console_runs")
      .select("id")
      .eq("company_db", companyDB)
      .in("status", ["pending", "running"])
      .limit(1);
    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({ error: "Já existe uma auditoria em execução para esta empresa", runId: existing[0].id }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: run, error } = await sb
      .from("audit_console_runs")
      .insert({
        company_db: companyDB,
        scope: scope || "compras",
        date_from: from,
        date_to: to,
        status: "pending",
        triggered_by: email,
        current_step: "Aguardando início",
      })
      .select("id")
      .single();
    if (error || !run) throw new Error(error?.message ?? "Falha ao criar run");

    // background processing
    // @ts-ignore EdgeRuntime is provided by Supabase runtime
    EdgeRuntime.waitUntil(processRun(run.id, companyDB, from, to));

    return new Response(JSON.stringify({ runId: run.id, status: "pending" }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const status = msg === "UNAUTHORIZED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
