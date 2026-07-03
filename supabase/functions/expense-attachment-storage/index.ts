// Edge function: gateway for the private `expense-attachments` storage bucket.
//
// Every upload / signed-url / remove for expense (and advance_payments)
// attachments passes through here so that the bucket policies for `anon` /
// `authenticated` roles can be revoked. Writes happen with the service role
// after the caller is authorized against SAP session or Cloud admin JWT and
// checked against the target expense / advance ownership (or approver role
// for signing URLs).
//
// Actions:
//   POST (multipart/form-data)
//     - action=upload
//         expense_id | advance_id: string
//         file: File
//       → { file_path, file_name, file_size, mime_type }
//
//   POST (application/json)
//     - { action: "sign",   file_path }              → { signed_url }
//     - { action: "remove", file_path }              → { ok: true }
//
// Path convention:
//     expense attachments   → `{expense_id}/{ts}_{name}`
//     advance attachments   → `advances/{advance_id}/{ts}_{name}`

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { validateSapSession, requireUser, AuthError } from "../_shared/auth.ts";

const BUCKET = "expense-attachments";
const SIGN_TTL_SECONDS = 300;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB per file

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalize(s: unknown): string {
  return String(s ?? "").toLowerCase().trim();
}
function emailPrefix(v: string): string {
  const s = normalize(v);
  const i = s.indexOf("@");
  return i > 0 ? s.slice(0, i) : s;
}
function callerMatches(caller: string, candidate: unknown): boolean {
  const c = normalize(caller);
  const v = normalize(candidate);
  if (!c || !v) return false;
  return c === v || emailPrefix(c) === emailPrefix(v);
}

interface Caller {
  identity: string | null;
  cloudUserId: string | null;
  email: string | null;
  isCloudAdmin: boolean;
  isSuperUser: boolean;
}

async function identifyCaller(req: Request, admin: SupabaseClient): Promise<Caller> {
  let identity: string | null = null;
  let cloudUserId: string | null = null;
  let email: string | null = null;
  let isCloudAdmin = false;
  let isSuperUser = false;

  try {
    const u = await requireUser(req);
    cloudUserId = u.id;
    email = u.email || null;
    identity = u.email || null;
    const { data } = await admin.rpc("has_role", { _user_id: u.id, _role: "admin" });
    if (data === true) isCloudAdmin = true;
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
  }

  const sap = await validateSapSession(req);
  if (sap) {
    if (!identity) identity = sap.userName;
    try {
      const { data: mapped } = await admin.rpc("is_sap_user_admin", {
        _sap_username: sap.userName.toLowerCase(),
      });
      if (mapped === true) isSuperUser = true;
    } catch { /* ignore */ }
    if (!isSuperUser && sap.userName.toLowerCase() === "manager") isSuperUser = true;
  }

  return { identity, cloudUserId, email, isCloudAdmin, isSuperUser };
}

/* ─────────────── Ownership resolution from path ─────────────── */

type Owned =
  | { kind: "expense"; row: Record<string, unknown> }
  | { kind: "advance"; row: Record<string, unknown> };

function parsePathScope(filePath: string): { kind: "expense" | "advance"; id: string } | null {
  const clean = filePath.replace(/^\/+/, "");
  if (clean.startsWith("advances/")) {
    const id = clean.split("/")[1];
    if (id) return { kind: "advance", id };
    return null;
  }
  const id = clean.split("/")[0];
  if (id) return { kind: "expense", id };
  return null;
}

async function loadOwnedByPath(admin: SupabaseClient, filePath: string): Promise<Owned | { error: string; status: number }> {
  const scope = parsePathScope(filePath);
  if (!scope) return { error: "file_path inválido", status: 400 };
  if (scope.kind === "expense") {
    const { data, error } = await admin.from("expenses").select("*").eq("id", scope.id).maybeSingle();
    if (error) return { error: error.message, status: 500 };
    if (!data) return { error: "Despesa não encontrada", status: 404 };
    return { kind: "expense", row: data as Record<string, unknown> };
  }
  const { data, error } = await admin.from("advance_payments").select("*").eq("id", scope.id).maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Adiantamento não encontrado", status: 404 };
  return { kind: "advance", row: data as Record<string, unknown> };
}

function canWriteOwned(caller: Caller, owned: Owned): boolean {
  if (caller.isCloudAdmin || caller.isSuperUser) return true;
  const row = owned.row;
  if (owned.kind === "expense") {
    return (
      callerMatches(caller.identity || "", row.requester_email) ||
      callerMatches(caller.identity || "", row.requester_name) ||
      callerMatches(caller.identity || "", row.created_by_email)
    );
  }
  // advance
  if (caller.cloudUserId && row.requester_id === caller.cloudUserId) return true;
  return (
    callerMatches(caller.identity || "", row.requester_email) ||
    callerMatches(caller.identity || "", row.requester_name)
  );
}

