// Synapse — Notificações de andamento de Pedidos de Compra
// Marcos: approved, grpo (NF entrada), ap_invoice (contas a pagar), ap_paid (baixado)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const INTEGRATION_KEY = "purchase_order_notifications";

type Sup = ReturnType<typeof createClient>;

function svc() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getSapCreds(supabase: Sup, companyDb: string) {
  const { data, error } = await supabase
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (error) throw new Error(`Credenciais SAP: ${error.message}`);
  if (!data?.length) throw new Error(`Credenciais SAP não configuradas para ${companyDb}`);
  const out: Record<string, string> = {};
  for (const r of data) out[r.credential_key as string] = r.credential_value as string;
  return out;
}

async function loginSap(creds: Record<string, string>) {
  let baseUrl = (creds.service_layer_url || creds.base_url || creds.url || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("URL SAP não configurada");
  if (baseUrl.includes("/b1s/v1")) baseUrl = baseUrl.replace("/b1s/v1", "/b1s/v2");
  else if (!baseUrl.includes("/b1s/v2")) baseUrl = `${baseUrl}/b1s/v2`;
  const companyDB = creds.company_db || creds.CompanyDB;
  const userName = creds.username || creds.UserName;
  const password = creds.password || creds.Password;
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ CompanyDB: companyDB, UserName: userName, Password: password }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`SAP Login falhou (${r.status}): ${t.slice(0, 200)}`);
  }
  const cookies = r.headers.get("set-cookie") || "";
  return { baseUrl, cookies };
}

