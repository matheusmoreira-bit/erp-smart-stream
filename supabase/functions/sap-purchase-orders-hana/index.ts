// Edge function: sap-purchase-orders-hana
// Lista pedidos de compra a partir da view HANA VW_PEDIDOS_COMPRA_APROVACOES.
// Autentica como Apiuser da empresa, chama a HANA view, ordena por data de
// lançamento (mais recente primeiro) e retorna paginado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { generateDynamicToken } from "../_shared/sap-middleware-token.ts";

const HANA_VIEWS_URL =
  Deno.env.get("HANA_VIEWS_URL") ||
  "https://anagaming.app.n8n.cloud/webhook/d7c643d9-040c-4e60-aa26-99344e60e89b";

function buildBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function sapLogin(baseUrl: string, u: string, p: string, db: string) {
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: u, Password: p, CompanyDB: db }),
  });
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}: ${await r.text().catch(() => "")}`);
  const json = await r.json();
  const cookies = r.headers.get("set-cookie") || "";
  const routeMatch = cookies.match(/B1ROUTEID=([^;]+)/);
  return { sessionId: json.SessionId as string, routeId: routeMatch?.[1] ?? "" };
}

async function sapLogout(baseUrl: string, s: { sessionId: string; routeId: string }) {
  try {
    await fetch(`${baseUrl}/Logout`, {
      method: "POST",
      headers: { Cookie: `B1SESSION=${s.sessionId}${s.routeId ? `; B1ROUTEID=${s.routeId}` : ""}` },
    });
  } catch { /* ignore */ }
}

async function fetchView(database: string, sessionId: string, view: string): Promise<Record<string, unknown>[]> {
  const dynamicToken = await generateDynamicToken();
  const params = new URLSearchParams({
    SessionId: sessionId,
    DB: database,
    View: view,
    DynamicToken: dynamicToken,
    _t: String(Date.now()),
  });
  const resp = await fetch(`${HANA_VIEWS_URL}?${params.toString()}`, {
    headers: {
      "X-SessionId": sessionId,
      "X-DB": database,
      "X-View": view,
      "X-Dynamic-Token": dynamicToken,
    },
  });
  if (!resp.ok) throw new Error(`HANA view ${view} falhou: ${resp.status}`);
  const text = await resp.text();
  if (!text) return [];
  const payload = JSON.parse(text);
  if (Array.isArray(payload)) {
    const wrapped = payload.find((it) => it && typeof it === "object" && Array.isArray((it as { data?: unknown }).data));
    if (wrapped) return (wrapped as { data: Record<string, unknown>[] }).data;
    return payload as Record<string, unknown>[];
  }
  if (payload && Array.isArray(payload.data)) return payload.data as Record<string, unknown>[];
  return [];
}

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const n2 = Number(v);
  return Number.isFinite(n2) ? n2 : null;
}

function toInt(v: unknown): number | null {
  const n = toNum(v);
  return n == null ? null : Math.trunc(n);
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function combineDateHour(date: unknown, hour: unknown): string | null {
  if (!date) return null;
  const d = new Date(String(date));
  if (isNaN(d.getTime())) return null;
  let hh = 0, mm = 0, ss = 0;
  if (hour != null && hour !== "") {
    const s = String(hour).trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
      const parts = s.split(":").map((p) => parseInt(p, 10));
      hh = parts[0] || 0; mm = parts[1] || 0; ss = parts[2] || 0;
    } else {
      const n = Number(s);
      if (Number.isFinite(n)) {
        if (n >= 100) { hh = Math.floor(n / 100); mm = n % 100; }
        else { hh = Math.trunc(n); }
      }
    }
  }
  d.setUTCHours(hh, mm, ss, 0);
  return d.toISOString();
}

function normalizeStatus(rawStatus: unknown, cancelled: unknown, approvalStatus: unknown): string {
  const cancel = String(cancelled ?? "").trim().toLowerCase();
  if (cancel === "y" || cancel === "sim" || cancel === "s" || cancel === "yes" || cancel === "true") {
    return "cancelado";
  }
  const appr = String(approvalStatus ?? "").trim().toLowerCase();
  if (/rejeit|reprov|negad/.test(appr)) return "rejeitado";
  if (/pend|aguard/.test(appr)) return "pendente_aprovacao";
  const st = String(rawStatus ?? "").trim().toLowerCase();
  if (st === "c" || /fech|encerr|closed/.test(st)) return "encerrado";
  if (st === "o" || /abert|open|em aberto/.test(st)) return "pc_lancado";
  return "pc_lancado";
}

function mapRow(raw: Record<string, unknown>, companyDb: string) {
  const docNum = toInt(pick(raw, "Nº pedido de compra", "N° pedido de compra", "Num_Pedido_Compra", "numPedidoCompra", "DocNum"));
  const docEntry = toInt(pick(raw, "Nº do Esboço", "N° do Esboço", "Num_Esboco", "DraftDocEntry", "DocEntry"));
  const cardCode = toStr(pick(raw, "Código do fornecedor", "Codigo_PN", "CardCode"));
  const cardName = toStr(pick(raw, "Nome do fornecedor", "Nome_PN", "CardName"));
  const docDate = toIso(pick(raw, "Data de lançamento", "Data_Lancamento", "DocDate"));
  const dueDate = toIso(pick(raw, "Data de entrega", "Data_Entrega", "DocDueDate"));
  const total = toNum(pick(raw, "Total do documento", "Total_Documento", "DocTotal"));
  const rawStatus = pick(raw, "Status do pedido", "Status_Pedido", "DocumentStatus");
  const cancelled = pick(raw, "Cancelado?", "Cancelado", "Cancelled");
  const solicitante = toStr(pick(raw, "FGR :: SOLICITANTE", "Solicitante", "FGR::SOLICITANTE"));
  const approver = toStr(pick(raw, "Aprovador(es)", "Aprovadores", "Aprovador"));
  const flowCreatedAt = combineDateHour(
    pick(raw, "Data de criação do fluxo", "Data_Criacao_Fluxo"),
    pick(raw, "Hora de criação do fluxo", "Hora_Criacao_Fluxo"),
  );
  const approvalDate = combineDateHour(
    pick(raw, "Data de aprovação", "Data_Aprovacao"),
    pick(raw, "Hora de aprovação", "Hora_Aprovacao"),
  );
  const approvalStatus = toStr(pick(raw, "Status da aprovação", "Status_Aprovacao"));
  const remarks = toStr(pick(raw, "Observações", "Observacoes", "Comments"));

  if (docNum == null && docEntry == null) return null;

  const idKey = docEntry != null ? `E${docEntry}` : `N${docNum}`;
  const status = normalizeStatus(rawStatus, cancelled, approvalStatus);

  return {
    id: `sap-${idKey}`,
    company_db: companyDb,
    sap_doc_num: docNum,
    sap_doc_entry: docEntry,
    supplier_code: cardCode ?? undefined,
    supplier_name: cardName || cardCode || "—",
    total_amount: total ?? 0,
    currency: "BRL",
    status,
    requester_name: solicitante || "(ERP)",
    current_approver: approver ?? undefined,
    doc_date: docDate ?? undefined,
    due_date: dueDate ?? undefined,
    remarks: remarks ?? undefined,
    sap_purchase_order_status: approvalStatus ?? undefined,
    created_at: docDate || flowCreatedAt || new Date().toISOString(),
    updated_at: approvalDate || docDate || new Date().toISOString(),
    origin: "manual" as const,
    // Extras HANA (não fazem parte de Expense mas úteis)
    hana_flow_created_at: flowCreatedAt,
    hana_approval_date: approvalDate,
  };
}

async function loadCreds(sb: any, companyDb: string): Promise<Record<string, string> | null> {
  const { data, error } = await sb
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (error) throw new Error(`Credenciais SAP erro: ${error.message}`);
  const kv: Record<string, string> = {};
  for (const r of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
    kv[r.credential_key] = r.credential_value ?? "";
  }
  if (!kv.service_layer_url || !kv.username || !kv.password) return null;
  if (kv.use_hana_db === "false") return null;
  if ((kv.username || "").trim().toLowerCase() !== "apiuser") return null;
  return kv;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const companyDb: string | undefined =
      body?.company_db || url.searchParams.get("company_db") || req.headers.get("x-company-db") || undefined;
    const limit = Math.min(Math.max(Number(body?.limit ?? url.searchParams.get("limit") ?? 100), 1), 500);
    const offset = Math.max(Number(body?.offset ?? url.searchParams.get("offset") ?? 0), 0);

    if (!companyDb) {
      return new Response(JSON.stringify({ error: "company_db obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const creds = await loadCreds(sb, companyDb);
    if (!creds) {
      return new Response(JSON.stringify({
        error: "Credenciais SAP indisponíveis ou usuário não é Apiuser para esta empresa",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const baseUrl = buildBaseUrl(creds.service_layer_url);
    const dbName = creds.company_db || companyDb;
    const session = await sapLogin(baseUrl, creds.username, creds.password, dbName);

    let rawRows: Record<string, unknown>[] = [];
    try {
      rawRows = await fetchView(dbName, session.sessionId, "VW_PEDIDOS_COMPRA_APROVACOES");
    } finally {
      await sapLogout(baseUrl, session);
    }

    const mapped = rawRows
      .map((r) => mapRow(r, companyDb))
      .filter((r): r is NonNullable<ReturnType<typeof mapRow>> => !!r);

    // Dedup por sap_doc_entry/sap_doc_num — pode haver múltiplas linhas
    // (uma por aprovador). Mantemos a mais recente por data de aprovação e
    // concatenamos aprovadores.
    const byKey = new Map<string, typeof mapped[number]>();
    for (const row of mapped) {
      const key = row.sap_doc_entry != null ? `E${row.sap_doc_entry}` : `N${row.sap_doc_num}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, row);
        continue;
      }
      const approvers = new Set(
        [existing.current_approver, row.current_approver]
          .filter(Boolean)
          .flatMap((s) => String(s).split(/[,;/]/).map((p) => p.trim()).filter(Boolean)),
      );
      existing.current_approver = approvers.size > 0 ? Array.from(approvers).join(", ") : existing.current_approver;
      const existingT = existing.hana_approval_date ? new Date(existing.hana_approval_date).getTime() : 0;
      const rowT = row.hana_approval_date ? new Date(row.hana_approval_date).getTime() : 0;
      if (rowT > existingT) {
        existing.status = row.status;
        existing.hana_approval_date = row.hana_approval_date;
        existing.updated_at = row.updated_at;
        existing.sap_purchase_order_status = row.sap_purchase_order_status;
      }
    }

    let rows = Array.from(byKey.values()).sort((a, b) => {
      const at = new Date(a.doc_date || a.created_at).getTime();
      const bt = new Date(b.doc_date || b.created_at).getTime();
      return bt - at;
    });


    const total = rows.length;
    const page = rows.slice(offset, offset + limit);

    return new Response(JSON.stringify({
      rows: page,
      total,
      offset,
      limit,
      has_more: offset + page.length < total,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
