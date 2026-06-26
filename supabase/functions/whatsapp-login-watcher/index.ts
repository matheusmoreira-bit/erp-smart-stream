// Verifica falhas de login consecutivas em todas as empresas SAP
// e dispara notificação via WhatsApp quando detecta 2 falhas seguidas
// (sem login bem sucedido entre elas) nas últimas 6 horas.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { tryWatcherLock, releaseWatcherLock } from "../_shared/watcher-lock.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Credenciais fixas (conforme solicitado)
const WHATSAPP_URL = "http://63.177.171.140/sender_wpp";
const WHATSAPP_TOKEN = "777a5756-d6b3-4295-a031-e5c210998766";
const WHATSAPP_TO = "5531972665309";
const HANA_VIEWS_URL =
  Deno.env.get("HANA_VIEWS_URL") ||
  "https://anagaming.app.n8n.cloud/webhook/d7c643d9-040c-4e60-aa26-99344e60e89b";

interface Usr5 {
  UserCode: string;
  Action: string;
  Date: string; // 'YYYY-MM-DD' or 'YYYYMMDD'
  Time: number; // HHMM (e.g. 1435)
  SessionID: number;
}

function normalizeBaseUrl(url: string): string {
  let u = url.replace(/\/+$/, "");
  if (u.includes("/b1s/v1")) u = u.replace("/b1s/v1", "/b1s/v2");
  else if (!u.includes("/b1s/v2")) u = `${u}/b1s/v2`;
  return u;
}

function isFailure(r: Usr5): boolean {
  if (r.Action === "F" || r.Action === "K") return true;
  if ((r.Action === "I" || r.Action === "W") && Number(r.SessionID) < 0) return true;
  return false;
}

function tsKey(r: Usr5): string {
  const d = (r.Date || "").replace(/-/g, "");
  return `${d}-${String(r.Time).padStart(4, "0")}`;
}

function tsToDate(r: Usr5): Date | null {
  const d = (r.Date || "").replace(/-/g, "");
  if (d.length !== 8) return null;
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(4, 6)) - 1;
  const day = Number(d.slice(6, 8));
  const t = String(r.Time ?? 0).padStart(4, "0");
  const hh = Number(t.slice(0, 2));
  const mm = Number(t.slice(2, 4));
  return new Date(Date.UTC(y, m, day, hh, mm));
}

async function sapLogin(baseUrl: string, user: string, pass: string, db: string) {
  const resp = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: user, Password: pass, CompanyDB: db }),
  });
  if (!resp.ok) throw new Error(`Login SAP falhou: ${resp.status} ${await resp.text()}`);
  const json = await resp.json();
  // SessionId vem do body; routeId do cookie B1ROUTEID
  const cookies = resp.headers.get("set-cookie") || "";
  const routeMatch = cookies.match(/B1ROUTEID=([^;]+)/);
  return {
    sessionId: json.SessionId as string,
    routeId: routeMatch?.[1] ?? "",
  };
}

async function fetchUsr5(database: string, sessionId: string): Promise<Usr5[]> {
  const params = new URLSearchParams({
    SessionId: sessionId,
    DB: database,
    Table: "USR5",
    _t: String(Date.now()),
  });
  const resp = await fetch(`${HANA_VIEWS_URL}?${params.toString()}`, { method: "GET" });
  if (!resp.ok) throw new Error(`HANA view falhou: ${resp.status}`);
  const text = await resp.text();
  if (!text) return [];
  const payload = JSON.parse(text);
  // Formato: pode vir como [{data:[...]}], {data:[...]} ou array direto
  if (Array.isArray(payload)) {
    const wrapped = payload.find((it) => it && typeof it === "object" && Array.isArray(it.data));
    if (wrapped) return wrapped.data as Usr5[];
    return payload as Usr5[];
  }
  if (payload && Array.isArray(payload.data)) return payload.data as Usr5[];
  return [];
}