async function sapGet(baseUrl: string, cookies: string, path: string) {
  const r = await fetch(`${baseUrl}${path}`, {
    headers: { Cookie: cookies, Prefer: "odata.maxpagesize=200" },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`SAP GET ${path} ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

function dateNDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function fetchPurchaseOrders(baseUrl: string, cookies: string, daysBack: number) {
  const since = dateNDaysAgo(daysBack);
  const filter = encodeURIComponent(`DocDate ge '${since}'`);
  const data = await sapGet(
    baseUrl,
    cookies,
    `/PurchaseOrders?$filter=${filter}&$select=DocEntry,DocNum,DocDate,DocTotal,DocCurrency,CardCode,CardName,DocumentStatus,RequesterEmail,RequesterCode,RequesterName,Comments&$orderby=DocEntry desc&$top=200`,
  );
  return (data.value || []) as any[];
}

async function fetchLinkedDocs(
  baseUrl: string,
  cookies: string,
  collection: "PurchaseDeliveryNotes" | "PurchaseInvoices",
  daysBack: number,
) {
  const since = dateNDaysAgo(daysBack);
  const filter = encodeURIComponent(`DocDate ge '${since}'`);
  const data = await sapGet(
    baseUrl,
    cookies,
    `/${collection}?$filter=${filter}&$select=DocEntry,DocNum,DocDate,DocTotal,DocCurrency,CardName,DocumentStatus,DocumentLines&$orderby=DocEntry desc&$top=200`,
  );
  return (data.value || []) as any[];
}

async function resolveRequesterEmail(
  baseUrl: string,
  cookies: string,
  po: any,
): Promise<string | null> {
  if (po.RequesterEmail && /\S+@\S+/.test(po.RequesterEmail)) return po.RequesterEmail;
  if (po.RequesterCode) {
    try {
      const u = await sapGet(baseUrl, cookies, `/Users('${po.RequesterCode}')?$select=EMail,UserCode`);
      if (u?.EMail) return u.EMail;
    } catch (_) { /* ignore */ }
    try {
      const u2 = await sapGet(
        baseUrl,
        cookies,
        `/Users?$filter=${encodeURIComponent(`UserCode eq '${po.RequesterCode}'`)}&$select=EMail&$top=1`,
      );
      const v = (u2.value || [])[0];
      if (v?.EMail) return v.EMail;
    } catch (_) { /* ignore */ }
  }
  return null;
}

const MILESTONE_LABELS: Record<string, { title: string; subject: string; intro: string }> = {
  approved: {
    title: "Pedido de compra aprovado",
    subject: "Pedido de compra aprovado",
    intro: "O seu pedido de compra foi aprovado e seguirá para o fornecedor.",
  },
  grpo: {
    title: "Recebimento da mercadoria/serviço",
    subject: "NF de entrada lançada",
    intro: "A nota fiscal de entrada referente ao seu pedido foi lançada no SAP.",
  },
  ap_invoice: {
    title: "Contas a pagar gerado",
    subject: "Contas a pagar gerado",
    intro: "Foi criado o título a pagar referente ao seu pedido.",
  },
  ap_paid: {
    title: "Contas a pagar baixado",
    subject: "Pagamento liquidado",
    intro: "O título referente ao seu pedido foi liquidado/pago.",
  },
};

function brl(n: any, currency = "BRL") {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
  } catch {
    return v.toFixed(2);
  }
}

function renderEmailHtml(opts: {
  milestone: string;
  po: any;
  companyDb: string;
  linkedDoc?: any;
}) {
  const meta = MILESTONE_LABELS[opts.milestone];
  const linked = opts.linkedDoc;
  return `<!doctype html>
<html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="background:#0f172a;padding:20px 24px;color:#fff">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.7">Ana Gaming · Synapse</div>
      <div style="font-size:20px;font-weight:600;margin-top:4px">${meta.title}</div>
    </div>
    <div style="padding:24px">
      <p style="margin:0 0 16px;font-size:14px;line-height:1.5">Olá${opts.po.RequesterName ? ` ${opts.po.RequesterName}` : ""},</p>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.5">${meta.intro}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="padding:6px 0;color:#6b7280">Empresa</td><td style="padding:6px 0;text-align:right">${opts.companyDb}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Pedido</td><td style="padding:6px 0;text-align:right">#${opts.po.DocNum} (entry ${opts.po.DocEntry})</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Data</td><td style="padding:6px 0;text-align:right">${opts.po.DocDate || "-"}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Fornecedor</td><td style="padding:6px 0;text-align:right">${opts.po.CardName || opts.po.CardCode || "-"}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Total</td><td style="padding:6px 0;text-align:right;font-weight:600">${brl(opts.po.DocTotal, opts.po.DocCurrency || "BRL")}</td></tr>
        ${linked ? `<tr><td style="padding:6px 0;color:#6b7280">Documento vinculado</td><td style="padding:6px 0;text-align:right">#${linked.DocNum} — ${brl(linked.DocTotal, linked.DocCurrency || "BRL")}</td></tr>` : ""}
      </table>
      <p style="margin:24px 0 0;font-size:12px;color:#6b7280;line-height:1.5">Notificação automática — não responda a este email.</p>
    </div>
  </div>
</body></html>`;
}

async function alreadyNotified(supabase: Sup, companyDb: string, docEntry: number, milestone: string) {
  const { data } = await supabase
    .from("po_notification_sent")
    .select("id")
    .eq("company_db", companyDb)
    .eq("po_doc_entry", docEntry)
    .eq("milestone", milestone)
    .maybeSingle();
  return !!data;
}

async function recordNotification(supabase: Sup, row: Record<string, unknown>) {
  await supabase.from("po_notification_sent").insert(row as any);
}

async function sendEmail(
  supabase: Sup,
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("send-smtp-email", {
      body: { to, subject, html },
    });
    if (error) return { ok: false, error: error.message || String(error) };
    if (data?.ok === false) return { ok: false, error: data.error || "send-smtp-email retornou erro" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function processMilestone(
  supabase: Sup,
  baseUrl: string,
  cookies: string,
  companyDb: string,
  po: any,
  milestone: string,
  linkedDoc?: any,
): Promise<{ status: "skipped" | "sent" | "error"; reason?: string }> {
  if (await alreadyNotified(supabase, companyDb, po.DocEntry, milestone)) {
    return { status: "skipped", reason: "duplicate" };
  }
  const meta = MILESTONE_LABELS[milestone];
  const subject = `[${companyDb}] ${meta.subject} — PO #${po.DocNum}`;
  const html = renderEmailHtml({ milestone, po, companyDb, linkedDoc });
  const recipient = await resolveRequesterEmail(baseUrl, cookies, po);

  if (!recipient) {
    await recordNotification(supabase, {
      company_db: companyDb,
      po_doc_entry: po.DocEntry,
      po_doc_num: po.DocNum,
      milestone,
      recipient_email: null,
      email_subject: subject,
      email_html: html,
      status: "error",
      error_message: "Solicitante sem email cadastrado",
    });
    return { status: "error", reason: "no-email" };
  }

  const send = await sendEmail(supabase, recipient, subject, html);
  await recordNotification(supabase, {
    company_db: companyDb,
    po_doc_entry: po.DocEntry,
    po_doc_num: po.DocNum,
    milestone,
    recipient_email: recipient,
    email_subject: subject,
    email_html: html,
    status: send.ok ? "sent" : "error",
    error_message: send.ok ? null : send.error,
  });
  return { status: send.ok ? "sent" : "error", reason: send.error };
}

async function processCompany(
  supabase: Sup,
  companyDb: string,
  daysBack: number,
): Promise<Record<string, unknown>> {
  const summary: Record<string, number> = { approved: 0, grpo: 0, ap_invoice: 0, ap_paid: 0, errors: 0, skipped: 0 };
  const errors: string[] = [];

  const sapCreds = await getSapCreds(supabase, companyDb);
  const { baseUrl, cookies } = await loginSap(sapCreds);

  // 1) Aprovados (todo PO existente é considerado aprovado)
  const pos = await fetchPurchaseOrders(baseUrl, cookies, daysBack);
  const posByEntry = new Map<number, any>();
  for (const po of pos) posByEntry.set(po.DocEntry, po);

  for (const po of pos) {
    const r = await processMilestone(supabase, baseUrl, cookies, companyDb, po, "approved");
    if (r.status === "sent") summary.approved++;
    else if (r.status === "error") { summary.errors++; errors.push(`approved/${po.DocEntry}: ${r.reason}`); }
    else summary.skipped++;
  }

  // 2) NF de entrada (PurchaseDeliveryNotes vinculadas a PO)
  const pdns = await fetchLinkedDocs(baseUrl, cookies, "PurchaseDeliveryNotes", daysBack);
  for (const doc of pdns) {
    const lines = doc.DocumentLines || [];
    const linkedEntries = new Set<number>();
    for (const ln of lines) {
      if ((ln.BaseType === 22 || ln.BaseType === "22") && typeof ln.BaseEntry === "number") {
        linkedEntries.add(ln.BaseEntry);
      }
    }
    for (const entry of linkedEntries) {
      const po = posByEntry.get(entry);
      if (!po) continue;
      const r = await processMilestone(supabase, baseUrl, cookies, companyDb, po, "grpo", doc);
      if (r.status === "sent") summary.grpo++;
      else if (r.status === "error") { summary.errors++; errors.push(`grpo/${po.DocEntry}: ${r.reason}`); }
      else summary.skipped++;
    }
  }

  // 3) Contas a pagar / 4) baixado (PurchaseInvoices)
  const invoices = await fetchLinkedDocs(baseUrl, cookies, "PurchaseInvoices", daysBack);
  for (const doc of invoices) {
    const lines = doc.DocumentLines || [];
    const linkedEntries = new Set<number>();
    for (const ln of lines) {
      // BaseType 22 = PO, BaseType 20 = PDN -> nesse caso tentamos achar PO via PDN.BaseEntry; simplificação: ignorar
      if ((ln.BaseType === 22 || ln.BaseType === "22") && typeof ln.BaseEntry === "number") {
        linkedEntries.add(ln.BaseEntry);
      }
    }
    const closed = doc.DocumentStatus === "bost_Close";
    for (const entry of linkedEntries) {
      const po = posByEntry.get(entry);
      if (!po) continue;
      // ap_invoice
      const ri = await processMilestone(supabase, baseUrl, cookies, companyDb, po, "ap_invoice", doc);
      if (ri.status === "sent") summary.ap_invoice++;
      else if (ri.status === "error") { summary.errors++; errors.push(`ap_invoice/${po.DocEntry}: ${ri.reason}`); }
      else summary.skipped++;
      // ap_paid
      if (closed) {
        const rp = await processMilestone(supabase, baseUrl, cookies, companyDb, po, "ap_paid", doc);
        if (rp.status === "sent") summary.ap_paid++;
        else if (rp.status === "error") { summary.errors++; errors.push(`ap_paid/${po.DocEntry}: ${rp.reason}`); }
        else summary.skipped++;
      }
    }
  }

  return { ...summary, errors_sample: errors.slice(0, 10) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = svc();
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const requestedCompany: string | undefined = body?.company_db;

  // Global config check
  const { data: gs } = await supabase
    .from("synapse_global_settings")
    .select("is_active_global, parameters")
    .eq("integration_key", INTEGRATION_KEY)
    .maybeSingle();

  const globalActive = gs?.is_active_global !== false;
  const daysBack = Number((gs?.parameters as any)?.days_back) || 30;

  if (!globalActive && !body?.force) {
    await supabase.from("synapse_execution_log").insert({
      integration_key: INTEGRATION_KEY,
      status: "skipped",
      affected_count: 0,
      details: { reason: "global_disabled" },
    } as any);
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "global_disabled" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Empresas ativas
  let q = supabase
    .from("synapse_integrations")
    .select("id, company_db, is_active")
    .eq("integration_key", INTEGRATION_KEY)
    .eq("is_active", true);
  if (requestedCompany) q = q.eq("company_db", requestedCompany);

  const { data: integrations, error: intErr } = await q;
  if (intErr) {
    return new Response(JSON.stringify({ error: intErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const overall: any[] = [];
  let totalSent = 0;

  for (const integ of integrations || []) {
    const companyDb = integ.company_db as string;
    if (!companyDb) continue;
    const startedAt = new Date().toISOString();
    try {
      const summary = await processCompany(supabase, companyDb, daysBack);
      const sent =
        (summary.approved as number) + (summary.grpo as number) +
        (summary.ap_invoice as number) + (summary.ap_paid as number);
      totalSent += sent;
      overall.push({ company_db: companyDb, ...summary });

      await supabase.from("synapse_execution_log").insert({
        integration_key: INTEGRATION_KEY,
        status: (summary.errors as number) > 0 ? "partial" : "success",
        affected_count: sent,
        details: { company_db: companyDb, started_at: startedAt, ...summary },
      } as any);

      await supabase
        .from("synapse_integrations")
        .update({
          last_run_at: new Date().toISOString(),
          last_run_status: (summary.errors as number) > 0 ? "partial" : "success",
          last_run_message: `${sent} notif. enviadas`,
        } as any)
        .eq("id", integ.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      overall.push({ company_db: companyDb, error: msg });
      await supabase.from("synapse_execution_log").insert({
        integration_key: INTEGRATION_KEY,
        status: "error",
        affected_count: 0,
        details: { company_db: companyDb, error: msg },
      } as any);
      await supabase
        .from("synapse_integrations")
        .update({
          last_run_at: new Date().toISOString(),
          last_run_status: "error",
          last_run_message: msg.slice(0, 200),
        } as any)
        .eq("id", integ.id);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, message: `${totalSent} notificação(ões) enviada(s)`, results: overall }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
