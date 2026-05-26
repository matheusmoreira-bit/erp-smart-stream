import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireUser, authErrorResponse } from "../_shared/auth.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeDbName(db?: string | null): string {
  return (db || "")
    .trim()
    .replace(/^SBO_TESTE_\d+_/i, "SBO_")
    .replace(/^tst_/i, "");
}

function normalizeUser(companyDb: string, raw: Record<string, unknown>) {
  const user_code = String(raw.UserCode ?? raw.user_code ?? raw.USER_CODE ?? "").trim();
  const user_name = String(raw.UserName ?? raw.u_name ?? raw.U_NAME ?? user_code).trim();
  const locked = raw.Locked ?? raw.locked ?? raw.LOCKED;
  return {
    id: `cache:${companyDb}:${user_code}`,
    company_db: normalizeDbName(companyDb) || companyDb,
    user_code,
    user_name: user_name || user_code,
    is_locked: locked === "tYES" || locked === "Y" || locked === true || locked === 1 || locked === "1",
    has_license: false,
    license_type: null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    await requireUser(req);
    const adminClient = createClient(

      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    const companyDb = url.searchParams.get("company_db");
    const normalizedDb = normalizeDbName(companyDb);
    const candidates = Array.from(new Set([companyDb, normalizedDb].filter(Boolean) as string[]));

    let cacheQuery = adminClient
      .from("sap_cache")
      .select("company_db,data,updated_at")
      .eq("cache_key", "users")
      .order("updated_at", { ascending: false });
    if (candidates.length > 0) cacheQuery = cacheQuery.in("company_db", candidates);
    const { data: cacheRows, error: cacheError } = await cacheQuery.limit(candidates.length > 0 ? 5 : 20);
    if (cacheError) throw cacheError;

    const cachedCompanies = (cacheRows || []).map((row) => normalizeDbName(row.company_db));
    const licenseCompanies = Array.from(new Set([...candidates, ...cachedCompanies].filter(Boolean)));

    let licenseQuery = adminClient.from("user_licenses").select("*").order("user_name");
    if (licenseCompanies.length > 0) licenseQuery = licenseQuery.in("company_db", licenseCompanies);
    const { data: licenseRows, error: licenseError } = await licenseQuery;
    if (licenseError) throw licenseError;

    const { data: pricing, error: pricingError } = await adminClient.from("license_pricing").select("*");
    if (pricingError) throw pricingError;

    const key = (db: string, code: string) => `${normalizeDbName(db).toLowerCase()}::${code.toLowerCase()}`;
    const licenseByUser = new Map<string, Record<string, unknown>>();
    for (const license of licenseRows || []) {
      licenseByUser.set(key(license.company_db, license.user_code), license);
    }

    const users = (cacheRows || []).flatMap((cacheRow) => {
      const list = Array.isArray(cacheRow.data) ? cacheRow.data : [];
      return list
        .map((raw) => normalizeUser(cacheRow.company_db, raw as Record<string, unknown>))
        .filter((user) => user.user_code)
        .map((cached) => {
          const license = licenseByUser.get(key(cached.company_db, cached.user_code));
          return license ? { ...license, user_name: cached.user_name, is_locked: cached.is_locked } : cached;
        });
    });

    return new Response(JSON.stringify({ users: users.length > 0 ? users : licenseRows || [], pricing: pricing || [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao carregar análise de licenças";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});