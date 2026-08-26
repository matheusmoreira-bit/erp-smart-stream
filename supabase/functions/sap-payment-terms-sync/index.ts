// Sincroniza as formas de pagamento (PaymentTermsTypes) de cada empresa SAP
// para `public.sap_cache` (chave `payment_terms_v1`). Roda a cada 12h via cron
// usando exclusivamente a conta de serviço "Apiuser" — nunca o usuário real.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";

const TTL_MS = 12 * 60 * 60 * 1000;
const PAGE_SIZE = 20;

interface PaymentTermRow {
  GroupNumber?: number;
  PaymentTermsGroupName?: string;
}

function buildBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function login(baseUrl: string, companyDB: string, username: string, password: string) {
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: username, Password: password, CompanyDB: companyDB }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Login falhou ${r.status}: ${t.slice(0, 200)}`);
  }
  await r.json().catch(() => null);
  const setCookie = r.headers.get("set-cookie") || "";
  const session = setCookie.match(/B1SESSION=([^;]+)/)?.[1];
  const route = setCookie.match(/ROUTEID=([^;]+)/)?.[1];
  if (!session) throw new Error("B1SESSION ausente");
  return `B1SESSION=${session}${route ? `; ROUTEID=${route}` : ""}`;
}

async function logout(baseUrl: string, cookie: string) {
  await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
}

async function fetchPaymentTerms(baseUrl: string, cookie: string): Promise<PaymentTermRow[]> {
  const rows: PaymentTermRow[] = [];
  // O Service Layer pagina em 20 registros: seguimos com $skip até esgotar.
  for (let skip = 0; skip < 2000; skip += PAGE_SIZE) {
    const url = `${baseUrl}/PaymentTermsTypes?$select=GroupNumber,PaymentTermsGroupName&$top=${PAGE_SIZE}&$skip=${skip}`;
    const r = await fetch(url, { headers: { Cookie: cookie, "Content-Type": "application/json" } });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`GET PaymentTermsTypes ${r.status}: ${t.slice(0, 200)}`);
    }
    const body = await r.json().catch(() => null);
    const page: PaymentTermRow[] = Array.isArray(body?.value) ? body.value : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    let onlyCompany: string | null = null;
    try {
      const body = await req.json();
      const raw = (body?.company_db ?? body?.companyDb);
      if (typeof raw === "string" && raw.trim()) onlyCompany = raw.trim();
    } catch { /* sem corpo: processa todas */ }

    const { data: credRows, error: credErr } = await sb
      .from("system_credentials")
      .select("company_db,credential_key,credential_value")
      .eq("system_name", "sap");
    if (credErr) throw new Error(credErr.message);

    const byCompany = new Map<string, Record<string, string>>();
    for (const row of credRows || []) {
      const db = (row.company_db as string) || "";
      if (!db) continue;
      if (onlyCompany && db !== onlyCompany) continue;
      const bucket = byCompany.get(db) ?? {};
      bucket[row.credential_key as string] = row.credential_value as string;
      byCompany.set(db, bucket);
    }

    const results: Array<Record<string, unknown>> = [];

    for (const [companyDb, creds] of byCompany) {
      try {
        if (!creds.username || !creds.password || !creds.service_layer_url) {
          results.push({ companyDb, status: "skipped", reason: "credenciais incompletas" });
          continue;
        }
        // Segurança: watchers só autenticam com a conta de serviço "Apiuser".
        if ((creds.username || "").trim().toLowerCase() !== "apiuser") {
          results.push({ companyDb, status: "skipped", reason: "usuário SAP não é Apiuser" });
          continue;
        }

        const baseUrl = buildBaseUrl(creds.service_layer_url);
        const sapCompanyDb = creds.company_db_sap || creds.company_db || companyDb;
        const cookie = await login(baseUrl, sapCompanyDb, creds.username, creds.password);
        try {
          const rows = await fetchPaymentTerms(baseUrl, cookie);
          if (rows.length === 0) {
            results.push({ companyDb, status: "skipped", reason: "nenhuma forma de pagamento retornada" });
            continue;
          }
          const { error } = await sb.from("sap_cache").upsert({
            cache_key: "payment_terms_v1",
            company_db: companyDb,
            data: rows,
            expires_at: new Date(Date.now() + TTL_MS).toISOString(),
          }, { onConflict: "cache_key,company_db" });
          if (error) throw new Error(`Upsert sap_cache: ${error.message}`);
          results.push({ companyDb, status: "success", count: rows.length });
        } finally {
          await logout(baseUrl, cookie);
        }
      } catch (e) {
        results.push({ companyDb, status: "error", error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
