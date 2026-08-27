// Ajusta o ItemCode/descrição de uma linha de um pedido já lançado no ERP
// e aplica o PATCH correspondente no SAP B1 (Service Layer), usando o Apiuser.
// Somente administradores (ou chamadas com service role) podem executar.
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

function getSapBaseUrl(creds: Record<string, string>) {
  let baseUrl = (creds.service_layer_url || creds.base_url || creds.url || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("URL do SAP B1 não configurada");
  if (baseUrl.includes("/b1s/v1")) baseUrl = baseUrl.replace("/b1s/v1", "/b1s/v2");
  else if (!baseUrl.includes("/b1s/v2")) baseUrl = `${baseUrl}/b1s/v2`;
  return baseUrl;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const internalSecret = Deno.env.get("INTERNAL_FUNCTION_SECRET") || "";
    const providedInternal = req.headers.get("x-internal-key") || "";
    const isInternal = Boolean(internalSecret) && providedInternal === internalSecret;

    if (!isInternal) {
      if (!token) return json({ error: "UNAUTHORIZED" }, 401);
      if (token !== serviceKey) {
        // Autorização real: só service role ou admin consegue ler system_credentials (RLS).
        const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { error: authzErr } = await asCaller
          .from("system_credentials")
          .select("id")
          .limit(1);
        if (authzErr) return json({ error: "Apenas administradores podem alterar linhas já integradas." }, 403);
      }
    }



    const body = await req.json().catch(() => ({}));
    const expenseId = String(body.expense_id || "").trim();
    const itemCode = String(body.item_code || "").trim();
    const fromItemCode = String(body.from_item_code || "").trim();
    const toItemCode = String(body.to_item_code || "").trim();
    const bulkSwap = Boolean(fromItemCode && toItemCode);
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const lineNum = Number.isFinite(Number(body.line_num)) ? Number(body.line_num) : 0;
    if (!expenseId || (!itemCode && !bulkSwap)) {
      return json({ error: "expense_id e item_code (ou from_item_code/to_item_code) são obrigatórios" }, 400);
    }


    const { data: expense, error: expErr } = await supabase
      .from("expenses")
      .select("id, company_db, doc_type, sap_doc_entry, sap_doc_num")
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
    for (const r of credRows || []) creds[r.credential_key] = r.credential_value;

    const baseUrl = getSapBaseUrl(creds);
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

    if (bulkSwap) {
      // Troca em lote: mantém quantidades/valores exatamente como estão no SAP.
      const getRes = await fetch(
        `${baseUrl}/${endpoint}(${expense.sap_doc_entry})?$select=DocumentLines`,
        { headers: { Cookie: cookies } },
      );
      if (!getRes.ok) {
        const t = await getRes.text().catch(() => "");
        return json({ error: `Falha ao ler o documento no SAP [${getRes.status}]: ${t.slice(0, 300)}` }, 502);
      }
      const doc = await getRes.json();
      const sapLines: Record<string, unknown>[] = Array.isArray(doc?.DocumentLines) ? doc.DocumentLines : [];
      const changed = sapLines.filter((l) => String(l.ItemCode || "").trim() === fromItemCode).length;
      if (!changed) return json({ error: `Nenhuma linha com o item ${fromItemCode} no SAP.` }, 400);

      const payloadLines = sapLines.map((l) => {
        const isTarget = String(l.ItemCode || "").trim() === fromItemCode;
        const out: Record<string, unknown> = {
          LineNum: l.LineNum,
          ItemCode: isTarget ? toItemCode : l.ItemCode,
          Quantity: l.Quantity,
          UnitPrice: l.UnitPrice,
        };
        if (l.ItemDescription != null) out.ItemDescription = l.ItemDescription;
        if (l.CostingCode != null) out.CostingCode = l.CostingCode;
        if (l.CostingCode2 != null) out.CostingCode2 = l.CostingCode2;
        if (l.CostingCode3 != null) out.CostingCode3 = l.CostingCode3;
        if (l.ProjectCode != null) out.ProjectCode = l.ProjectCode;
        if (l.WarehouseCode != null) out.WarehouseCode = l.WarehouseCode;
        if (l.TaxCode != null) out.TaxCode = l.TaxCode;
        if (l.AccountCode != null) out.AccountCode = l.AccountCode;
        if (l.Usage != null) out.Usage = l.Usage;
        if (l.FreeText != null) out.FreeText = l.FreeText;
        return out;
      });

      const patchRes = await fetch(`${baseUrl}/${endpoint}(${expense.sap_doc_entry})`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookies },
        body: JSON.stringify({ DocumentLines: payloadLines }),
      });
      if (!patchRes.ok) {
        const t = await patchRes.text().catch(() => "");
        return json({ error: `SAP recusou o PATCH [${patchRes.status}]: ${t.slice(0, 500)}` }, 502);
      }

      await supabase
        .from("expense_items")
        .update({ item_code: toItemCode })
        .eq("expense_id", expenseId)
        .eq("item_code", fromItemCode);

      await supabase.from("audit_log").insert({
        action: "expense_line_item_bulk_swapped",
        entity_type: "expense",
        entity_id: expenseId,
        company_db: expense.company_db,
        details: { expense_id: expenseId, from_item_code: fromItemCode, to_item_code: toItemCode, lines: changed },
      }).then(() => {}, () => {});

      await supabase.from("expense_approval_log").insert({
        expense_id: expenseId,
        decision: "edited",
        approver_name: "Sistema",
        remarks:
          `Troca de item aplicada no Flow e no ERP: ${fromItemCode} → ${toItemCode} (${changed} linha(s)). Sem reenvio para aprovação.`,
      }).then(() => {}, () => {});


      return json({
        success: true,
        doc_entry: expense.sap_doc_entry,
        doc_num: expense.sap_doc_num,
        lines_changed: changed,
      });
    }

    const line: Record<string, unknown> = { LineNum: lineNum, ItemCode: itemCode };
    if (description) line.ItemDescription = description;

    const patchRes = await fetch(`${baseUrl}/${endpoint}(${expense.sap_doc_entry})`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookies },
      body: JSON.stringify({ DocumentLines: [line] }),
    });
    if (!patchRes.ok) {
      const t = await patchRes.text().catch(() => "");
      return json({ error: `SAP recusou o PATCH [${patchRes.status}]: ${t.slice(0, 500)}` }, 502);
    }

    const { data: localLines } = await supabase
      .from("expense_items")
      .select("id, created_at")
      .eq("expense_id", expenseId)
      .order("created_at", { ascending: true });
    const target = (localLines || [])[lineNum];
    if (target) {
      const patch: Record<string, unknown> = { item_code: itemCode };
      if (description) patch.description = description;
      await supabase.from("expense_items").update(patch).eq("id", target.id);
    }

    await supabase.from("audit_log").insert({
      action: "expense_line_item_patched",
      entity_type: "expense",
      entity_id: expenseId,
      company_db: expense.company_db,
      details: { expense_id: expenseId, line_num: lineNum, item_code: itemCode, description },
    }).then(() => {}, () => {});

    return json({ success: true, doc_entry: expense.sap_doc_entry, doc_num: expense.sap_doc_num, item_code: itemCode });

  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
