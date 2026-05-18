// Detecta usuários SAP com licença PRO/CRM que ficaram >15 dias sem login
// e envia alerta via WhatsApp + e-mail. Re-alerta uma vez por semana ISO.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WHATSAPP_URL = "http://63.177.171.140/sender_wpp";
const WHATSAPP_TOKEN = "777a5756-d6b3-4295-a031-e5c210998766";
const WHATSAPP_TO = "5531972665309";
const EMAIL_TO = "matheus.moreira@anagaming.com.br";
const IDLE_DAYS = 15;
const HANA_VIEWS_URL =
  Deno.env.get("HANA_VIEWS_URL") ||
  "https://anagaming.app.n8n.cloud/webhook/d7c643d9-040c-4e60-aa26-99344e60e89b";

interface Usr5 {
  UserCode: string;
  Action: string;
  Date: string;
  Time: number;
  SessionID: number;
  AliveDurtn?: number;
}

function normalizeBaseUrl(url: string): string {
  let u = url.replace(/\/+$/, "");
  if (u.includes("/b1s/v1")) u = u.replace("/b1s/v1", "/b1s/v2");
  else if (!u.includes("/b1s/v2")) u = `${u}/b1s/v2`;
  return u;
}

function pickField<T = unknown>(row: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k] as T;
    const upper = k.toUpperCase();
    if (row[upper] !== undefined && row[upper] !== null && row[upper] !== "") return row[upper] as T;
    const lower = k.toLowerCase();
    if (row[lower] !== undefined && row[lower] !== null && row[lower] !== "") return row[lower] as T;
  }
  return undefined;
}

function normalizeUsr5(r: Record<string, unknown>): Usr5 {
  return {
    UserCode: String(pickField<string>(r, "UserCode", "USER_CODE", "USERCODE", "user_code") ?? "").trim(),
    Action: String(pickField<string>(r, "Action", "ACTION") ?? "").trim(),
    Date: String(pickField<string>(r, "Date", "DATE") ?? "").trim(),
    Time: Number(pickField(r, "Time", "TIME") ?? 0),
    SessionID: Number(pickField(r, "SessionID", "SESSIONID", "Session_ID") ?? 0),
  };
}

function tsToDate(r: Usr5): Date | null {
  const d = (r.Date || "").replace(/-/g, "");
  if (d.length !== 8) return null;
  const t = String(r.Time ?? 0).padStart(4, "0");
  return new Date(Date.UTC(
    Number(d.slice(0, 4)),
    Number(d.slice(4, 6)) - 1,
    Number(d.slice(6, 8)),
    Number(t.slice(0, 2)),
    Number(t.slice(2, 4)),
  ));
}

function isSuccessfulLogin(r: Usr5): boolean {
  return (r.Action === "I" || r.Action === "W") && Number(r.SessionID) >= 0;
}

async function fetchSapUsersFresh(baseUrl: string, session: { sessionId: string; routeId: string }): Promise<Array<{ UserCode: string; UserName?: string; Locked?: string }>> {
  const cookie = `B1SESSION=${session.sessionId}${session.routeId ? `; B1ROUTEID=${session.routeId}` : ""}`;
  const all: Array<{ UserCode: string; UserName?: string; Locked?: string }> = [];
  let next: string | null = `${baseUrl}/Users?$select=UserCode,UserName,Locked&$top=200`;
  while (next) {
    const resp = await fetch(next, { headers: { Cookie: cookie, Prefer: "odata.maxpagesize=200" } });
    if (!resp.ok) throw new Error(`Service Layer Users falhou: ${resp.status}`);
    const json = await resp.json();
    for (const u of json.value || []) all.push(u);
    if (json["odata.nextLink"]) {
      next = `${baseUrl}/${json["odata.nextLink"]}`;
    } else {
      next = null;
    }
  }
  return all;
}

async function refreshUsersCache(sb: ReturnType<typeof createClient>, companyDb: string, users: Array<{ UserCode: string; UserName?: string; Locked?: string }>) {
  if (users.length === 0) return;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await sb.from("sap_cache").upsert(
    { cache_key: "users", company_db: companyDb, data: users as unknown, expires_at: expiresAt, updated_at: new Date().toISOString() },
    { onConflict: "cache_key,company_db" },
  );
}

function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
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

async function fetchHanaTable<T = unknown>(database: string, sessionId: string, table: string): Promise<T[]> {
  const params = new URLSearchParams({
    SessionId: sessionId, DB: database, Table: table, _t: String(Date.now()),
  });
  const resp = await fetch(`${HANA_VIEWS_URL}?${params}`, { method: "GET" });
  if (!resp.ok) throw new Error(`HANA falhou (${table}): ${resp.status}`);
  const text = await resp.text();
  if (!text) return [];
  const payload = JSON.parse(text);
  if (Array.isArray(payload)) {
    const wrapped = payload.find((it) => it && Array.isArray(it.data));
    if (wrapped) return wrapped.data as T[];
    return payload as T[];
  }
  if (payload && Array.isArray(payload.data)) return payload.data as T[];
  return [];
}

