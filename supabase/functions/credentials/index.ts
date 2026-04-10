import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const url = new URL(req.url);
    const systemName = url.searchParams.get("system");
    const companyDb = url.searchParams.get("company_db");

    if (req.method === "GET") {
      let query = supabase.from("system_credentials").select("id, system_name, credential_key, updated_at, company_db");
      if (systemName) query = query.eq("system_name", systemName);
      if (companyDb) query = query.eq("company_db", companyDb);
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

      if (!system_name || !credentials?.length) {
        return new Response(JSON.stringify({ error: "system_name and credentials are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      for (const cred of credentials) {
        const { error } = await supabase
          .from("system_credentials")
          .upsert(
            { system_name, credential_key: cred.key, credential_value: cred.value, company_db: company_db || null },
            { onConflict: "company_db,system_name,credential_key" }
          );
        if (error) throw error;
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "DELETE") {
      const { system_name, company_db } = await req.json();
      if (!system_name) {
        return new Response(JSON.stringify({ error: "system_name is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let query = supabase.from("system_credentials").delete().eq("system_name", system_name);
      if (company_db) query = query.eq("company_db", company_db);
      const { error } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
