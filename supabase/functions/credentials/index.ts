import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { AuthError, requireAdminOrSapAdmin, requireAdminOrSapSession, authErrorResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db",
};

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const systemName = url.searchParams.get("system");
    let companyDb = url.searchParams.get("company_db");
    const includeKeys = url.searchParams.get("keys");
    const metadataOnlyGet = req.method === "GET" && !includeKeys;
    const caller = metadataOnlyGet ? await requireAdminOrSapSession(req) : await requireAdminOrSapAdmin(req);
    const callerCompanyDb = typeof (caller as { companyDB?: unknown }).companyDB === "string"
      ? (caller as { companyDB: string }).companyDB
      : null;
    if (metadataOnlyGet && callerCompanyDb) {
      if (companyDb && companyDb !== callerCompanyDb) {
        throw new AuthError("Acesso negado para esta empresa", 403);
      }
      companyDb = callerCompanyDb;
    }
    const adminClient = getServiceClient();

    if (req.method === "GET") {
      const selectCols = includeKeys
        ? "id, system_name, credential_key, credential_value, updated_at, company_db"
        : "id, system_name, credential_key, updated_at, company_db";
      let query = adminClient.from("system_credentials").select(selectCols);
      if (systemName) query = query.eq("system_name", systemName);
      if (companyDb) query = query.eq("company_db", companyDb);
      if (includeKeys) {
        const keys = includeKeys.split(",").map((k) => k.trim()).filter(Boolean);
        if (keys.length > 0) query = query.in("credential_key", keys);
      }
      const { data, error } = await query.order("system_name").order("credential_key");
      if (error) throw error;
      return new Response(JSON.stringify({ credentials: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const { system_name, credentials, company_db } = body as {
        system_name: string;
        credentials: { key: string; value: string }[];
        company_db?: string;
      };

      if (!system_name || typeof system_name !== "string" || system_name.length > 100) {
        return new Response(JSON.stringify({ error: "system_name inválido" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!Array.isArray(credentials) || credentials.length === 0 || credentials.length > 50) {
        return new Response(JSON.stringify({ error: "credentials inválidas" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      for (const cred of credentials) {
        if (!cred.key || typeof cred.key !== "string" || cred.key.length > 100) {
          return new Response(JSON.stringify({ error: `credential key inválida: ${cred.key}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (typeof cred.value !== "string" || cred.value.length > 10000) {
          return new Response(JSON.stringify({ error: `credential value inválida para ${cred.key}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      for (const cred of credentials) {
        const { error } = await adminClient
          .from("system_credentials")
          .upsert(
            { system_name, credential_key: cred.key, credential_value: cred.value, company_db: company_db || null },
            { onConflict: "system_name,credential_key,company_db" },
          );
        if (error) throw error;
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "DELETE") {
      const body = await req.json();
      const { system_name, company_db } = body as { system_name: string; company_db?: string };
      if (!system_name) {
        return new Response(JSON.stringify({ error: "system_name é obrigatório" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let q = adminClient.from("system_credentials").delete().eq("system_name", system_name);
      q = company_db ? q.eq("company_db", company_db) : q.is("company_db", null);
      const { error } = await q;
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[credentials] error:", err instanceof Error ? err.message : String(err));
    const authResp = authErrorResponse(err, corsHeaders);
    if (authResp) return authResp;
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
