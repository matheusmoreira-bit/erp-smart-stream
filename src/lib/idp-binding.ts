import { supabase } from "@/integrations/supabase/client";

/** True when the global flag `require_idp_binding` is on. */
export async function isIdpBindingRequired(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("require_idp_binding_enabled");
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

/** True when the given e-mail already has an active identity link. */
export async function isEmailIdpLinked(email: string): Promise<boolean> {
  if (!email) return false;
  try {
    const { data, error } = await supabase.rpc("is_idp_linked", { _email: email });
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

/**
 * After a successful Google sign-in, record the identity in idp_user_mapping so it
 * counts as a linked user. Best-effort: failures don't block the login.
 */
export async function upsertGoogleIdpMapping(params: {
  email: string;
  displayName?: string | null;
  idpUserId?: string | null;
}): Promise<void> {
  const email = params.email?.trim();
  if (!email) return;
  const sapUserCode = email.split("@")[0].toLowerCase();
  try {
    await supabase
      .from("idp_user_mapping")
      .upsert(
        {
          sap_user_code: sapUserCode,
          idp_provider: "google",
          idp_user_id: params.idpUserId ?? email,
          idp_email: email,
          idp_display_name: params.displayName ?? email,
          status: "linked",
          linked_at: new Date().toISOString(),
        },
        { onConflict: "sap_user_code,idp_provider" }
      );
  } catch {
    /* best-effort */
  }
}

/**
 * Blocks the caller when enforcement is on and the e-mail is not linked to an IdP.
 * Returns { ok, reason } — the caller decides how to surface the error.
 */
export async function assertIdpBinding(email: string): Promise<{ ok: boolean; reason?: string }> {
  const required = await isIdpBindingRequired();
  if (!required) return { ok: true };
  const linked = await isEmailIdpLinked(email);
  if (linked) return { ok: true };
  return {
    ok: false,
    reason:
      "Sua conta ainda não está vinculada ao JumpCloud. Solicite ao administrador que faça o vínculo antes de acessar.",
  };
}
