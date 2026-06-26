// Verifica aprovações pendentes em todas as empresas SAP e envia
// notificação via WhatsApp para o aprovador. Re-lembra a cada 24h
// se a aprovação continuar pendente.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { tryWatcherLock, releaseWatcherLock } from "../_shared/watcher-lock.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WHATSAPP_URL = "http://63.177.171.140/sender_wpp";
const WHATSAPP_TOKEN = "777a5756-d6b3-4295-a031-e5c210998766";
const FALLBACK_WHATSAPP_TO = "5531972665309";
const APPROVAL_APP_URL = "https://sap-b1-approval-hub-761741690592.us-west1.run.app/";
const HANA_VIEWS_URL =
  Deno.env.get("HANA_VIEWS_URL") ||
  "https://anagaming.app.n8n.cloud/webhook/d7c643d9-040c-4e60-aa26-99344e60e89b";

interface ApprovalRow {
  Code?: number;
  Aprovador?: string;
  "Email do aprovador"?: string;
  Solicitante?: string;
  "Tipo de solicitação"?: string;
  "Nº do documento"?: number | string;
  "Código PN/Fornecedor"?: string;
  "Fornecedor / Parceiro"?: string;
  "Código da moeda original"?: string;
  "Valor total"?: number | string;
  "Valor do documento na moeda original"?: number | string;
  "Dias em aberto"?: number;
}

interface SapUserMini {
  UserCode: string;
  eMail?: string;
  MobilePhoneNumber?: string;
}

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
  // Se vier com 10/11 dígitos sem DDI, prefixa Brasil (55)
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

async function sapLogin(baseUrl: string, user: string, pass: string, db: string) {
  const resp = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
      headers: {
        Cookie: `B1SESSION=${s.sessionId}${s.routeId ? `; B1ROUTEID=${s.routeId}` : ""}`,
      },
    });
  } catch { /* ignore */ }
}

