// Salva/atualiza o perfil do usuário intercompany. Aceita chamadas de usuários
// autenticados no Lovable Cloud OU com sessão SAP válida (via headers x-sap-*),
// já que o app usa login SAP direto sem necessariamente estar autenticado no
// Lovable Cloud. Usa service_role para escrever contornando o RLS após validar
// a identidade do chamador.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireUserOrSapSession, authErrorResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ProfilePatch {
  company_db?: string;
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

    const companyDB = (body.company_db || "").trim();
    const userCode = (body.user_code || "").trim();
    if (!companyDB || !userCode) {
      return new Response(JSON.stringify({ error: "company_db e user_code obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Se o chamador vier via sessão SAP, obrigatoriamente só pode salvar o
    // próprio perfil na empresa da sessão. Chamador via Cloud (admin/user
    // logado) pode salvar o próprio perfil ou administrar o perfil de outros.
    const source = (caller as { source?: string }).source;
    if (source === "sap_session") {
      const sapCompany = (caller as { companyDB?: string }).companyDB || "";
      const sapUser = (caller as { userName?: string }).userName || "";
      if (sapCompany.toLowerCase() !== companyDB.toLowerCase() ||
          sapUser.toLowerCase() !== userCode.toLowerCase()) {
        return new Response(JSON.stringify({ error: "Sem permissão para editar este perfil" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Merge com registro existente para não sobrescrever campos ausentes.
    const { data: existing } = await admin
      .from("user_profiles")
      .select("*")
      .eq("company_db", companyDB)
      .eq("user_code", userCode)
      .maybeSingle();

    const payload: Record<string, unknown> = {
      ...(existing || {}),
      ...body,
      company_db: companyDB,
      user_code: userCode,
      updated_at: new Date().toISOString(),
    };
    delete (payload as { id?: string }).id;

    const { data, error } = await admin
      .from("user_profiles")
      .upsert(payload, { onConflict: "company_db,user_code" })
      .select()
      .single();
    if (error) throw error;

    // Espelha telefone em user_phones para compatibilidade com notificações.
    if (typeof body.phone === "string") {
      const cleaned = body.phone.trim();
      if (cleaned) {
        await admin.from("user_phones").upsert(
          { company_db: companyDB, user_code: userCode, phone: cleaned, source: "manual" },
          { onConflict: "company_db,user_code" },
        );
      }
    }

    return new Response(JSON.stringify({ ok: true, profile: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const authResp = authErrorResponse(err, corsHeaders);
    if (authResp) return authResp;
    console.error("[user-profile-save] error", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
