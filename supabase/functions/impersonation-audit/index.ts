// Auditoria de impersonação ("atuar como outro usuário").
//
// Registra no servidor, com identidade derivada do JWT (nunca do corpo da
// requisição), quem iniciou/encerrou uma impersonação, quem foi impersonado,
// a empresa e o horário. A escrita usa service role porque `audit_log` é
// somente leitura para o cliente.
//
// Apenas administradores do Lovable Cloud podem impersonar, então o start só
// é aceito para admins; o stop é aceito para qualquer usuário autenticado
// (para nunca bloquear a saída do modo impersonação).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireUser, AuthError } from "../_shared/auth.ts";
import { corsFor, rejectForeignOrigin } from "../_shared/cors-allowlist.ts";

function str(v: unknown, max = 200): string {
  return String(v ?? "").trim().slice(0, max);
}

Deno.serve(async (req) => {
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;
  const corsHeaders = corsFor(req);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: {
    event?: "start" | "stop" | "reconcile";
    target_user?: string;
    target_name?: string | null;
    target_email?: string | null;
    company_db?: string | null;
    with_password?: boolean;
    started_at?: string | null;
  } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Corpo inválido (JSON malformado)." });
  }

  const event = body.event === "stop" ? "stop" : body.event === "start" ? "start"
    : body.event === "reconcile" ? "reconcile" : null;
  if (!event) return json(400, { error: "event deve ser 'start', 'stop' ou 'reconcile'." });
  const targetUser = event === "reconcile" ? "*" : str(body.target_user, 120);
  if (!targetUser) return json(400, { error: "target_user é obrigatório." });

  let caller: { id: string; email?: string | null };
  try {
    caller = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) return json(e.status ?? 401, { error: e.message });
    throw e;
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  if (event === "start") {
    const { data: hasAdmin } = await admin.rpc("has_role", { _user_id: caller.id, _role: "admin" });
    if (hasAdmin !== true) {
      return json(403, { error: "Apenas administradores podem atuar como outro usuário." });
    }
  }

  const occurredAt = new Date().toISOString();

  // F12: estado da impersonação fica no servidor. Enquanto houver sessão
  // ativa, o banco e as funções recusam escritas desse admin (somente leitura).
  const closeActive = async (reason: string) => {
    const { data } = await admin.from("impersonation_sessions")
      .update({ ended_at: occurredAt, end_reason: reason })
      .eq("admin_user_id", caller.id).is("ended_at", null)
      .select("id");
    return (data || []).length;
  };
  if (event === "reconcile") {
    // O navegador não está mais em impersonação: encerra sessões órfãs.
    const closed = await closeActive("reconcile");
    if (closed > 0) {
      await admin.from("audit_log").insert({
        actor_id: caller.id, actor_email: caller.email || null,
        action: "impersonation_stop", entity_type: "erp_session", entity_id: "*",
        details: { reason: "reconcile", closed, occurred_at: occurredAt },
      });
    }
    return json(200, { ok: true, closed });
  }
  if (event === "start") {
    await closeActive("replaced");
    const { error: insErr } = await admin.from("impersonation_sessions").insert({
      admin_user_id: caller.id,
      admin_email: caller.email || null,
      target_user: targetUser,
      company_db: str(body.company_db, 80) || null,
    });
    if (insErr) return json(500, { error: "Falha ao registrar a impersonação no servidor." });
  } else {
    await closeActive("stop");
  }
  const { error } = await admin.from("audit_log").insert({
    actor_id: caller.id,
    // Identidade sempre do token — o cliente não escolhe quem "assina" o log.
    actor_email: caller.email || null,
    action: event === "start" ? "impersonation_start" : "impersonation_stop",
    entity_type: "erp_session",
    entity_id: targetUser,
    company_db: str(body.company_db, 80) || null,
    details: {
      target_user: targetUser,
      target_name: str(body.target_name, 200) || null,
      target_email: str(body.target_email, 200) || null,
      with_password: !!body.with_password,
      started_at: str(body.started_at, 40) || null,
      occurred_at: occurredAt,
      ip: req.headers.get("x-forwarded-for") || null,
      user_agent: str(req.headers.get("user-agent"), 300) || null,
    },
  });

  if (error) return json(500, { error: "Falha ao registrar auditoria de impersonação." });
  return json(200, { ok: true, occurred_at: occurredAt });
});
