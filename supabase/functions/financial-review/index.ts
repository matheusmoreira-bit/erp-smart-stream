// Financial Review module — surfaces unmatched advance payments / down payments
// in SAP B1 (AR + AP) and exposes actions to link them to invoices, perform
// internal reconciliation, or cancel the payment.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface SapCreds {
  baseUrl: string;
  companyDB: string;
  userName: string;
  password: string;
}

async function loadSapCreds(
  sb: ReturnType<typeof createClient>,
  companyDb: string,
): Promise<SapCreds | null> {
  const { data } = await sb
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (!data || data.length === 0) return null;
  const map: Record<string, string> = {};
  for (const r of data as { credential_key: string; credential_value: string }[]) {
    map[r.credential_key] = r.credential_value;
  }
  let baseUrl = (map.service_layer_url || map.base_url || map.url || "").replace(/\/+$/, "");
  if (!baseUrl) return null;
  if (baseUrl.includes("/b1s/v1")) baseUrl = baseUrl.replace("/b1s/v1", "/b1s/v2");
  else if (!baseUrl.includes("/b1s/v2")) baseUrl = `${baseUrl}/b1s/v2`;
  const sapCompanyDB = map.company_db || map.CompanyDB || companyDb;
  const userName = map.username || map.UserName;
  const password = map.password || map.Password;
  if (!userName || !password) return null;
  return { baseUrl, companyDB: sapCompanyDB, userName, password };
}

async function sapLogin(creds: SapCreds): Promise<string> {
  const resp = await fetch(`${creds.baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      CompanyDB: creds.companyDB,
      UserName: creds.userName,
      Password: creds.password,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`SAP Login HTTP ${resp.status}: ${t.slice(0, 200)}`);
  }
  return resp.headers.get("set-cookie") || "";
}

async function sapGetAll(
  baseUrl: string,
  cookies: string,
  endpoint: string,
  params: Record<string, string>,
  maxItems = 5000,
): Promise<any[]> {
  const all: any[] = [];
  const pageSize = 100;
  let url: string | null = (() => {
    const qp = new URLSearchParams(params);
    qp.set("$top", String(pageSize));
    qp.set("$skip", "0");
    return `${baseUrl}/${endpoint}?${qp.toString()}`;
  })();
  let pageCount = 0;
  while (url) {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookies,
        Prefer: "odata.maxpagesize=" + pageSize,
      },
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`SAP ${endpoint} HTTP ${resp.status}: ${t.slice(0, 300)}`);
    }
    const body: any = await resp.json();
    const items: any[] = body.value || [];
    all.push(...items);
    pageCount++;
    const nextLink: string | undefined = body["odata.nextLink"] || body["@odata.nextLink"];
    if (nextLink) {
      url = nextLink.startsWith("http") ? nextLink : `${baseUrl}/${nextLink}`;
    } else if (items.length >= pageSize) {
      const qp = new URLSearchParams(params);
      qp.set("$top", String(pageSize));
      qp.set("$skip", String(pageCount * pageSize));
      url = `${baseUrl}/${endpoint}?${qp.toString()}`;
    } else {
      url = null;
    }
    if (all.length > maxItems) break;
  }
  return all;
}

async function sapPost(
  baseUrl: string,
  cookies: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  const resp = await fetch(`${baseUrl}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (data as any)?.error?.message?.value || `HTTP ${resp.status}`;
    return { ok: false, error: msg };
  }
  return { ok: true, data };
}

async function sapCancel(
  baseUrl: string,
  cookies: string,
  endpoint: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // SAP B1 Service Layer cancellation
  const resp = await fetch(`${baseUrl}/${endpoint}/Cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies },
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    const msg = (data as any)?.error?.message?.value || `HTTP ${resp.status}`;
    return { ok: false, error: msg };
  }
  return { ok: true };
}

async function withSession<T>(
  creds: SapCreds,
  fn: (cookies: string) => Promise<T>,
): Promise<T> {
  const cookies = await sapLogin(creds);
  try {
    return await fn(cookies);
  } finally {
    fetch(`${creds.baseUrl}/Logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies },
    }).catch(() => {});
  }
}

