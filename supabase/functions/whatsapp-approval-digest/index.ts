// Envia um digest consolidado (a cada 4h) das aprovações pendentes por aprovador,
// via WhatsApp. Processa todas as empresas SAP ativas (não-teste).
// Inclui empresa, link do erp-flow e a descrição de cada pendência.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { generateDynamicToken } from "../_shared/sap-middleware-token.ts";
import { tryWatcherLock, releaseWatcherLock } from "../_shared/watcher-lock.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WHATSAPP_URL = "http://63.177.171.140/sender_wpp";
const WHATSAPP_TOKEN = "777a5756-d6b3-4295-a031-e5c210998766";
const ERP_FLOW_URL = "https://erp-flow.cactuscorporation.com";
const HANA_VIEWS_URL =
  Deno.env.get("HANA_VIEWS_URL") ||
  "https://anagaming.app.n8n.cloud/webhook/d7c643d9-040c-4e60-aa26-99344e60e89b";

// Janela para dedupe do digest.
const DIGEST_WINDOW_HOURS = 4;
// Marcador usado em approval_request_id para diferenciar digest de alertas por doc.
const DIGEST_MARKER_ID = 0;

interface ApprovalRow {
  Code?: number;
  Aprovador?: string;
  "Email do aprovador"?: string;
  Solicitante?: string;
  "Tipo de solicitação"?: string;
  "Nº do documento"?: number | string;
  "Fornecedor / Parceiro"?: string;
  "Código da moeda original"?: string;
  "Valor total"?: number | string;
  "Valor do documento na moeda original"?: number | string;
  "Dias em aberto"?: number;
}

interface SapUserMini { UserCode: string; eMail?: string; MobilePhoneNumber?: string }

function normalizeBaseUrl(url: string): string {
  let u = url.replace(/\/+$/, "");
  if (u.includes("/b1s/v1")) u = u.replace("/b1s/v1", "/b1s/v2");
  else if (!u.includes("/b1s/v2")) u = `${u}/b1s/v2`;
  return u;
}

function normalizePhone(p?: string | null): string {
  if (!p) return "";
  const digits = p.replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function formatCurrency(v: number | string | undefined, currency?: string): string {
  const n = Number(v || 0);
  const cur = (currency || "BRL").trim();
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(n); }
  catch { return `${cur} ${n.toFixed(2)}`; }
}

