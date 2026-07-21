// Salva/atualiza o perfil UNIFICADO do colaborador (collaborator_profiles),
// identificado pelo user_code (lowercase). Um único registro por pessoa se
// aplica a todas as empresas em que ela existe. O telefone é replicado para
// user_phones em cada empresa via trigger no banco.
//
// Aceita chamadas de usuários autenticados no Lovable Cloud OU com sessão SAP
// válida (headers x-sap-*). Usa service_role para escrever após validar o
// chamador; garante que sessão SAP só edita o próprio perfil.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireUserOrSapSession, authErrorResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ProfilePatch {
  company_db?: string; // informativo — não usado no cadastro unificado
  user_code?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  email?: string | null;
  phone?: string | null;
  notify_whatsapp_overdue?: boolean;
  notify_whatsapp_approvals?: boolean;
  notify_email_overdue?: boolean;
  notify_email_approvals?: boolean;
  sap_synced_at?: string | null;
  dismissed_until?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const caller = await requireUserOrSapSession(req);
    const body = (await req.json().catch(() => ({}))) as ProfilePatch;

    const rawCode = (body.user_code || "").trim();
    if (!rawCode) {
      return new Response(JSON.stringify({ error: "user_code obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userCode = rawCode.toLowerCase();

    // Sessão SAP só pode salvar o próprio user_code.
    const source = (caller as { source?: string }).source;
    if (source === "sap_session") {
      const sapUser = ((caller as { userName?: string }).userName || "").toLowerCase();
      if (sapUser !== userCode) {
        return new Response(JSON.stringify({ error: "Sem permissão para editar este perfil" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Merge com registro existente para não sobrescrever campos ausentes.
    const { data: existing } = await admin
      .from("collaborator_profiles")
      .select("*")
      .eq("user_code", userCode)
      .maybeSingle();

    const patch: Record<string, unknown> = { ...(existing || {}) };
    const allowed: (keyof ProfilePatch)[] = [
      "display_name", "avatar_url", "email", "phone",
      "notify_whatsapp_overdue", "notify_whatsapp_approvals",
      "notify_email_overdue", "notify_email_approvals",
      "sap_synced_at", "dismissed_until",
    ];
    for (const k of allowed) {
      if (k in body) patch[k] = body[k] as unknown;
    }
    patch.user_code = userCode;
    patch.updated_at = new Date().toISOString();
    delete (patch as { id?: string }).id;
    delete (patch as { created_at?: string }).created_at;

    const { data, error } = await admin
      .from("collaborator_profiles")
      .upsert(patch, { onConflict: "user_code" })
      .select()
      .single();
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, profile: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const authResp = authErrorResponse(err, corsHeaders);
    if (authResp) return authResp;
    console.error("[user-profile-save] error", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