const fetchUsr5 = (db: string, sid: string) => fetchHanaTable<Usr5>(db, sid, "USR5");

interface OusrRow {
  USER_CODE?: string;
  UserCode?: string;
  USERID?: string;
  LastLoginDate?: string | null;
  LASTLOGINDATE?: string | null;
  LastLoginTime?: number | string | null;
  LASTLOGINTIME?: number | string | null;
}

function parseOusrLastLogin(r: OusrRow): { code: string; date: Date | null } {
  const code = String(r.USER_CODE ?? r.UserCode ?? r.USERID ?? "").trim();
  const dRaw = r.LastLoginDate ?? r.LASTLOGINDATE ?? null;
  if (!code || !dRaw) return { code, date: null };
  const ds = String(dRaw).slice(0, 10).replace(/-/g, "");
  if (ds.length !== 8) return { code, date: null };
  const tRaw = r.LastLoginTime ?? r.LASTLOGINTIME ?? 0;
  const t = String(tRaw ?? 0).padStart(4, "0");
  return {
    code,
    date: new Date(Date.UTC(
      Number(ds.slice(0, 4)),
      Number(ds.slice(4, 6)) - 1,
      Number(ds.slice(6, 8)),
      Number(t.slice(0, 2)) || 0,
      Number(t.slice(2, 4)) || 0,
    )),
  };
}