async function sapLogin(baseUrl: string, user: string, pass: string, db: string) {
  const resp = await fetch(`${baseUrl}/Login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: user, Password: pass, CompanyDB: db }),
  });
  if (!resp.ok) throw new Error(`Login SAP falhou: ${resp.status} ${await resp.text()}`);
  const json = await resp.json();
  const cookies = resp.headers.get("set-cookie") || "";
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
async function sapFetchAllUsers(baseUrl: string, s: { sessionId: string; routeId: string }) {
  const all: SapUserMini[] = [];
  let skip = 0; const pageSize = 100;
  for (let page = 0; page < 50; page++) {
    const url = `${baseUrl}/Users?$select=UserCode,eMail,MobilePhoneNumber&$top=${pageSize}&$skip=${skip}`;
    const resp = await fetch(url, {
      headers: { Cookie: `B1SESSION=${s.sessionId}${s.routeId ? `; B1ROUTEID=${s.routeId}` : ""}`, Prefer: `odata.maxpagesize=${pageSize}` },
    });
    if (!resp.ok) break;
    const json = await resp.json().catch(() => null);
    const rows: SapUserMini[] = json?.value || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    skip += pageSize;
  }
  return all;
}
async function fetchApprovals(database: string, sessionId: string): Promise<ApprovalRow[]> {
  const dynamicToken = await generateDynamicToken();
  const view = "VW_APROVACOES_DETALHADAS";
  const params = new URLSearchParams({ SessionId: sessionId, DB: database, View: view, DynamicToken: dynamicToken, _t: String(Date.now()) });
  const resp = await fetch(`${HANA_VIEWS_URL}?${params.toString()}`, {
    headers: { "X-SessionId": sessionId, "X-DB": database, "X-View": view, "X-Dynamic-Token": dynamicToken },
  });
  if (!resp.ok) throw new Error(`HANA view falhou: ${resp.status}`);
  const text = await resp.text();
  if (!text) return [];
  const payload = JSON.parse(text);
  if (Array.isArray(payload)) {
    const wrapped = payload.find((it) => it && typeof it === "object" && Array.isArray(it.data));
    if (wrapped) return wrapped.data as ApprovalRow[];
    return payload as ApprovalRow[];
  }
  if (payload && Array.isArray(payload.data)) return payload.data as ApprovalRow[];
  return [];
}

async function sendWhatsApp(to: string, message: string) {
  const body = new URLSearchParams({ to, message });
  const resp = await fetch(WHATSAPP_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return { ok: resp.ok, status: resp.status, body: await resp.text().catch(() => "") };
}

interface CompanyDigestResult {
  company_db: string;
  display_name: string;
  status: "ok" | "skipped" | "error";
  digests_sent: number;
  approvers_no_phone: number;
  total_pending: number;
  error?: string;
}

async function processCompany(
  sb: ReturnType<typeof createClient>,
  company: { company_db: string; display_name: string },
  creds: Record<string, string>,
): Promise<CompanyDigestResult> {
  const result: CompanyDigestResult = {
    company_db: company.company_db, display_name: company.display_name,
    status: "ok", digests_sent: 0, approvers_no_phone: 0, total_pending: 0,
  };
  if (creds.use_hana_db === "false") { result.status = "skipped"; result.error = "HANA desabilitado"; return result; }
  if (!creds.username || !creds.password || !creds.service_layer_url) {
    result.status = "skipped"; result.error = "Credenciais SAP incompletas"; return result;
  }
  if ((creds.username || "").trim().toLowerCase() !== "apiuser") {
    result.status = "skipped"; result.error = "Digest desativado: usuário SAP não é Apiuser"; return result;
  }

  const baseUrl = normalizeBaseUrl(creds.service_layer_url);
  const dbName = creds.company_db || company.company_db;
  let session: { sessionId: string; routeId: string };
  try { session = await sapLogin(baseUrl, creds.username, creds.password, dbName); }
  catch (e) { result.status = "error"; result.error = (e as Error).message; return result; }

  try {
    const [approvals, sapUsers] = await Promise.all([
      fetchApprovals(dbName, session.sessionId),
      sapFetchAllUsers(baseUrl, session),
    ]);

    const usersByEmail = new Map<string, SapUserMini>();
    const usersByCode = new Map<string, SapUserMini>();
    for (const u of sapUsers) {
      if (u.eMail) usersByEmail.set(u.eMail.toLowerCase(), u);
      if (u.UserCode) usersByCode.set(u.UserCode, u);
    }

    const { data: phoneRows } = await sb
      .from("user_phones").select("user_code, phone")
      .eq("company_db", company.company_db);
    const manualPhones = new Map<string, string>();
    for (const r of (phoneRows || []) as { user_code: string; phone: string }[]) {
      manualPhones.set(r.user_code, r.phone);
    }

    const pending = approvals.filter((a) => Number(a.Code || 0) > 0);
    result.total_pending = pending.length;

    // Agrupa por aprovador (approverCode)
    const byApprover = new Map<string, { email: string; rows: ApprovalRow[] }>();
    for (const ap of pending) {
      const email = (ap["Email do aprovador"] || "").trim().toLowerCase();
      const sapUser = email ? usersByEmail.get(email) : undefined;
      const approverCode = (sapUser?.UserCode || (ap.Aprovador || "").trim()) || "—";
      if (!byApprover.has(approverCode)) byApprover.set(approverCode, { email, rows: [] });
      byApprover.get(approverCode)!.rows.push(ap);
    }

    const since = new Date(Date.now() - DIGEST_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    for (const [approverCode, info] of byApprover) {
      const sapUser = info.email ? usersByEmail.get(info.email) : usersByCode.get(approverCode);
      const phoneSrc = manualPhones.get(approverCode);
      const phone = normalizePhone(phoneSrc || sapUser?.MobilePhoneNumber || "");
      if (!phone) { result.approvers_no_phone++; continue; }

      // Dedup: já enviamos digest nas últimas 4h para esse aprovador?
      const { data: recent } = await sb
        .from("whatsapp_approval_alerts")
        .select("id")
        .eq("company_db", company.company_db)
        .eq("approver_code", approverCode)
        .eq("approval_request_id", DIGEST_MARKER_ID)
        .gte("sent_at", since)
        .limit(1)
        .maybeSingle();
      if (recent) continue;

      // Monta mensagem consolidada
      const lines: string[] = [];
      lines.push(`🔔 *Aprovações pendentes — ${company.display_name}*`);
      lines.push(`Você tem *${info.rows.length}* pendência(s):`);
      lines.push("");
      const MAX_ITEMS = 15;
      const shown = info.rows.slice(0, MAX_ITEMS);
      for (const ap of shown) {
        const moedaOriginal = (ap["Código da moeda original"] || "BRL").trim().toUpperCase();
        const valorOriginal = Number(ap["Valor do documento na moeda original"] || 0);
        const valorBRL = Number(ap["Valor total"] || 0);
        const valor = moedaOriginal !== "BRL" && valorOriginal > 0
          ? `${formatCurrency(valorOriginal, moedaOriginal)} → ${formatCurrency(valorBRL, "BRL")}`
          : formatCurrency(valorBRL, "BRL");
        const tipo = ap["Tipo de solicitação"] || "Documento";
        const docNum = ap["Nº do documento"] ?? "—";
        const fornecedor = ap["Fornecedor / Parceiro"] || "—";
        const solicitante = ap.Solicitante || "—";
        const dias = ap["Dias em aberto"] ?? "—";
        lines.push(`• *${tipo} #${docNum}* — ${fornecedor}`);
        lines.push(`  Solicitante: ${solicitante} | Valor: ${valor} | ${dias} dia(s)`);
      }
      if (info.rows.length > MAX_ITEMS) {
        lines.push("");
        lines.push(`… e mais ${info.rows.length - MAX_ITEMS} pendência(s).`);
      }
      lines.push("");
      lines.push(`Acesse: ${ERP_FLOW_URL}/aprovacoes`);

      const msg = lines.join("\n");
      const sent = await sendWhatsApp(phone, msg);
      if (!sent.ok) { console.error("WhatsApp digest falhou:", sent.status, sent.body); continue; }

      await sb.from("whatsapp_approval_alerts").insert({
        company_db: company.company_db,
        approval_request_id: DIGEST_MARKER_ID,
        approver_code: approverCode,
        whatsapp_to: phone,
        payload: {
          kind: "digest",
          window_hours: DIGEST_WINDOW_HOURS,
          approver_email: info.email,
          pending_count: info.rows.length,
          doc_numbers: info.rows.map((r) => r["Nº do documento"]),
          link: `${ERP_FLOW_URL}/aprovacoes`,
        },
      });
      result.digests_sent++;
    }
  } catch (e) {
    result.status = "error"; result.error = (e as Error).message;
  } finally {
    await sapLogout(baseUrl, session);
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const gotLock = await tryWatcherLock(sb, "whatsapp-approval-digest", 20);
    if (!gotLock) {
      return new Response(JSON.stringify({ ok: true, skipped: "another_run_in_progress" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: companies, error: cErr } = await sb
      .from("companies")
      .select("company_db, display_name, erp_type, is_active, is_test")
      .eq("is_active", true).eq("erp_type", "sap")
      .eq("is_test", false);
    if (cErr) throw cErr;


    const dbs = (companies || []).map((c) => c.company_db);
    const { data: credRows } = await sb
      .from("system_credentials")
      .select("company_db, credential_key, credential_value")
      .eq("system_name", "sap")
      .in("company_db", dbs.length ? dbs : [""]);
    const credByCompany = new Map<string, Record<string, string>>();
    for (const row of credRows || []) {
      if (!row.company_db) continue;
      if (!credByCompany.has(row.company_db)) credByCompany.set(row.company_db, {});
      credByCompany.get(row.company_db)![row.credential_key] = row.credential_value;
    }

    const results: CompanyDigestResult[] = [];
    for (const co of companies || []) {
      const creds = credByCompany.get(co.company_db) || {};
      try { results.push(await processCompany(sb, co, creds)); }
      catch (e) {
        results.push({ company_db: co.company_db, display_name: co.display_name, status: "error", digests_sent: 0, approvers_no_phone: 0, total_pending: 0, error: (e as Error).message });
      }
    }

    const totalDigests = results.reduce((s, r) => s + r.digests_sent, 0);
    const hasError = results.some((r) => r.status === "error");
    await sb.from("notification_send_runs").insert({
      function_name: "whatsapp-approval-digest",
      status: hasError ? (totalDigests > 0 ? "partial" : "error") : "success",
      recipients_count: totalDigests,
      error_message: hasError ? results.filter((r) => r.error).map((r) => `${r.company_db}: ${r.error}`).join(" | ") : null,
      details: { results },
    });
    await releaseWatcherLock(sb, "whatsapp-approval-digest", hasError ? "error" : "ok", `digests=${totalDigests}`);

    return new Response(JSON.stringify({ ok: true, total_digests: totalDigests, results }, null, 2),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Approval digest error:", e);
    try {
      await sb.from("notification_send_runs").insert({
        function_name: "whatsapp-approval-digest",
        status: "error", recipients_count: 0, error_message: (e as Error).message, details: {},
      });
    } catch { /* ignore */ }
    await releaseWatcherLock(sb, "whatsapp-approval-digest", "error", (e as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
