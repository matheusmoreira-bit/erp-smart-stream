import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrSapAdmin, authErrorResponse } from "../_shared/auth.ts";

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
    await requireAdminOrSapAdmin(req);
    const adminClient = getServiceClient();

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (action === "list") {
      const idpProvider = typeof body.idp_provider === "string" && body.idp_provider.trim()
        ? body.idp_provider.trim()
        : "jumpcloud";
      const { data, error } = await adminClient
        .from("idp_user_mapping")
        .select("*")
        .eq("idp_provider", idpProvider)
        .order("sap_user_code");
      if (error) throw error;
      return new Response(JSON.stringify({ mappings: data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      const {
        sap_user_code,
        idp_provider,
        idp_user_id,
        idp_email,
        idp_display_name,
        employee_id,
        employee_type,
        job_title,
        company_name,
        department,
        cost_center_code,
        cost_center_label,
        manager_idp_id,
      } = body;
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
            employee_id: employee_id ?? null,
            employee_type: employee_type ?? null,
            job_title: job_title ?? null,
            company_name: company_name ?? null,
            department: department ?? null,
            cost_center_code: cost_center_code ?? null,
            cost_center_label: cost_center_label ?? null,
            manager_idp_id: manager_idp_id ?? null,
            attributes_synced_at: new Date().toISOString(),
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
    const authResp = authErrorResponse(error, corsHeaders);
    if (authResp) return authResp;
    const message = error instanceof Error ? error.message : "Erro desconhecido";

    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
