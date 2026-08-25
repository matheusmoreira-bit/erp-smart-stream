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
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import { canonicalUserKey } from "../_shared/text-normalize.ts";
import { callerOwnsUserCode } from "../_shared/user-aliases.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ProfilePatch {
  action?: "get" | "list" | "save";
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
  const foreignOrigin = rejectForeignOrigin(req);
  if (foreignOrigin) return foreignOrigin;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const caller = await requireUserOrSapSession(req);
    const body = (await req.json().catch(() => ({}))) as ProfilePatch;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (body.action === "list") {
      const { data, error } = await admin
        .from("collaborator_profiles")
        .select("user_code, display_name, email, phone");
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, profiles: data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawCode = (body.user_code || "").trim();
    if (!rawCode) {
      return new Response(JSON.stringify({ error: "user_code obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userCode = canonicalUserKey(rawCode);
    if (!userCode) {
      return new Response(JSON.stringify({ error: "Identidade do usuário inválida" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Usuários comuns só podem editar a própria identidade; admins podem
    // manter os dados globais de qualquer colaborador.
    const source = (caller as { source?: string }).source;
    if (source === "sap_session") {
      const sapUser = canonicalUserKey((caller as { userName?: string }).userName);
      if (sapUser !== userCode) {
        return new Response(JSON.stringify({ error: "Sem permissão para editar este perfil" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      const cloudCaller = caller as { id?: string; email?: string };
      const { data: isAdmin } = cloudCaller.id
        ? await admin.rpc("has_role", { _user_id: cloudCaller.id, _role: "admin" })
        : { data: false };
      const ownsProfile = isAdmin === true
        ? true
        : await callerOwnsUserCode(admin, cloudCaller, userCode);
      if (!ownsProfile) {
        return new Response(JSON.stringify({ error: "Sem permissão para editar este perfil" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (body.action === "get") {
      const { data, error } = await admin
        .from("collaborator_profiles")
        .select("*")
        .eq("user_code", userCode)
        .maybeSingle();
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, profile: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
    if ("display_name" in body) patch.display_name = body.display_name?.trim() || null;
    if ("email" in body) patch.email = body.email?.trim().toLowerCase() || null;
    if ("phone" in body) patch.phone = body.phone?.trim() || null;
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

    const directoryPatch: Record<string, unknown> = {
      user_key: userCode,
      updated_at: new Date().toISOString(),
    };
    if (data.display_name) directoryPatch.display_name = data.display_name;
    await admin.from("sap_user_directory").upsert(directoryPatch, { onConflict: "user_key" });

    if (data.email) {
      await admin
        .from("sap_user_emails")
        .update({ is_primary: false })
        .eq("user_key", userCode)
        .eq("is_primary", true);
      await admin.from("sap_user_emails").upsert({
        user_key: userCode,
        email: String(data.email).toLowerCase(),
        is_primary: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "email" });
    }

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
