// Administração das chaves de API do ERP Flow (somente administradores).
//
// Ops (POST JSON):
//   { op: "list" }                      → lista as chaves (sem o valor em claro)
//   { op: "create", name, service, expires_at?, notes? } → cria e devolve o valor UMA vez
//   { op: "revoke", id, reason? }       → revoga
//   { op: "delete", id }                → remove o registro (apenas chaves já revogadas)
//
// A tabela `public.api_keys` não é exposta ao cliente: todo acesso passa aqui.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireUser, authErrorResponse } from "../_shared/auth.ts";
import { corsFor, rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import { sha256Hex } from "../_shared/api-keys.ts";

const SERVICES = ["external-approvals-api", "pagcorp-status-api"] as const;

function service(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

function json(status: number, body: unknown, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function generateKey(svc: string): { plain: string; prefix: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const tag = svc === "pagcorp-status-api" ? "pgc" : "apr";
  const plain = `erpf_${tag}_${secret}`;
  return { plain, prefix: plain.slice(0, 14) };
}

Deno.serve(async (req) => {
  const cors = corsFor(req, "POST, OPTIONS");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;
  if (req.method !== "POST") return json(405, { error: "Use POST" }, cors);

  const admin = service();

  let user;
  try {
    user = await requireUser(req);
  } catch (err) {
    return authErrorResponse(err, cors);
  }

  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (isAdmin !== true) return json(403, { error: "Acesso restrito a administradores" }, cors);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const op = String((body as Record<string, unknown>).op || "").toLowerCase();
  const actor = user.email || user.id;

  if (op === "list") {
    const { data, error } = await admin
      .from("api_keys")
      .select("id, name, service, key_prefix, notes, created_by, created_at, expires_at, last_used_at, use_count, revoked_at, revoked_by, revoke_reason")
      .order("created_at", { ascending: false });
    if (error) return json(500, { error: error.message }, cors);
    const legacy = SERVICES.filter((s) =>
      Deno.env.get(s === "pagcorp-status-api" ? "PAGCORP_STATUS_API_KEY" : "EXTERNAL_APPROVALS_API_KEY"),
    ).map((s) => ({
      service: s,
      secret_name: s === "pagcorp-status-api" ? "PAGCORP_STATUS_API_KEY" : "EXTERNAL_APPROVALS_API_KEY",
    }));
    return json(200, { keys: data ?? [], legacy, services: SERVICES }, cors);
  }

  if (op === "create") {
    const name = String((body as Record<string, unknown>).name || "").trim();
    const svc = String((body as Record<string, unknown>).service || "").trim();
    const notes = String((body as Record<string, unknown>).notes || "").trim() || null;
    const expiresRaw = (body as Record<string, unknown>).expires_at;
    if (name.length < 3 || name.length > 120) return json(400, { error: "Nome deve ter entre 3 e 120 caracteres" }, cors);
    if (!(SERVICES as readonly string[]).includes(svc)) return json(400, { error: "Serviço inválido" }, cors);
    let expires_at: string | null = null;
    if (expiresRaw) {
      const d = new Date(String(expiresRaw));
      if (Number.isNaN(d.getTime())) return json(400, { error: "Data de expiração inválida" }, cors);
      expires_at = d.toISOString();
    }

    const { plain, prefix } = generateKey(svc);
    const key_hash = await sha256Hex(plain);
    const { data, error } = await admin
      .from("api_keys")
      .insert({ name, service: svc, key_prefix: prefix, key_hash, notes, expires_at, created_by: actor })
      .select("id, name, service, key_prefix, created_at, expires_at")
      .single();
    if (error) return json(500, { error: error.message }, cors);
    // O valor em claro só existe nesta resposta.
    return json(200, { key: data, plaintext: plain }, cors);
  }

  if (op === "revoke") {
    const id = String((body as Record<string, unknown>).id || "");
    const reason = String((body as Record<string, unknown>).reason || "").trim().slice(0, 500) || null;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "id inválido" }, cors);
    const { error } = await admin
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString(), revoked_by: actor, revoke_reason: reason })
      .eq("id", id)
      .is("revoked_at", null);
    if (error) return json(500, { error: error.message }, cors);
    return json(200, { ok: true }, cors);
  }

  if (op === "delete") {
    const id = String((body as Record<string, unknown>).id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "id inválido" }, cors);
    const { error } = await admin.from("api_keys").delete().eq("id", id).not("revoked_at", "is", null);
    if (error) return json(500, { error: error.message }, cors);
    return json(200, { ok: true }, cors);
  }

  return json(400, { error: "op deve ser 'list', 'create', 'revoke' ou 'delete'" }, cors);
});
