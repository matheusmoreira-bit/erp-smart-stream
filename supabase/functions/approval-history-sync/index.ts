import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const EXTERNAL_API_URL =
  "https://sap-b1-approval-hub-761741690592.us-west1.run.app/api/external/approval-history";

const OBJECT_CODE_TO_NAME: Record<string, string> = {
  "13": "Nota Fiscal de Saída",
  "15": "Entrega",
  "17": "Pedido de Venda",
  "18": "Nota Fiscal de Entrada",
  "19": "Nota de Crédito de Entrada",
  "20": "Recebimento de Mercadorias",
  "22": "Pedido de Compra",
  "23": "Cotação de Venda",
  "112": "Solicitação de Pagamento",
  "1470000113": "Solicitação de Compra",
  "540000006": "Pagamento Efetuado",
};

function pick<T = unknown>(obj: Record<string, any>, keys: string[]): T | undefined {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== "") return obj[k] as T;
  }
  return undefined;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number | null {
  const n = toNumber(v);
  return n === null ? null : Math.trunc(n);
}

function toDate(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function normalizeDecision(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  if (s === "Y" || s === "APPROVED" || s === "APROVADO") return "Y";
  if (s === "N" || s === "REJECTED" || s === "REJEITADO" || s === "NOT_APPROVED") return "N";
  return s;
}

function normalizeRow(row: Record<string, any>) {
  const company_db = String(
    pick(row, ["dbName", "DbName", "db_name", "company_db", "CompanyDB"]) || "",
  );
  const external_id = String(
    pick(row, [
      "id",
      "_id",
      "uuid",
      "audit_id",
      "auditId",
      "approval_id",
      "approvalId",
      "approval_request_id",
      "approvalRequestId",
    ]) ||
      `${company_db}-${pick(row, ["DocEntry", "doc_entry"]) || ""}-${
        pick(row, ["ApprovalRequestStep", "step"]) || ""
      }-${pick(row, ["UpdateDate", "decision_date"]) || ""}`,
  );

  const doc_object_type = String(pick(row, ["ObjectType", "doc_object_type", "object_type"]) || "");
  const doc_type_name = OBJECT_CODE_TO_NAME[doc_object_type] ||
    String(pick(row, ["doc_type_name", "docTypeName"]) || (doc_object_type ? `Documento (${doc_object_type})` : ""));

  return {
    external_id,
    company_db,
    decision: normalizeDecision(pick(row, ["Status", "decision", "status"])),
    decision_date: toDate(pick(row, ["UpdateDate", "decision_date", "DecisionDate", "decided_at", "CreateDate"])),
    approver_code: String(pick(row, ["approver_user_code", "approverCode", "approver_code", "UserCode"]) || "") || null,
    approver_name: String(pick(row, ["approver_name", "approverName", "UserName"]) || "") || null,
    approver_email: String(pick(row, ["approver_email", "approverEmail", "eMail", "email"]) || "") || null,
    requester_code: String(pick(row, ["requester_user_code", "requesterCode", "originator_code"]) || "") || null,
    requester_name: String(pick(row, ["requester_name", "requesterName", "OriginatorName"]) || "") || null,
    doc_object_type: doc_object_type || null,
    doc_type_name: doc_type_name || null,
    doc_entry: toInt(pick(row, ["DocEntry", "doc_entry", "DraftEntry"])),
    doc_num: toInt(pick(row, ["DocNum", "doc_num"])),
    doc_total: toNumber(pick(row, ["DocTotal", "doc_total", "Total"])),
    currency: String(pick(row, ["DocCurrency", "currency", "Currency"]) || "BRL"),
    card_code: String(pick(row, ["CardCode", "card_code"]) || "") || null,
    card_name: String(pick(row, ["CardName", "card_name"]) || "") || null,
    remarks: String(pick(row, ["Remarks", "remarks", "RemarksFromOriginator"]) || "") || null,
    stage_name: String(pick(row, ["StageName", "stage_name", "stage"]) || "") || null,
    step: toInt(pick(row, ["ApprovalRequestStep", "step", "Step"])),
    raw: row,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const token = Deno.env.get("API_AUDIT_HISTORY_TOKEN");
    if (!token) {
      throw new Error("API_AUDIT_HISTORY_TOKEN não configurado");
    }

    const url = new URL(req.url);
    const dbName = url.searchParams.get("dbName") || undefined;
    const status = url.searchParams.get("status") || undefined;

    const apiUrl = new URL(EXTERNAL_API_URL);
    if (dbName) apiUrl.searchParams.set("dbName", dbName);
    if (status) apiUrl.searchParams.set("status", status);

    const apiRes = await fetch(apiUrl.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-API-Token": token,
        Accept: "application/json",
      },
      redirect: "follow",
    });

    if (!apiRes.ok) {
      const text = await apiRes.text();
      throw new Error(`API externa retornou ${apiRes.status}: ${text.slice(0, 500)}`);
    }

    const ct = apiRes.headers.get("content-type") || "";
    if (!ct.includes("json")) {
      const text = await apiRes.text();
      throw new Error(`Resposta inesperada (${ct}): ${text.slice(0, 200)}`);
    }

    const body = await apiRes.json();
    const data: Record<string, any>[] = Array.isArray(body)
      ? body
      : Array.isArray(body?.data)
        ? body.data
        : Array.isArray(body?.history)
          ? body.history
          : [];

    const rows = data
      .map(normalizeRow)
      .filter((r) => r.external_id && r.company_db);

    let upserted = 0;
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await supabase
        .from("approval_history")
        .upsert(chunk, { onConflict: "company_db,external_id" });
      if (error) throw new Error(error.message);
      upserted += chunk.length;
    }

    await supabase.from("approval_history_sync_state").upsert({
      id: 1,
      last_sync_at: new Date().toISOString(),
      last_status: "success",
      last_message: `Importados ${upserted} registros (recebidos ${data.length}).`,
      last_count: upserted,
      updated_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({ success: true, received: data.length, upserted }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("approval_history_sync_state").upsert({
      id: 1,
      last_sync_at: new Date().toISOString(),
      last_status: "error",
      last_message: msg,
      updated_at: new Date().toISOString(),
    });
    console.error("approval-history-sync error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
