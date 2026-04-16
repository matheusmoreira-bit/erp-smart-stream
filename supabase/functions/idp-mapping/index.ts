import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    const adminClient = getServiceClient();
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (action === "upsertMany") {
      const rows = body.rows as Array<Record<string, unknown>>;
      if (!Array.isArray(rows) || rows.length === 0) {
        return new Response(JSON.stringify({ ok: true, count: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await adminClient
        .from("idp_user_mapping")
        .upsert(rows, { onConflict: "sap_user_code,idp_provider" });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, count: rows.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "link") {
      const { sap_user_code, idp_provider, idp_user_id, idp_email, idp_display_name } = body;
      if (!sap_user_code || !idp_provider) {
        return new Response(JSON.stringify({ error: "Parâmetros inválidos" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await adminClient
        .from("idp_user_mapping")
        .upsert(
          {
            sap_user_code,
            idp_provider,
            idp_user_id,
            idp_email,
            idp_display_name,
            status: "linked",
            linked_at: new Date().toISOString(),
          },
          { onConflict: "sap_user_code,idp_provider" }
        );
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "unlink") {
      const { sap_user_code, idp_provider } = body;
      if (!sap_user_code || !idp_provider) {
        return new Response(JSON.stringify({ error: "Parâmetros inválidos" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await adminClient
        .from("idp_user_mapping")
        .update({
          idp_user_id: null,
          idp_email: null,
          idp_display_name: null,
          status: "pending",
          linked_at: null,
        })
        .eq("sap_user_code", sap_user_code)
        .eq("idp_provider", idp_provider);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Ação inválida" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
