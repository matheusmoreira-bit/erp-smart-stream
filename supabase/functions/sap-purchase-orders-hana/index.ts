// Edge function: sap-purchase-orders-hana
// Lista pedidos de compra a partir da view HANA VW_ACOMPANHAMENTO_PEDIDOS.
// Autentica como Apiuser da empresa, chama a HANA view, agrega por pedido
// (uma linha por baixa/pagamento) e retorna paginado ordenado pela data
// de lançamento do pedido (mais recente primeiro).


import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { fetchHanaView } from "../_shared/hana-views.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retry-count, x-sap-session, x-sap-route, x-sap-user, x-sap-auth-token, x-company-db",
};

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
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  // "1.234,56" (pt-BR) vs "1234.56" (already numeric string)
  const hasComma = s.includes(",");
  const normalized = hasComma ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
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

function normalizeStatus(statusPagamento: unknown, statusDocOrigem: unknown): string {
  const sp = String(statusPagamento ?? "").trim().toLowerCase();
  const sd = String(statusDocOrigem ?? "").trim().toLowerCase();
  if (/cancel/.test(sd) || /cancel/.test(sp)) return "cancelado";
  if (/(pago|baix|liquid|quit)/.test(sp)) return "encerrado";
  if (/(pend|aberto|aguard|parcial)/.test(sp)) return "pc_lancado";
  if (/(ativ|em aberto|aberto)/.test(sd)) return "pc_lancado";
  return "pc_lancado";
}

function mapRow(raw: Record<string, unknown>, companyDb: string) {
  const docNum = toInt(pick(raw, "Numero_Pedido_Compra", "Nº pedido de compra", "N° pedido de compra", "DocNum"));
  if (docNum == null) return null;

  const cardCode = toStr(pick(raw, "Cod_PN", "Código PN/Fornecedor", "CardCode"));
  const cardName = toStr(pick(raw, "Nome_PN", "Fornecedor / Parceiro", "CardName"));
  const supplierEmail = toStr(pick(raw, "Email_Fornecedor"));
  const docDate = toIso(pick(raw, "Data_Lancamento_Pedido", "Data de lançamento", "DocDate"));
  const nfDate = toIso(pick(raw, "Data_Lancamento_NF"));
  const dueDate = toIso(pick(raw, "Data_Vencimento_Pagamento", "Data de vencimento", "DocDueDate"));
  const paymentDate = toIso(pick(raw, "Data_do_Pagamento"));
  const valorAplicado = toNum(pick(raw, "Valor_Aplicado_Neste_Doc"));
  const valorTotalPago = toNum(pick(raw, "Valor_Total_Pago"));
  const currencyRaw = toStr(pick(raw, "Moeda", "Currency"));
  const statusPagamento = toStr(pick(raw, "Status_Pagamento"));
  const statusDocOrigem = toStr(pick(raw, "Status_Documento_Origem"));
  const solicitante = toStr(pick(raw, "Nome_Solicitante", "Solicitante"));
  const solicitanteEmail = toStr(pick(raw, "Email_Solicitante"));
  const solicitanteCode = toStr(pick(raw, "UserCode_Solicitante"));
  const filial = toStr(pick(raw, "Filial"));
  const numNfRef = toStr(pick(raw, "Num_NF_Referencia"));
  const numDocOrigem = toStr(pick(raw, "Numero_Documento_Origem"));
  const numPagamentoSap = toStr(pick(raw, "Numero_Pagamento_SAP"));

  const status = normalizeStatus(statusPagamento, statusDocOrigem);
  const currency = currencyRaw && currencyRaw !== "R$" ? currencyRaw : "BRL";
  const remarksParts: string[] = [];
  if (statusPagamento) remarksParts.push(statusPagamento);
  if (numNfRef) remarksParts.push(`NF ${numNfRef}`);
  if (filial) remarksParts.push(filial);

  return {
    id: `sap-N${docNum}`,
    company_db: companyDb,
    sap_doc_num: docNum,
    sap_doc_entry: null as number | null,
    supplier_code: cardCode ?? undefined,
    supplier_name: cardName || cardCode || "—",
    supplier_email: supplierEmail ?? undefined,
    total_amount: valorAplicado ?? 0,
    currency,
    status,
    requester_name: solicitante || "(ERP)",
    requester_email: solicitanteEmail ?? undefined,
    requester_code: solicitanteCode ?? undefined,
    current_approver: undefined as string | undefined,
    doc_date: docDate ?? undefined,
    due_date: dueDate ?? undefined,
    nf_date: nfDate ?? undefined,
    payment_date: paymentDate ?? undefined,
    remarks: remarksParts.join(" · ") || undefined,
    sap_purchase_order_status: statusPagamento ?? statusDocOrigem ?? undefined,
    num_nf_referencia: numNfRef ?? undefined,
    numero_documento_origem: numDocOrigem ?? undefined,
    numero_pagamento_sap: numPagamentoSap ?? undefined,
    branch: filial ?? undefined,
    valor_total_pago: valorTotalPago ?? undefined,
    created_at: docDate || new Date().toISOString(),
    updated_at: paymentDate || nfDate || docDate || new Date().toISOString(),
    origin: "manual" as const,
    hana_flow_created_at: docDate,
    hana_approval_date: paymentDate,
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
    const HANA_SCHEMA_OVERRIDES: Record<string, string> = { open_gaming_sa: "OPENGAMING" };
    const schema = HANA_SCHEMA_OVERRIDES[companyDb] || dbName;
    const session = await sapLogin(baseUrl, creds.username, creds.password, dbName);

    let rawRows: Record<string, unknown>[] = [];
    try {
      rawRows = await fetchHanaView({
        schema,
        view: "VW_PEDIDOS_COMPRA_APROVACOES",
        sessionId: session.sessionId,
        hanaApiUrl: creds.hana_api_url,
        useV2: creds.hana_api_v2 === "true",
      });
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