async function sapFetchAllUsers(
  baseUrl: string,
  s: { sessionId: string; routeId: string },
): Promise<SapUserMini[]> {
  const all: SapUserMini[] = [];
  let skip = 0;
  const pageSize = 100;
  for (let page = 0; page < 50; page++) {
    const url = `${baseUrl}/Users?$select=UserCode,eMail,MobilePhoneNumber&$top=${pageSize}&$skip=${skip}`;
    const resp = await fetch(url, {
      headers: {
        Cookie: `B1SESSION=${s.sessionId}${s.routeId ? `; B1ROUTEID=${s.routeId}` : ""}`,
        Prefer: "odata.maxpagesize=" + pageSize,
      },
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
  const params = new URLSearchParams({
    SessionId: sessionId,
    DB: database,
    View: "VW_APROVACOES_DETALHADAS",
    _t: String(Date.now()),
  });
  const resp = await fetch(`${HANA_VIEWS_URL}?${params.toString()}`);
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
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  return { ok: resp.ok, status: resp.status, body: await resp.text().catch(() => "") };
}

function formatCurrency(v: number | string | undefined, currency?: string): string {
  const n = Number(v || 0);
  const cur = (currency || "BRL").trim();
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(n);
  } catch {
    return `${cur} ${n.toFixed(2)}`;
  }
}

interface CompanyResult {
  company_db: string;
  display_name: string;
  status: "ok" | "skipped" | "error";
  alerts_sent: number;
  no_phone: number;
  error?: string;
}

async function processCompany(
  sb: ReturnType<typeof createClient>,
  company: { company_db: string; display_name: string },
  creds: Record<string, string>,
): Promise<CompanyResult> {
  const result: CompanyResult = {
    company_db: company.company_db,
    display_name: company.display_name,
    status: "ok",
    alerts_sent: 0,
    no_phone: 0,
  };

  if (creds.use_hana_db === "false") {
    result.status = "skipped";
    result.error = "HANA desabilitado";
    return result;
  }
  if (!creds.username || !creds.password || !creds.service_layer_url) {
    result.status = "skipped";
    result.error = "Credenciais SAP incompletas";
    return result;
  }
  // Safety: watcher só pode autenticar com a conta de serviço "Apiuser".
  // Logar com um usuário real bloqueia a conta após poucas falhas.
  if ((creds.username || "").trim().toLowerCase() !== "apiuser") {
    result.status = "skipped";
    result.error = "Watcher desativado: usuário SAP não é Apiuser";
    return result;
  }

  const baseUrl = normalizeBaseUrl(creds.service_layer_url);
  const dbName = creds.company_db || company.company_db;

  let session: { sessionId: string; routeId: string };
  try {
    session = await sapLogin(baseUrl, creds.username, creds.password, dbName);
  } catch (e) {
    result.status = "error";
    result.error = (e as Error).message;
    return result;
  }

  try {
    const [approvals, sapUsers] = await Promise.all([
      fetchApprovals(dbName, session.sessionId),
      sapFetchAllUsers(baseUrl, session),
    ]);

    // mapas auxiliares
    const usersByEmail = new Map<string, SapUserMini>();
    const usersByCode = new Map<string, SapUserMini>();
    for (const u of sapUsers) {
      if (u.eMail) usersByEmail.set(u.eMail.toLowerCase(), u);
      if (u.UserCode) usersByCode.set(u.UserCode, u);
    }

    // override manual de telefones
    const { data: phoneRows } = await sb
      .from("user_phones")
      .select("user_code, phone")
      .eq("company_db", company.company_db);
    const manualPhones = new Map<string, string>();
    for (const r of (phoneRows || []) as { user_code: string; phone: string }[]) {
      manualPhones.set(r.user_code, r.phone);
    }

    // Considera apenas pendentes válidas (Code > 0)
    const pending = approvals.filter((a) => Number(a.Code || 0) > 0);

    for (const ap of pending) {
      const requestId = Number(ap.Code || 0);
      const email = (ap["Email do aprovador"] || "").trim().toLowerCase();
      const sapUser = email ? usersByEmail.get(email) : undefined;
      const approverCode = sapUser?.UserCode || (ap.Aprovador || "").trim();
      const phoneSrc = approverCode ? manualPhones.get(approverCode) : undefined;
      const phone = normalizePhone(phoneSrc || sapUser?.MobilePhoneNumber || "");

      if (!phone) {
        result.no_phone++;
        continue;
      }

      // Dedup 1: já enviado nas últimas 24h para esse approval_request_id?
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await sb
        .from("whatsapp_approval_alerts")
        .select("id")
        .eq("company_db", company.company_db)
        .eq("approval_request_id", requestId)
        .gte("sent_at", since)
        .limit(1)
        .maybeSingle();
      if (recent) continue;

      // Dedup 2: mesmo (company_db, approver_code, docNum) nas últimas 24h?
      // Evita múltiplas mensagens para o mesmo aprovador quando a view retorna
      // várias linhas (uma por estágio/aprovador) para o mesmo documento.
      const docNumDedup = String(ap["Nº do documento"] ?? "").trim();
      if (approverCode && docNumDedup) {
        const { data: recentDoc } = await sb
          .from("whatsapp_approval_alerts")
          .select("id")
          .eq("company_db", company.company_db)
          .eq("approver_code", approverCode)
          .eq("payload->>docNum", docNumDedup)
          .gte("sent_at", since)
          .limit(1)
          .maybeSingle();
        if (recentDoc) continue;
      }

      const moedaOriginal = (ap["Código da moeda original"] || "BRL").trim().toUpperCase();
      const valorOriginal = Number(ap["Valor do documento na moeda original"] || 0);
      const valorBRL = Number(ap["Valor total"] || 0);
      const valor =
        moedaOriginal && moedaOriginal !== "BRL" && valorOriginal > 0
          ? `${formatCurrency(valorOriginal, moedaOriginal)} → ${formatCurrency(valorBRL, "BRL")}`
          : formatCurrency(valorBRL, "BRL");
      const docNum = ap["Nº do documento"] || "—";
      const tipo = ap["Tipo de solicitação"] || "Documento";
      const fornecedor = ap["Fornecedor / Parceiro"] || "—";
      const solicitante = ap.Solicitante || "—";
      const dias = ap["Dias em aberto"] ?? "—";

      const msg =
        `🔔 Aprovação Pendente\n` +
        `Empresa: ${company.display_name}\n` +
        `Documento: ${tipo} #${docNum}\n` +
        `Fornecedor: ${fornecedor}\n` +
        `Solicitante: ${solicitante}\n` +
        `Valor: ${valor}\n` +
        `Dias em aberto: ${dias}\n\n` +
        `Abrir aplicativo de aprovação:\n${APPROVAL_APP_URL}`;

      const sent = await sendWhatsApp(phone, msg);
      if (!sent.ok) {
        console.error("WhatsApp falhou:", sent.status, sent.body);
        continue;
      }

      await sb.from("whatsapp_approval_alerts").insert({
        company_db: company.company_db,
        approval_request_id: requestId,
        approver_code: approverCode || "—",
        whatsapp_to: phone,
        payload: {
          docNum,
          tipo,
          fornecedor,
          solicitante,
          valor,
          valor_original: valorOriginal,
          valor_brl: valorBRL,
          moeda_original: moedaOriginal,
          dias,
          approver_email: email,
          link: APPROVAL_APP_URL,
        },
      });
      result.alerts_sent++;
    }
  } catch (e) {
    result.status = "error";
    result.error = (e as Error).message;
  } finally {
    await sapLogout(baseUrl, session);
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: companies, error: cErr } = await sb
      .from("companies")
      .select("company_db, display_name, erp_type, is_active")
      .eq("is_active", true)
      .eq("erp_type", "sap")
      .not("company_db", "ilike", "SBO_TESTE_%");
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

    const results: CompanyResult[] = [];
    for (const co of companies || []) {
      const creds = credByCompany.get(co.company_db) || {};
      try {
        results.push(await processCompany(sb, co, creds));
      } catch (e) {
        results.push({
          company_db: co.company_db,
          display_name: co.display_name,
          status: "error",
          alerts_sent: 0,
          no_phone: 0,
          error: (e as Error).message,
        });
      }
    }

    const totalAlerts = results.reduce((s, r) => s + r.alerts_sent, 0);
    const fallback = FALLBACK_WHATSAPP_TO; // não usado, apenas evita warning de unused
    void fallback;
    const hasError = results.some((r) => r.status === "error");
    await sb.from("notification_send_runs").insert({
      function_name: "whatsapp-approval-watcher",
      status: hasError ? (totalAlerts > 0 ? "partial" : "error") : "success",
      recipients_count: totalAlerts,
      error_message: hasError ? results.filter((r) => r.error).map((r) => `${r.company_db}: ${r.error}`).join(" | ") : null,
      details: { results },
    });
    return new Response(
      JSON.stringify({ ok: true, total_alerts: totalAlerts, results }, null, 2),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("Approval watcher error:", e);
    try {
      await sb.from("notification_send_runs").insert({
        function_name: "whatsapp-approval-watcher",
        status: "error",
        recipients_count: 0,
        error_message: (e as Error).message,
        details: {},
      });
    } catch { /* ignore */ }
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