interface AdvanceItem {
  doc_type: "ADVANCE_AP" | "ADVANCE_AR" | "PAYMENT_OA_OUT" | "PAYMENT_OA_IN";
  doc_entry: number;
  doc_num: number | null;
  card_code: string;
  card_name: string;
  bp_type: "supplier" | "customer";
  doc_date: string | null;
  doc_total: number;
  paid_to_date: number;
  open_amount: number;
  doc_currency: string;
  remarks: string | null;
  reference: string | null;
}

async function listAdvances(creds: SapCreds, cookies: string): Promise<AdvanceItem[]> {
  const items: AdvanceItem[] = [];

  // 1) AP DownPayment Invoices (PurchaseDownPayments) — open
  // DocumentStatus 'bost_Open' (open) and DocType 'dDocument_Items' or 'dDocument_Service'
  try {
    const apDp = await sapGetAll(creds.baseUrl, cookies, "PurchaseDownPayments", {
      $select: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,PaidToDate,DocCurrency,Comments,NumAtCard,DocumentStatus",
      $filter: "DocumentStatus eq 'bost_Open'",
    });
    for (const d of apDp) {
      const open = (d.DocTotal ?? 0) - (d.PaidToDate ?? 0);
      if (open <= 0.0001) continue;
      items.push({
        doc_type: "ADVANCE_AP",
        doc_entry: d.DocEntry,
        doc_num: d.DocNum,
        card_code: d.CardCode,
        card_name: d.CardName,
        bp_type: "supplier",
        doc_date: d.DocDate,
        doc_total: d.DocTotal,
        paid_to_date: d.PaidToDate ?? 0,
        open_amount: open,
        doc_currency: d.DocCurrency,
        remarks: d.Comments,
        reference: d.NumAtCard,
      });
    }
  } catch (e) {
    console.warn("PurchaseDownPayments err", e);
  }

  // 2) AR DownPayment Invoices (DownPayments)
  try {
    const arDp = await sapGetAll(creds.baseUrl, cookies, "DownPayments", {
      $select: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,PaidToDate,DocCurrency,Comments,NumAtCard,DocumentStatus",
      $filter: "DocumentStatus eq 'bost_Open'",
    });
    for (const d of arDp) {
      const open = (d.DocTotal ?? 0) - (d.PaidToDate ?? 0);
      if (open <= 0.0001) continue;
      items.push({
        doc_type: "ADVANCE_AR",
        doc_entry: d.DocEntry,
        doc_num: d.DocNum,
        card_code: d.CardCode,
        card_name: d.CardName,
        bp_type: "customer",
        doc_date: d.DocDate,
        doc_total: d.DocTotal,
        paid_to_date: d.PaidToDate ?? 0,
        open_amount: open,
        doc_currency: d.DocCurrency,
        remarks: d.Comments,
        reference: d.NumAtCard,
      });
    }
  } catch (e) {
    console.warn("DownPayments err", e);
  }

  // 3) Outgoing Payments lançados "on account" sem invoice
  try {
    const op = await sapGetAll(creds.baseUrl, cookies, "VendorPayments", {
      $select: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocCurrency,JournalRemarks,Reference1,DocType",
      $filter: "DocType eq 'rAccount'",
    });
    for (const d of op) {
      // For "on account" payments paid_to_date == DocTotal (fully paid into account, awaiting matching)
      items.push({
        doc_type: "PAYMENT_OA_OUT",
        doc_entry: d.DocEntry,
        doc_num: d.DocNum,
        card_code: d.CardCode,
        card_name: d.CardName,
        bp_type: "supplier",
        doc_date: d.DocDate,
        doc_total: d.DocTotal,
        paid_to_date: d.DocTotal ?? 0,
        open_amount: d.DocTotal ?? 0,
        doc_currency: d.DocCurrency,
        remarks: d.JournalRemarks,
        reference: d.Reference1,
      });
    }
  } catch (e) {
    console.warn("VendorPayments err", e);
  }

  // 4) Incoming Payments on account (clientes)
  try {
    const ip = await sapGetAll(creds.baseUrl, cookies, "IncomingPayments", {
      $select: "DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocCurrency,JournalRemarks,Reference1,DocType",
      $filter: "DocType eq 'rAccount'",
    });
    for (const d of ip) {
      items.push({
        doc_type: "PAYMENT_OA_IN",
        doc_entry: d.DocEntry,
        doc_num: d.DocNum,
        card_code: d.CardCode,
        card_name: d.CardName,
        bp_type: "customer",
        doc_date: d.DocDate,
        doc_total: d.DocTotal,
        paid_to_date: d.DocTotal ?? 0,
        open_amount: d.DocTotal ?? 0,
        doc_currency: d.DocCurrency,
        remarks: d.JournalRemarks,
        reference: d.Reference1,
      });
    }
  } catch (e) {
    console.warn("IncomingPayments err", e);
  }

  return items;
}

