// Edge function: backfill missing due_date on expenses by re-running the
// attachments through the AI extractor. Two modes:
//
//   POST { action: "one",   expense_id }
//   POST { action: "batch", company_db?, limit? }   (admin only)
//
// For each target expense (status = 'pendente_aprovacao' and due_date IS NULL)
// we fetch its attachments from the `expense-attachments` bucket, send them to
// the Lovable AI gateway asking ONLY for `due_date` / `document_date`, and
// UPDATE the expense with the extracted values.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { validateSapSession, requireUser, AuthError } from "../_shared/auth.ts";

const BUCKET = "expense-attachments";

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
function isOwner(caller: string, exp: Record<string, unknown>): boolean {
  const c = normalize(caller);
  if (!c) return false;
  const cp = emailPrefix(c);
  return [exp.requester_email, exp.requester_name, exp.created_by_email]
    .map(normalize)
    .some((v) => v && (v === c || emailPrefix(v) === cp));
}

interface Caller {
  identity: string | null;
  email: string | null;
  isCloudAdmin: boolean;
  isSuperUser: boolean;
}

async function identifyCaller(req: Request, admin: SupabaseClient): Promise<Caller> {
  let identity: string | null = null;
  let email: string | null = null;
  let isCloudAdmin = false;
  let isSuperUser = false;

  try {
    const u = await requireUser(req);
    email = u.email || null;
    identity = u.email || null;
    const { data } = await admin.rpc("has_role", { _user_id: u.id, _role: "admin" });
    if (data === true) isCloudAdmin = true;
  } catch (e) { if (!(e instanceof AuthError)) throw e; }

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
  return { identity, email, isCloudAdmin, isSuperUser };
}

const EXTRACT_PROMPT = `Você é um assistente que lê documentos fiscais (NF, boleto, invoice) — em português, inglês ou espanhol — e devolve APENAS um JSON com estas chaves:

{
  "document_date": "YYYY-MM-DD ou null (data de emissão)",
  "due_date": "YYYY-MM-DD ou null (data de vencimento; se não houver mas houver document_date, calcule document_date + 30 dias)"
}

Regras:
- Responda somente com JSON válido, sem markdown, sem explicações.
- Datas sempre no formato YYYY-MM-DD.
- Se realmente não conseguir determinar, retorne null no campo.`;

async function extractDatesFromFiles(
  files: { name: string; mime: string; bytes: Uint8Array }[],
): Promise<{ document_date: string | null; due_date: string | null }> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const contentParts: any[] = [];
  for (const f of files) {
    const isPdf = f.name.toLowerCase().endsWith(".pdf") || f.mime === "application/pdf";
    const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(f.name) || f.mime.startsWith("image/");
    if (isPdf || isImage) {
      let binaryString = "";
      const CHUNK = 8192;
      for (let i = 0; i < f.bytes.length; i += CHUNK) {
        const chunk = f.bytes.subarray(i, Math.min(i + CHUNK, f.bytes.length));
        binaryString += String.fromCharCode.apply(null, Array.from(chunk));
      }
      const base64 = btoa(binaryString);
      const mimeType = isPdf ? "application/pdf" : (f.mime || "image/jpeg");
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${base64}` },
      });
    } else {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(f.bytes);
      contentParts.push({
        type: "text",
        text: `[Arquivo: ${f.name}]\n${text.substring(0, 15000)}`,
      });
    }
  }
  contentParts.push({
    type: "text",
    text: "Extraia as datas conforme instruído e devolva apenas o JSON.",
  });

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: EXTRACT_PROMPT },
        { role: "user", content: contentParts },
      ],
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Falha na IA (${resp.status}): ${t.slice(0, 300)}`);
  }
  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  let parsed: any;
  try { parsed = JSON.parse(cleaned); } catch { parsed = {}; }
  const out = Array.isArray(parsed) ? parsed[0] : parsed;
  const iso = (v: unknown) => {
    const s = String(v ?? "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  return {
    document_date: iso(out?.document_date),
    due_date: iso(out?.due_date),
  };
}

