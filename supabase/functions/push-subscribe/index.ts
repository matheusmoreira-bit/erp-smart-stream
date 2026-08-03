// Gerencia inscrições de Web Push (aprovações no celular).
//
// Ações: get-key (chave pública VAPID), subscribe, unsubscribe, test.
// A escrita é feita aqui no servidor porque a maioria dos usuários autentica
// via sessão SAP (sem auth.uid()), e a tabela só aceita escrita do serviço.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireUser, validateSapSession, AuthError } from "../_shared/auth.ts";
import { corsFor, rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import { isPushConfigured, pushIdentifier, sendWebPush, vapidPublicKey } from "../_shared/web-push.ts";

interface Body {
  action?: "get-key" | "subscribe" | "unsubscribe" | "test";
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  company_db?: string | null;
  user_agent?: string | null;
}

Deno.serve(async (req) => {
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;
  const corsHeaders = corsFor(req);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: Body = {};
  try { body = await req.json(); } catch { return json(400, { error: "Corpo inválido (JSON malformado)." }); }

  const action = body.action || "get-key";
  if (!["get-key", "subscribe", "unsubscribe", "test"].includes(action)) {
    return json(400, { error: "action inválida." });
  }

  if (action === "get-key") {
    return json(200, { public_key: vapidPublicKey(), configured: isPushConfigured() });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // ── Identidade do chamador ───────────────────────────────────────────
  let email: string | null = null;
  let userName: string | null = null;
  try {
    const cloudUser = await requireUser(req);
    email = cloudUser.email || null;
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
  }
  const sap = await validateSapSession(req);
  if (sap) {
    userName = sap.userName || null;
    if (!email) email = sap.email || null;
  }
  const identifier = pushIdentifier(email || userName);
  if (!identifier) {
    return json(401, { error: "Não autenticado — faça login para ativar as notificações push." });
  }

  if (action === "unsubscribe") {
    const endpoint = String(body.endpoint || "").trim();
    if (!endpoint) return json(400, { error: "endpoint é obrigatório." });
    const { error } = await admin
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("user_identifier", identifier);
    if (error) return json(500, { error: `Falha ao remover inscrição: ${error.message}` });
    return json(200, { ok: true });
  }

  if (action === "subscribe") {
    const endpoint = String(body.endpoint || "").trim();
    const p256dh = String(body.keys?.p256dh || "").trim();
    const auth = String(body.keys?.auth || "").trim();
    if (!endpoint || !/^https:\/\//.test(endpoint) || endpoint.length > 2000) {
      return json(400, { error: "endpoint inválido." });
    }
    if (!p256dh || !auth) return json(400, { error: "keys.p256dh e keys.auth são obrigatórias." });

    const { error } = await admin
      .from("push_subscriptions")
      .upsert(
        {
          user_identifier: identifier,
          email: email ? email.toLowerCase() : null,
          company_db: body.company_db || sap?.companyDB || null,
          endpoint,
          p256dh,
          auth,
          user_agent: (body.user_agent || "").slice(0, 300) || null,
          failure_count: 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
    if (error) return json(500, { error: `Falha ao salvar inscrição: ${error.message}` });
    return json(200, { ok: true, identifier });
  }

  // ── test ─────────────────────────────────────────────────────────────
  const { data } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_identifier", identifier);
  const subs = data || [];
  if (subs.length === 0) return json(404, { error: "Nenhum dispositivo inscrito para este usuário." });

  const results = await Promise.all(
    subs.map((s) =>
      sendWebPush(s, {
        title: "ERP Flow — teste de push",
        body: "Notificações push ativadas neste dispositivo.",
        url: "/aprovacoes?tab=pending",
        tag: "push-test",
      }),
    ),
  );
  const gone = subs.filter((s, i) => results[i].gone).map((s) => s.id);
  if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);

  const sent = results.filter((r) => r.ok).length;
  return json(200, { ok: sent > 0, sent, failed: results.length - sent, errors: results.filter((r) => !r.ok).map((r) => r.error) });
});
