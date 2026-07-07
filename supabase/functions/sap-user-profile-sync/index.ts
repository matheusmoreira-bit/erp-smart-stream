// Consulta os dados do usuário SAP em TODAS as empresas ativas (erp_type='sap')
// para pré-popular o perfil intercompany. Usa credenciais administrativas
// armazenadas em system_credentials — a chamada só é permitida a usuários
// autenticados no Lovable Cloud.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireUser, authErrorResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getBaseUrl(sb: ReturnType<typeof createClient>, db: string): Promise<string> {
  const fallback = Deno.env.get("SAP_DEFAULT_BASE_URL") ||
    "https://jyl32uqm9176-sl.s1p-zona-01-4fd9831d6a58.saas.wevy.cloud/b1s/v2";
  const { data } = await sb
    .from("system_credentials")
    .select("credential_value")
    .eq("company_db", db)
    .eq("system_name", "sap")
    .eq("credential_key", "service_layer_url")
    .maybeSingle();
  const raw = (typeof data?.credential_value === "string" && data.credential_value.trim())
    ? data.credential_value.trim()
    : fallback;
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function getCreds(sb: ReturnType<typeof createClient>, db: string) {
  const { data } = await sb
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", db)
    .in("credential_key", ["username", "password", "company_db"]);
  const m = new Map<string, string>();
  (data || []).forEach((r: { credential_key: string; credential_value: string | null }) => {
    if (r.credential_value) m.set(r.credential_key, r.credential_value);
  });
  const username = m.get("username");
  const password = m.get("password");
  const cdb = m.get("company_db");
  const sapCompanyDb = cdb && !/^https?:\/\//i.test(cdb) ? cdb : db;
  if (!username || !password) return null;
  return { username, password, sapCompanyDb };
}

async function sapLogin(baseUrl: string, companyDB: string, u: string, p: string) {
  const resp = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ CompanyDB: companyDB, UserName: u, Password: p }),
  });
  if (!resp.ok) throw new Error(`login ${resp.status}`);
  const cookies = resp.headers.get("set-cookie") || "";
  const s = cookies.match(/B1SESSION=([^;]+)/)?.[1];
  const r = cookies.match(/ROUTEID=([^;]+)/)?.[1] || "";
  if (!s) throw new Error("sem session");
  return { baseUrl, s, r };
}

async function sapLogout(x: { baseUrl: string; s: string; r: string }) {
  try {
    await fetch(`${x.baseUrl}/Logout`, {
      method: "POST",
      headers: { Cookie: `B1SESSION=${x.s}${x.r ? `; ROUTEID=${x.r}` : ""}` },
    });
  } catch { /* noop */ }
}

interface SapUserRow { UserCode?: string; UserName?: string; eMail?: string }

async function findUser(
  x: { baseUrl: string; s: string; r: string },
  code: string,
  email: string | null,
): Promise<SapUserRow | null> {
  const cookie = `B1SESSION=${x.s}${x.r ? `; ROUTEID=${x.r}` : ""}`;
  const parts: string[] = [];
  if (code) parts.push(`UserCode eq '${code.replace(/'/g, "''")}'`);
  if (email) parts.push(`eMail eq '${email.replace(/'/g, "''")}'`);
  if (parts.length === 0) return null;
  const filter = parts.join(" or ");
  const url = `${x.baseUrl}/Users?$select=UserCode,UserName,eMail&$filter=${encodeURIComponent(filter)}&$top=5`;
  const resp = await fetch(url, { headers: { Cookie: cookie } });
  if (!resp.ok) return null;
  const p = await resp.json().catch(() => null) as { value?: SapUserRow[] } | null;
  const rows = p?.value || [];
  if (rows.length === 0) return null;
  // Prefer exact user_code match
  return rows.find((r) => (r.UserCode || "").toLowerCase() === code.toLowerCase()) || rows[0];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const caller = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const userCode = (body.user_code as string | undefined || "").trim();
    const emailHint = (body.email as string | undefined || caller.email || "").trim().toLowerCase() || null;

    if (!userCode && !emailHint) {
      return new Response(JSON.stringify({ error: "user_code ou email obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = admin();
    const { data: companies, error: cErr } = await sb
      .from("companies")
      .select("company_db, display_name")
      .eq("erp_type", "sap")
      .eq("is_active", true);
    if (cErr) throw cErr;

    interface Hit { company_db: string; display_name: string; user_code: string; user_name: string | null; email: string | null }
    const hits: Hit[] = [];
    const errors: { company_db: string; error: string }[] = [];

    for (const c of (companies || []) as { company_db: string; display_name: string }[]) {
      try {
        const creds = await getCreds(sb, c.company_db);
        if (!creds) continue;
        const baseUrl = await getBaseUrl(sb, c.company_db);
        const sess = await sapLogin(baseUrl, creds.sapCompanyDb, creds.username, creds.password);
        try {
          const row = await findUser(sess, userCode, emailHint);
          if (row?.UserCode) {
            hits.push({
              company_db: c.company_db,
              display_name: c.display_name,
              user_code: row.UserCode,
              user_name: row.UserName ?? null,
              email: row.eMail ?? null,
            });
          }
        } finally { await sapLogout(sess); }
      } catch (e) {
        errors.push({ company_db: c.company_db, error: (e as Error).message });
      }
    }

    // Consolida: melhor nome e melhor e-mail encontrados.
    const bestName = hits.map((h) => h.user_name).find((n) => n && n.trim());
    const bestEmail = hits.map((h) => h.email).find((e) => e && e.trim());

    return new Response(
      JSON.stringify({
        ok: true,
        caller_email: caller.email,
        hits,
        errors,
        aggregate: {
          display_name: bestName || null,
          email: bestEmail || emailHint,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const authResp = authErrorResponse(err, corsHeaders);
    if (authResp) return authResp;
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