async function processOne(admin: SupabaseClient, expenseId: string) {
  const { data: exp, error } = await admin
    .from("expenses")
    .select("id, status, doc_date, due_date, company_db, requester_email, requester_name, created_by_email")
    .eq("id", expenseId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!exp) return { ok: false, error: "Despesa não encontrada" };
  if (exp.due_date) return { ok: true, skipped: "já possui data de vencimento" };

  const { data: atts, error: aerr } = await admin
    .from("expense_attachments")
    .select("file_path, file_name, mime_type")
    .eq("expense_id", expenseId);
  if (aerr) return { ok: false, error: `Falha ao listar anexos: ${aerr.message}` };
  if (!atts || atts.length === 0) return { ok: false, error: "Nenhum anexo encontrado para reprocessar" };

  const files: { name: string; mime: string; bytes: Uint8Array }[] = [];
  for (const a of atts) {
    const { data: blob, error: derr } = await admin.storage.from(BUCKET).download(a.file_path);
    if (derr || !blob) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    files.push({ name: a.file_name || "file", mime: a.mime_type || "application/octet-stream", bytes });
  }
  if (files.length === 0) return { ok: false, error: "Não foi possível baixar os anexos" };

  const extracted = await extractDatesFromFiles(files);
  if (!extracted.due_date) {
    return { ok: false, error: "IA não conseguiu determinar a data de vencimento" };
  }

  const updates: Record<string, unknown> = { due_date: extracted.due_date };
  if (!exp.doc_date && extracted.document_date) updates.doc_date = extracted.document_date;

  const { error: uerr } = await admin.from("expenses").update(updates).eq("id", expenseId);
  if (uerr) return { ok: false, error: `Falha ao atualizar: ${uerr.message}` };

  await admin.rpc("insert_audit_log", {
    p_action: "backfill_due_date",
    p_entity_type: "expense",
    p_entity_id: expenseId,
    p_actor_email: null,
    p_company_db: exp.company_db || null,
    p_details: updates as any,
  });

  return { ok: true, updated: updates };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: any = {};
  try { body = await req.json(); } catch { return json(400, { error: "Corpo inválido" }); }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let caller: Caller;
  try { caller = await identifyCaller(req, admin); }
  catch (e) {
    if (e instanceof AuthError) return json(e.status, { error: e.message });
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
  if (!caller.identity && !caller.isCloudAdmin) {
    return json(401, { error: "Não autenticado" });
  }

  const action = String(body?.action || "one");
  const isPrivileged = caller.isCloudAdmin || caller.isSuperUser;

  try {
    if (action === "one") {
      const expenseId = String(body?.expense_id || "");
      if (!expenseId) return json(400, { error: "expense_id é obrigatório" });

      if (!isPrivileged) {
        const { data: exp } = await admin.from("expenses").select("*").eq("id", expenseId).maybeSingle();
        if (!exp) return json(404, { error: "Despesa não encontrada" });
        if (!isOwner(caller.identity || "", exp as any)) {
          return json(403, { error: "Sem permissão para reprocessar esta despesa" });
        }
      }

      const res = await processOne(admin, expenseId);
      return json(res.ok ? 200 : 400, res);
    }

    if (action === "batch") {
      if (!isPrivileged) return json(403, { error: "Apenas administradores" });
      const companyDb = body?.company_db ? String(body.company_db) : null;
      const limit = Math.min(50, Math.max(1, Number(body?.limit) || 20));

      let q = admin
        .from("expenses")
        .select("id")
        .eq("status", "pendente_aprovacao")
        .is("due_date", null)
        .limit(limit);
      if (companyDb) q = q.eq("company_db", companyDb);
      const { data: rows, error } = await q;
      if (error) return json(500, { error: error.message });

      const results: any[] = [];
      for (const r of rows || []) {
        try {
          const res = await processOne(admin, (r as any).id);
          results.push({ expense_id: (r as any).id, ...res });
        } catch (e) {
          results.push({ expense_id: (r as any).id, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const updated = results.filter((r) => r.ok && r.updated).length;
      return json(200, { ok: true, processed: results.length, updated, results });
    }

    return json(400, { error: `Ação desconhecida: ${action}` });
  } catch (e) {
    console.error("[expense-backfill-due-date]", e);
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