async function sendWhatsApp(message: string) {
  const body = new URLSearchParams({ to: WHATSAPP_TO, message });
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

interface CompanyResult {
  company_db: string;
  display_name: string;
  status: "ok" | "skipped" | "error";
  alerts_sent: number;
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
    const records = await fetchUsr5(dbName, session.sessionId);
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000);

    // Filtra ações relevantes e ordena por usuário e timestamp
    const relevant = records
      .filter((r) => ["I", "W", "F", "K"].includes(r.Action))
      .filter((r) => {
        const d = tsToDate(r);
        return d !== null && d >= since;
      })
      .sort((a, b) => {
        if (a.UserCode !== b.UserCode) return a.UserCode.localeCompare(b.UserCode);
        const ka = tsKey(a);
        const kb = tsKey(b);
        return ka.localeCompare(kb);
      });

    // Detecta pares de falhas consecutivas (sem sucesso entre elas)
    const incidents: Array<{ user: string; failureKey: string; whenIso: string }> = [];
    let currentUser = "";
    let lastWasFail = false;
    let lastFail: Usr5 | null = null;

    for (const r of relevant) {
      if (r.UserCode !== currentUser) {
        currentUser = r.UserCode;
        lastWasFail = false;
        lastFail = null;
      }
      if (isFailure(r)) {
        if (lastWasFail && lastFail) {
          // Segunda falha consecutiva — registrar incidente
          incidents.push({
            user: r.UserCode,
            failureKey: tsKey(r),
            whenIso: tsToDate(r)?.toISOString() ?? "",
          });
          // Reset para que 3 falhas gerem só 1 alerta no par; a 4ª gerará outro
          lastWasFail = false;
          lastFail = null;
        } else {
          lastWasFail = true;
          lastFail = r;
        }
      } else {
        lastWasFail = false;
        lastFail = null;
      }
    }

    // Para cada incidente, tenta inserir no dedup; se inseriu, envia WhatsApp
    for (const inc of incidents) {
      const { data: inserted, error: insErr } = await sb
        .from("whatsapp_login_alerts")
        .insert({
          company_db: company.company_db,
          user_code: inc.user,
          failure_key: inc.failureKey,
          whatsapp_to: WHATSAPP_TO,
          payload: { when: inc.whenIso, display_name: company.display_name },
        })
        .select("id")
        .maybeSingle();

      if (insErr) {
        // Conflito = já notificado, segue
        if (!String(insErr.message || "").toLowerCase().includes("duplicate")) {
          console.error("Insert dedup error:", insErr);
        }
        continue;
      }
      if (!inserted) continue;

      const msg = `⚠️ Alerta de Login\nEmpresa: ${company.display_name} (${company.company_db})\nUsuário: ${inc.user}\nDetectadas 2 falhas consecutivas de login.\nÚltima tentativa: ${inc.whenIso}`;
      const sent = await sendWhatsApp(msg);
      if (!sent.ok) {
        console.error("WhatsApp falhou:", sent.status, sent.body);
      } else {
        result.alerts_sent++;
      }
    }
  } catch (e) {
    result.status = "error";
    result.error = (e as Error).message;
  } finally {
    // Logout best-effort
    try {
      await fetch(`${baseUrl}/Logout`, {
        method: "POST",
        headers: {
          Cookie: `B1SESSION=${session.sessionId}${session.routeId ? `; B1ROUTEID=${session.routeId}` : ""}`,
        },
      });
    } catch { /* ignore */ }
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
    // Empresas ativas SAP
    const { data: companies, error: cErr } = await sb
      .from("companies")
      .select("company_db, display_name, erp_type, is_active")
      .eq("is_active", true)
      .eq("erp_type", "sap");

    if (cErr) throw cErr;

    // Carrega todas credenciais SAP em uma query
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
          error: (e as Error).message,
        });
      }
    }

    const totalAlerts = results.reduce((s, r) => s + r.alerts_sent, 0);
    const hasError = results.some((r) => r.status === "error");
    await sb.from("notification_send_runs").insert({
      function_name: "whatsapp-login-watcher",
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
    console.error("Watcher error:", e);
    try {
      await sb.from("notification_send_runs").insert({
        function_name: "whatsapp-login-watcher",
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