async function listOpenInvoicesForBp(
  creds: SapCreds,
  cookies: string,
  cardCode: string,
  bpType: "supplier" | "customer",
): Promise<any[]> {
  const endpoint = bpType === "supplier" ? "PurchaseInvoices" : "Invoices";
  const data = await sapGetAll(
    creds.baseUrl,
    cookies,
    endpoint,
    {
      $select: "DocEntry,DocNum,DocDate,DocTotal,PaidToDate,DocCurrency,NumAtCard",
      $filter: `CardCode eq '${cardCode.replace(/'/g, "''")}' and DocumentStatus eq 'bost_Open'`,
    },
    2000,
  );
  return data.map((d) => ({
    doc_entry: d.DocEntry,
    doc_num: d.DocNum,
    doc_date: d.DocDate,
    doc_total: d.DocTotal,
    paid_to_date: d.PaidToDate ?? 0,
    open_amount: (d.DocTotal ?? 0) - (d.PaidToDate ?? 0),
    doc_currency: d.DocCurrency,
    reference: d.NumAtCard,
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body JSON inválido" }, 400);
  }

  const action = body?.action;
  const companyDb: string | undefined = body?.company_db;
  if (!action) return json({ error: "action é obrigatório" }, 400);
  if (!companyDb) return json({ error: "company_db é obrigatório" }, 400);

  const creds = await loadSapCreds(sb, companyDb);
  if (!creds) return json({ error: "Credenciais SAP não configuradas para esta empresa" }, 400);

  try {
    if (action === "list-advances") {
      const data = await withSession(creds, (cookies) => listAdvances(creds, cookies));
      return json({ items: data });
    }

    if (action === "list-open-invoices") {
      const cardCode = String(body.card_code || "");
      const bpType = body.bp_type === "customer" ? "customer" : "supplier";
      if (!cardCode) return json({ error: "card_code é obrigatório" }, 400);
      const data = await withSession(creds, (cookies) =>
        listOpenInvoicesForBp(creds, cookies, cardCode, bpType),
      );
      return json({ items: data });
    }

    if (action === "internal-reconcile") {
      // Internal reconciliation between BP transactions
      // body: { card_code, lines: [{ TransId, TransRowId, ReconcileAmount }] }
      const cardCode = String(body.card_code || "");
      const lines = Array.isArray(body.lines) ? body.lines : [];
      if (!cardCode || lines.length < 2) {
        return json({ error: "card_code e ao menos 2 lines são obrigatórios" }, 400);
      }
      const result = await withSession(creds, async (cookies) => {
        return await sapPost(creds.baseUrl, cookies, "InternalReconciliationsService_Reconcile", {
          BusinessPartner: { CardCode: cardCode },
          ReconcileType: "rt_BPInternal",
          InternalReconciliationRows: lines,
        });
      });
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ ok: true, data: result.data });
    }

    if (action === "cancel-payment") {
      // body: { doc_type: 'PAYMENT_OA_OUT' | 'PAYMENT_OA_IN' | 'ADVANCE_AP' | 'ADVANCE_AR', doc_entry }
      const docEntry = Number(body.doc_entry);
      const docType = String(body.doc_type || "");
      if (!docEntry || !docType) return json({ error: "doc_type e doc_entry obrigatórios" }, 400);
      const endpointMap: Record<string, string> = {
        PAYMENT_OA_OUT: `VendorPayments(${docEntry})`,
        PAYMENT_OA_IN: `IncomingPayments(${docEntry})`,
        ADVANCE_AP: `PurchaseDownPayments(${docEntry})`,
        ADVANCE_AR: `DownPayments(${docEntry})`,
      };
      const endpoint = endpointMap[docType];
      if (!endpoint) return json({ error: "doc_type inválido" }, 400);
      const result = await withSession(creds, (cookies) =>
        sapCancel(creds.baseUrl, cookies, endpoint),
      );
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ ok: true });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