function canReadOwned(caller: Caller, owned: Owned): boolean {
  if (canWriteOwned(caller, owned)) return true;
  const row = owned.row;
  if (owned.kind === "expense") {
    // Approvers of the current level should also be able to open attachments.
    if (callerMatches(caller.identity || "", row.current_approver)) return true;
  }
  return false;
}

/* ─────────────── Actions ─────────────── */

async function actionUpload(admin: SupabaseClient, caller: Caller, req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: "multipart/form-data inválido" });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json(400, { error: "file é obrigatório" });
  if (file.size <= 0) return json(400, { error: "arquivo vazio" });
  if (file.size > MAX_UPLOAD_BYTES) {
    return json(413, { error: `arquivo excede o limite de ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB` });
  }

  const expenseId = String(form.get("expense_id") || "").trim();
  const advanceId = String(form.get("advance_id") || "").trim();
  if (!expenseId && !advanceId) return json(400, { error: "expense_id ou advance_id é obrigatório" });
  if (expenseId && advanceId) return json(400, { error: "informe apenas um: expense_id OU advance_id" });

  // Load target and enforce ownership.
  let owned: Owned;
  if (expenseId) {
    const r = await loadOwnedByPath(admin, `${expenseId}/probe`);
    if ("error" in r) return json(r.status, { error: r.error });
    owned = r;
  } else {
    const r = await loadOwnedByPath(admin, `advances/${advanceId}/probe`);
    if ("error" in r) return json(r.status, { error: r.error });
    owned = r;
  }
  if (!canWriteOwned(caller, owned)) {
    return json(403, { error: "Você não pode anexar arquivos a este documento" });
  }

  const safeName = (file.name || "arquivo").replace(/[^\w.\-]+/g, "_");
  const path = expenseId
    ? `${expenseId}/${Date.now()}_${safeName}`
    : `advances/${advanceId}/${Date.now()}_${safeName}`;
  const contentType = file.type || "application/octet-stream";

  const arrayBuf = await file.arrayBuffer();
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, new Uint8Array(arrayBuf), {
    contentType,
    upsert: false,
  });
  if (upErr) return json(500, { error: `Falha no upload: ${upErr.message}` });

  return json(200, {
    ok: true,
    file_path: path,
    file_name: file.name,
    file_size: file.size,
    mime_type: contentType,
  });
}

async function actionSign(admin: SupabaseClient, caller: Caller, body: any) {
  const filePath = String(body?.file_path || "").trim();
  if (!filePath) return json(400, { error: "file_path é obrigatório" });

  const owned = await loadOwnedByPath(admin, filePath);
  if ("error" in owned) return json(owned.status, { error: owned.error });
  if (!canReadOwned(caller, owned)) {
    return json(403, { error: "Sem permissão para abrir este anexo" });
  }

  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(filePath, SIGN_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    return json(500, { error: error?.message || "Falha ao gerar URL assinada" });
  }
  return json(200, { ok: true, signed_url: data.signedUrl, expires_in: SIGN_TTL_SECONDS });
}

async function actionRemove(admin: SupabaseClient, caller: Caller, body: any) {
  const filePath = String(body?.file_path || "").trim();
  if (!filePath) return json(400, { error: "file_path é obrigatório" });

  const owned = await loadOwnedByPath(admin, filePath);
  if ("error" in owned) return json(owned.status, { error: owned.error });
  if (!canWriteOwned(caller, owned)) {
    return json(403, { error: "Sem permissão para remover este anexo" });
  }

  const { error } = await admin.storage.from(BUCKET).remove([filePath]);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
}

/* ─────────────── HTTP entry ─────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let caller: Caller;
  try {
    caller = await identifyCaller(req, admin);
  } catch (e) {
    if (e instanceof AuthError) return json(e.status, { error: e.message });
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
  if (!caller.identity && !caller.isCloudAdmin) {
    return json(401, { error: "Não autenticado (SAP session ou Cloud admin necessário)" });
  }

  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.includes("multipart/form-data")) {
      return await actionUpload(admin, caller, req);
    }
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    switch (action) {
      case "upload":  return json(400, { error: "upload requer multipart/form-data" });
      case "sign":    return await actionSign(admin, caller, body);
      case "remove":  return await actionRemove(admin, caller, body);
      default:        return json(400, { error: `Ação desconhecida: ${action}` });
    }
  } catch (e) {
    console.error("[expense-attachment-storage] error", e);
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
