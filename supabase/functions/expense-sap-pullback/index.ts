// Espelha no ERP Flow as alterações feitas diretamente no SAP B1
// (pedidos de compra/venda criados no Flow e editados dentro do SAP).
// NÃO altera status nem reabre o fluxo de aprovação: apenas atualiza os
// dados do documento e registra a mudança na trilha de auditoria.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function buildBaseUrl(raw: string): string {
  let url = (raw || "").replace(/\/+$/, "");
  if (!url) throw new Error("URL do SAP B1 não configurada");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round(v: number, d = 2): number {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

function dateOnly(v: unknown): string | null {
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

interface SapLine {
  ItemCode?: string | null;
  ItemDescription?: string | null;
  Quantity?: number;
  UnitPrice?: number;
  Price?: number;
  LineTotal?: number;
  CostingCode?: string | null;
  ProjectCode?: string | null;
  LineStatus?: string | null;
}

type LocalItem = {
  item_code: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  cost_center: string | null;
  project: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "UNAUTHORIZED" }, 401);

    let actorEmail = "service_role";
    if (token !== serviceKey) {
      const asCaller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: userData } = await asCaller.auth.getUser();
      actorEmail = userData?.user?.email || "desconhecido";
      // Autorização: somente admin consegue ler system_credentials (RLS).
      const { error: authzErr } = await asCaller.from("system_credentials").select("id").limit(1);
      if (authzErr) {
        return json({ error: "Apenas administradores podem sincronizar dados vindos do ERP." }, 403);
      }
    }

    const body = await req.json().catch(() => ({}));
    const expenseId = String(body.expense_id || "").trim();
    const apply = body.apply === true;
    if (!expenseId) return json({ error: "expense_id é obrigatório" }, 400);

    const { data: expense, error: expErr } = await supabase
      .from("expenses")
      .select(
        "id, company_db, doc_type, sap_doc_entry, sap_doc_num, supplier_code, supplier_name, total_amount, currency, cost_center, project, remarks, doc_date, due_date, status",
      )
      .eq("id", expenseId)
      .maybeSingle();
    if (expErr) throw new Error(expErr.message);
    if (!expense) return json({ error: "Documento não encontrado" }, 404);
    if (!expense.sap_doc_entry) return json({ error: "Documento ainda não integrado ao ERP" }, 400);

    const { data: credRows, error: credErr } = await supabase
      .from("system_credentials")
      .select("credential_key, credential_value")
      .eq("system_name", "sap")
      .eq("company_db", expense.company_db);
    if (credErr) throw new Error(credErr.message);
    const creds: Record<string, string> = {};
    for (const r of credRows || []) creds[r.credential_key] = r.credential_value ?? "";

    const baseUrl = buildBaseUrl(creds.service_layer_url || creds.base_url || creds.url || "");
    const user = creds.username || creds.user_name || creds.api_user || "";
    const pass = creds.password || creds.api_password || "";
    if (!user || !pass) return json({ error: "Credenciais de integração (Apiuser) não configuradas." }, 400);

    const loginRes = await fetch(`${baseUrl}/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ UserName: user, Password: pass, CompanyDB: expense.company_db }),
    });
    if (!loginRes.ok) {
      const t = await loginRes.text().catch(() => "");
      return json({ error: `Falha no login SAP [${loginRes.status}]: ${t.slice(0, 200)}` }, 502);
    }
    await loginRes.json().catch(() => ({}));
    const setCookie = loginRes.headers.get("set-cookie") || "";
    const sid = setCookie.match(/B1SESSION=([^;]+)/)?.[1];
    const rid = setCookie.match(/ROUTEID=([^;]+)/)?.[1];
    if (!sid) return json({ error: "SAP não retornou B1SESSION" }, 502);
    const cookies = `B1SESSION=${sid}${rid ? `; ROUTEID=${rid}` : ""}`;

    const endpoint = expense.doc_type === "sales" ? "Orders" : "PurchaseOrders";
    const docRes = await fetch(`${baseUrl}/${endpoint}(${expense.sap_doc_entry})`, {
      headers: { Cookie: cookies },
    });
    if (!docRes.ok) {
      const t = await docRes.text().catch(() => "");
      return json({ error: `Não foi possível ler o documento no SAP [${docRes.status}]: ${t.slice(0, 300)}` }, 502);
    }
    const sapDoc = await docRes.json();

    const sapLines: SapLine[] = Array.isArray(sapDoc?.DocumentLines) ? sapDoc.DocumentLines : [];
    const activeLines = sapLines.filter((l) => String(l.LineStatus || "") !== "bost_Close" || sapLines.length === 1);
    const lines = activeLines.length ? activeLines : sapLines;

    const sapItems: LocalItem[] = lines.map((l) => {
      const qty = num(l.Quantity) || 1;
      const unit = l.UnitPrice != null ? num(l.UnitPrice) : num(l.Price);
      const total = l.LineTotal != null ? num(l.LineTotal) : round(qty * unit);
      return {
        item_code: l.ItemCode ? String(l.ItemCode) : null,
        description: String(l.ItemDescription || l.ItemCode || "").slice(0, 500) || "—",
        quantity: round(qty, 4),
        unit_price: round(unit, 4),
        line_total: round(total, 2),
        cost_center: l.CostingCode ? String(l.CostingCode) : null,
        project: l.ProjectCode ? String(l.ProjectCode) : null,
      };
    });

    const uniq = (vals: Array<string | null>) => Array.from(new Set(vals.filter(Boolean) as string[]));
    const ccs = uniq(sapItems.map((i) => i.cost_center));
    const projs = uniq(sapItems.map((i) => i.project));

    const sapHeader: Record<string, unknown> = {
      supplier_code: sapDoc?.CardCode ? String(sapDoc.CardCode) : expense.supplier_code,
      supplier_name: sapDoc?.CardName ? String(sapDoc.CardName) : expense.supplier_name,
      total_amount: round(num(sapDoc?.DocTotal)),
      currency: sapDoc?.DocCurrency ? String(sapDoc.DocCurrency) : expense.currency,
      cost_center: ccs.length === 1 ? ccs[0] : expense.cost_center,
      project: projs.length === 1 ? projs[0] : expense.project,
      remarks: typeof sapDoc?.Comments === "string" ? sapDoc.Comments : expense.remarks,
      doc_date: dateOnly(sapDoc?.TaxDate) || dateOnly(sapDoc?.DocDate) || expense.doc_date,
      due_date: dateOnly(sapDoc?.DocDueDate) || expense.due_date,
      sap_purchase_order_status: sapDoc?.DocumentStatus ? String(sapDoc.DocumentStatus) : null,
    };

    // Diff do cabeçalho
    const headerChanges: Array<{ field: string; from: unknown; to: unknown }> = [];
    for (const [field, to] of Object.entries(sapHeader)) {
      if (field === "sap_purchase_order_status") continue;
      const from = (expense as Record<string, unknown>)[field] ?? null;
      const a = typeof from === "number" || typeof to === "number" ? num(from) : (from ?? "");
      const b = typeof from === "number" || typeof to === "number" ? num(to) : (to ?? "");
      if (String(a) !== String(b)) headerChanges.push({ field, from: from ?? null, to: to ?? null });
    }

    const { data: localItemRows } = await supabase
      .from("expense_items")
      .select("id, item_code, description, quantity, unit_price, line_total, cost_center, project, items_group_code, items_group_name, created_at")
      .eq("expense_id", expenseId)
      .order("created_at", { ascending: true });

    const localItems: LocalItem[] = (localItemRows || []).map((r) => ({
      item_code: r.item_code ?? null,
      description: r.description,
      quantity: round(num(r.quantity), 4),
      unit_price: round(num(r.unit_price), 4),
      line_total: round(num(r.line_total), 2),
      cost_center: r.cost_center ?? null,
      project: r.project ?? null,
    }));

    const sig = (i: LocalItem) =>
      [i.item_code || "", i.description, i.quantity, i.unit_price, i.line_total, i.cost_center || "", i.project || ""].join("|");
    const itemsChanged =
      localItems.length !== sapItems.length ||
      localItems.some((it, idx) => sig(it) !== sig(sapItems[idx]));

    const hasChanges = headerChanges.length > 0 || itemsChanged;

    if (!apply) {
      return json({
        success: true,
        applied: false,
        has_changes: hasChanges,
        header_changes: headerChanges,
        items_changed: itemsChanged,
        sap_items: sapItems,
        local_items: localItems,
        sap_doc_num: sapDoc?.DocNum ?? expense.sap_doc_num,
        sap_status: sapHeader.sap_purchase_order_status,
      });
    }

    if (!hasChanges) {
      return json({ success: true, applied: false, has_changes: false, message: "Documento já está idêntico ao ERP." });
    }

    // Atualiza cabeçalho — sem tocar em status, aprovador ou cadeia de alçada.
    const { error: updErr } = await supabase
      .from("expenses")
      .update({ ...sapHeader, updated_at: new Date().toISOString() })
      .eq("id", expenseId);
    if (updErr) throw new Error(updErr.message);

    if (itemsChanged) {
      const keepMeta = (localItemRows || [])[0] as { items_group_code?: number | null; items_group_name?: string | null } | undefined;
      await supabase.from("expense_items").delete().eq("expense_id", expenseId);
      const now = Date.now();
      const rows = sapItems.map((it, idx) => ({
        expense_id: expenseId,
        ...it,
        items_group_code: keepMeta?.items_group_code ?? null,
        items_group_name: keepMeta?.items_group_name ?? null,
        created_at: new Date(now + idx).toISOString(),
      }));
      const { error: insErr } = await supabase.from("expense_items").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }

    const details = {
      expense_id: expenseId,
      company_db: expense.company_db,
      sap_doc_entry: expense.sap_doc_entry,
      sap_doc_num: sapDoc?.DocNum ?? expense.sap_doc_num,
      header_changes: headerChanges,
      items_changed: itemsChanged,
      items_before: localItems,
      items_after: sapItems,
      actor: actorEmail,
      note: "Alteração feita diretamente no ERP e espelhada no Flow, sem reabrir aprovação.",
    };

    await supabase.from("audit_log").insert({
      action: "expense_sap_pullback",
      entity_type: "expense",
      entity_id: expenseId,
      actor_email: actorEmail,
      company_db: expense.company_db,
      details,
    }).then(() => {}, () => {});

    await supabase.from("integration_log").insert({
      system_name: "sap",
      action: "expense_sap_pullback",
      company_db: expense.company_db,
      status: "ok",
      request_meta: { expense_id: expenseId, sap_doc_entry: expense.sap_doc_entry, actor: actorEmail },
      response_meta: { header_changes: headerChanges, items_changed: itemsChanged },
    }).then(() => {}, () => {});

    return json({
      success: true,
      applied: true,
      has_changes: true,
      header_changes: headerChanges,
      items_changed: itemsChanged,
      sap_items: sapItems,
      local_items: localItems,
      sap_doc_num: sapDoc?.DocNum ?? expense.sap_doc_num,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