async function sendWhatsApp(message: string) {
  try {
    const body = new URLSearchParams({ to: WHATSAPP_TO, message });
    const resp = await fetch(WHATSAPP_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    return resp.ok;
  } catch (e) {
    console.error("whatsapp err:", e);
    return false;
  }
}

async function sendEmail(subject: string, html: string) {
  try {
    const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-smtp-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ to: EMAIL_TO, subject, html }),
    });
    return resp.ok;
  } catch (e) {
    console.error("email err:", e);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = new URL(req.url);
  const isAsync = url.searchParams.get("async") === "1";
  const forceWeek = url.searchParams.get("force") === "1";

  const work = async () => {
    try {
    const { data: companies } = await sb
      .from("companies")
      .select("company_db, display_name")
      .eq("is_active", true)
      .eq("erp_type", "sap");

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

    const weekKey = isoWeekKey(new Date());
    const cutoff = Date.now() - IDLE_DAYS * 86400000;
    const allIdle: Array<{ company_db: string; display_name: string; user_code: string; user_name: string; license_type: string; days_idle: number; last_login: string | null }> = [];

    for (const co of companies || []) {
      const creds = credByCompany.get(co.company_db) || {};
      if (creds.use_hana_db === "false" || !creds.username || !creds.password || !creds.service_layer_url) continue;

      const baseUrl = normalizeBaseUrl(creds.service_layer_url);
      const dbName = creds.company_db || co.company_db;

      let session;
      try { session = await sapLogin(baseUrl, creds.username, creds.password, dbName); }
      catch (e) { console.error(`SAP login ${co.company_db}:`, (e as Error).message); continue; }

      try {
        // 1. Limpa cache de usuários e recarrega lista fresca via Service Layer
        let freshUsers: Array<{ UserCode: string; UserName?: string; Locked?: string }> = [];
        try {
          await sb.from("sap_cache").delete().eq("cache_key", "users").eq("company_db", co.company_db);
          freshUsers = await fetchSapUsersFresh(baseUrl, session);
          await refreshUsersCache(sb, co.company_db, freshUsers);
        } catch (e) {
          console.warn(`Refresh users ${co.company_db} falhou, prosseguindo com user_licenses:`, (e as Error).message);
        }
        const validUserCodes = new Set(freshUsers.map((u) => String(u.UserCode || "").toLowerCase()).filter(Boolean));
        const lockedSet = new Set(
          freshUsers.filter((u) => u.Locked === "tYES" || u.Locked === "Y").map((u) => String(u.UserCode).toLowerCase()),
        );

        // 2. Carrega USR5 (normalizado para tolerar variações de campos)
        const rawRecords = await fetchHanaTable<Record<string, unknown>>(dbName, session.sessionId, "USR5");
        const records = rawRecords.map(normalizeUsr5).filter((r) => r.UserCode);
        const lastLoginByUser = new Map<string, Date>();
        for (const r of records) {
          if (!isSuccessfulLogin(r)) continue;
          const d = tsToDate(r);
          if (!d) continue;
          const key = r.UserCode.toLowerCase();
          const cur = lastLoginByUser.get(key);
          if (!cur || d > cur) lastLoginByUser.set(key, d);
        }

        // 3. Reforça com OUSR.LastLoginDate (USR5 pode estar truncado por retenção)
        try {
          const ousr = await fetchHanaTable<OusrRow>(dbName, session.sessionId, "OUSR");
          for (const row of ousr) {
            const { code, date } = parseOusrLastLogin(row);
            if (!code || !date) continue;
            const key = code.toLowerCase();
            const cur = lastLoginByUser.get(key);
            if (!cur || date > cur) lastLoginByUser.set(key, date);
          }
        } catch (e) {
          console.warn(`OUSR fetch falhou ${co.company_db}:`, (e as Error).message);
        }

        const { data: licenses } = await sb
          .from("user_licenses")
          .select("user_code, user_name, license_type, has_license, is_locked, company_db")
          .eq("company_db", co.company_db)
          .eq("has_license", true)
          .in("license_type", ["PRO", "CRM"]);

        for (const lic of licenses || []) {
          const codeKey = lic.user_code.toLowerCase();
          // Pula se travado (no licenças ou em SAP fresco)
          if (lic.is_locked || lockedSet.has(codeKey)) continue;
          // Pula se usuário não existe mais no SAP (evita falso "nunca logou")
          if (validUserCodes.size > 0 && !validUserCodes.has(codeKey)) continue;
          const last = lastLoginByUser.get(codeKey);
          const lastTs = last ? last.getTime() : 0;
          if (lastTs > cutoff) continue;
          // Sem dado de login confiável (USR5+OUSR vazios): não dispara alerta "nunca logou"
          if (!last && lastLoginByUser.size === 0) continue;
          const daysIdle = last ? Math.floor((Date.now() - lastTs) / 86400000) : 9999;
          allIdle.push({
            company_db: co.company_db,
            display_name: co.display_name,
            user_code: lic.user_code,
            user_name: lic.user_name || lic.user_code,
            license_type: lic.license_type!,
            days_idle: daysIdle,
            last_login: last ? last.toISOString() : null,
          });
        }

      } catch (e) {
        console.error(`fetchUsr5 ${co.company_db}:`, (e as Error).message);
      } finally {
        try {
          await fetch(`${baseUrl}/Logout`, {
            method: "POST",
            headers: { Cookie: `B1SESSION=${session!.sessionId}${session!.routeId ? `; B1ROUTEID=${session!.routeId}` : ""}` },
          });
        } catch { /* ignore */ }
      }
    }

    // Dedup + envio
    let sentCount = 0;
    const sentByCompany = new Map<string, typeof allIdle>();
    for (const u of allIdle) {
      const { data: inserted, error } = await sb
        .from("license_idle_alerts")
        .insert({
          company_db: u.company_db,
          user_code: u.user_code,
          alert_week: weekKey,
          license_type: u.license_type,
          days_idle: u.days_idle,
          whatsapp_to: WHATSAPP_TO,
          email_to: EMAIL_TO,
          payload: u as unknown as Record<string, unknown>,
        })
        .select("id")
        .maybeSingle();
      if (error || !inserted) continue;
      sentCount++;
      if (!sentByCompany.has(u.company_db)) sentByCompany.set(u.company_db, []);
      sentByCompany.get(u.company_db)!.push(u);
    }

    // Envia 1 mensagem agregada por empresa
    for (const [companyDb, list] of sentByCompany) {
      const display = list[0].display_name;
      const lines = list
        .sort((a, b) => b.days_idle - a.days_idle)
        .map((u) => `• ${u.user_name} (${u.user_code}) — ${u.license_type} — ${u.days_idle === 9999 ? "nunca logou" : `${u.days_idle} dias`}`);
      const msg = `🪪 Licenças ociosas — ${display}\n${list.length} usuário(s) com licença PRO/CRM sem login há mais de ${IDLE_DAYS} dias:\n\n${lines.join("\n")}`;
      await sendWhatsApp(msg);

      const html = `
        <h2>Licenças ociosas — ${display}</h2>
        <p>${list.length} usuário(s) com licença <b>PRO/CRM</b> sem login há mais de <b>${IDLE_DAYS} dias</b>:</p>
        <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">
          <thead><tr style="background:#f3f4f6"><th>Usuário</th><th>Código</th><th>Licença</th><th>Dias sem login</th><th>Último login</th></tr></thead>
          <tbody>
            ${list.map((u) => `<tr><td>${u.user_name}</td><td>${u.user_code}</td><td>${u.license_type}</td><td>${u.days_idle === 9999 ? "nunca" : u.days_idle}</td><td>${u.last_login ? new Date(u.last_login).toLocaleDateString("pt-BR") : "—"}</td></tr>`).join("")}
          </tbody>
        </table>`;
      await sendEmail(`[Licenças ociosas] ${display} — ${list.length} usuário(s)`, html);
    }

    await sb.from("notification_send_runs").insert({
      function_name: "license-idle-watcher",
      status: "success",
      recipients_count: sentCount,
      error_message: null,
      details: { idle_total: allIdle.length, week: weekKey },
    });
    return new Response(JSON.stringify({ ok: true, idle_total: allIdle.length, alerts_sent: sentCount, week: weekKey }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("license-idle-watcher error:", e);
    try {
      await sb.from("notification_send_runs").insert({
        function_name: "license-idle-watcher",
        status: "error",
        recipients_count: 0,
        error_message: (e as Error).message,
        details: {},
      });
    } catch { /* ignore */ }
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
