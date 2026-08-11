// Backfill de anexos em documentos já integrados ao SAP.
//
// Regra de negócio: um pedido já integrado ao ERP não pode mais ser editado
// (nenhum campo, nenhum anexo removido). A ÚNICA exceção é ADICIONAR anexos
// enquanto a NF de entrada ainda não foi lançada — neste caso os arquivos são
// enviados ao SAP (Attachments2) e vinculados ao documento existente.
//
// POST { expense_id, attachment_ids?: string[] }

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { ensureCopyToTargetDocument } from "../_shared/sap-attach-copy.ts";
import { validateSapSession, requireUser, AuthError } from "../_shared/auth.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import { sanitizeSapFileName } from "../_shared/sap-filename.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Status em que a NF de entrada já foi lançada (ou o doc não vale mais). */
const BLOCKED_STATUSES = new Set(["nf_entrada", "pagamento", "finalizado", "cancelado", "rejeitado"]);

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
function isOwner(caller: string, expense: Record<string, unknown>): boolean {
  const c = normalize(caller);
  if (!c) return false;
  const cp = emailPrefix(c);
  return [expense.requester_email, expense.requester_name, expense.created_by_email]
    .map((x) => normalize(x))
    .some((v) => v && (v === c || emailPrefix(v) === cp));
}

async function identifyCaller(req: Request, admin: SupabaseClient) {
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

  return { identity, email, isCloudAdmin, isSuperUser };
}

function getSapBaseUrl(creds: Record<string, string>) {
  let baseUrl = (creds.service_layer_url || creds.base_url || creds.url || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("URL do SAP B1 não configurada");
  if (baseUrl.includes("/b1s/v1")) baseUrl = baseUrl.replace("/b1s/v1", "/b1s/v2");
  else if (!baseUrl.includes("/b1s/v2")) baseUrl = `${baseUrl}/b1s/v2`;
  return baseUrl;
}

async function loginSap(creds: Record<string, string>, companyDb: string) {
  const baseUrl = getSapBaseUrl(creds);
  const user = creds.username || creds.user_name || creds.api_user || "";
  const pass = creds.password || creds.api_password || "";
  const db = creds.company_db || companyDb;
  if (!user || !pass || !db) throw new Error("Credenciais de integração (Apiuser) não configuradas para esta empresa.");
  const res = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: user, Password: pass, CompanyDB: db }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Falha no login SAP [${res.status}]: ${t.slice(0, 200)}`);
  }
  const setCookie = res.headers.get("set-cookie") || "";
  const sid = setCookie.match(/B1SESSION=([^;]+)/)?.[1];
  const rid = setCookie.match(/ROUTEID=([^;]+)/)?.[1];
  if (!sid) throw new Error("SAP não retornou B1SESSION no login.");
  const cookies = `B1SESSION=${sid}${rid ? `; ROUTEID=${rid}` : ""}`;
  return { baseUrl, cookies };
}

/** Marca todas as linhas do anexo para copiar ao documento de destino. */

Deno.serve(async (req) => {
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let caller;
  try {
    caller = await identifyCaller(req, admin);
  } catch (e) {
    if (e instanceof AuthError) return json(e.status, { error: e.message });
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
  if (!caller.identity && !caller.isCloudAdmin) return json(401, { error: "Não autenticado" });

  const body = await req.json().catch(() => ({}));
  const expenseId = String(body?.expense_id || "").trim();
  const attachmentIds: string[] = Array.isArray(body?.attachment_ids) ? body.attachment_ids.map(String) : [];
  if (!expenseId) return json(400, { error: "expense_id é obrigatório" });

  const { data: expense, error: expErr } = await admin
    .from("expenses").select("*").eq("id", expenseId).maybeSingle();
  if (expErr) return json(500, { error: expErr.message });
  if (!expense) return json(404, { error: "Despesa não encontrada" });

  const isPrivileged = caller.isCloudAdmin || caller.isSuperUser;
  if (!isPrivileged && !isOwner(caller.identity || "", expense as any)) {
    return json(403, { error: "Você não pode anexar arquivos a este documento" });
  }

  const docEntry = Number((expense as any).sap_doc_entry || 0);
  if (!docEntry) return json(409, { error: "Documento ainda não integrado ao ERP." });
  if (BLOCKED_STATUSES.has(String((expense as any).status))) {
    return json(409, { error: "NF de entrada já lançada (ou documento encerrado) — anexos não podem mais ser adicionados." });
  }

  // Bloqueia também quando existe NF de entrada vinculada já lançada no ERP.
  const { data: nfRows } = await admin
    .from("nf_entrada_imports")
    .select("id, status, sap_invoice_draft_id")
    .eq("expense_id", expenseId);
  const nfPosted = (nfRows || []).some((r: any) =>
    r.sap_invoice_draft_id || ["awaiting_invoice", "completed"].includes(String(r.status)));
  if (nfPosted) {
    return json(409, { error: "NF de entrada já lançada para este pedido — anexos não podem mais ser adicionados." });
  }

  const companyDb = String((expense as any).company_db || "");
  const { data: credRows, error: credErr } = await admin
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (credErr) return json(500, { error: `Erro credenciais SAP: ${credErr.message}` });
  const creds: Record<string, string> = {};
  for (const r of credRows || []) creds[(r as any).credential_key] = (r as any).credential_value;
  if (!Object.keys(creds).length) return json(409, { error: `Credenciais SAP não configuradas para ${companyDb}` });
  if ((creds.integrate_attachments || "").toLowerCase() !== "true") {
    return json(200, { ok: true, skipped: "integração de anexos desativada para esta empresa" });
  }

  // Arquivos a enviar: os informados, ou todos ainda não sincronizados.
  let q = admin.from("expense_attachments").select("id, file_path, file_name").eq("expense_id", expenseId);
  if (attachmentIds.length) q = q.in("id", attachmentIds);
  const { data: atts, error: attErr } = await q;
  if (attErr) return json(500, { error: attErr.message });
  if (!atts?.length) return json(200, { ok: true, uploaded: 0 });

  const files: { name: string; blob: Blob }[] = [];
  for (const a of atts as any[]) {
    const { data: blob, error: dlErr } = await admin.storage.from("expense-attachments").download(a.file_path);
    if (dlErr || !blob) { console.warn(`Falha ao baixar ${a.file_path}: ${dlErr?.message}`); continue; }
    files.push({ name: a.file_name || "anexo", blob });
  }
  if (!files.length) return json(500, { error: "Nenhum arquivo pôde ser lido do armazenamento" });

  const endpoint = (expense as any).doc_type === "sales" ? "Orders" : "PurchaseOrders";
  let sap: { baseUrl: string; cookies: string } | null = null;
  try {
    sap = await loginSap(creds, companyDb);

    // Anexo já existente no documento → adiciona os arquivos à mesma entrada.
    const getRes = await fetch(`${sap.baseUrl}/${endpoint}(${docEntry})?$select=AttachmentEntry`, {
      headers: { Cookie: sap.cookies },
    });
    const getBody = await getRes.json().catch(() => ({}));
    if (!getRes.ok) {
      throw new Error(`Consulta ${endpoint}(${docEntry}) falhou [${getRes.status}]: ${getBody?.error?.message?.value || ""}`);
    }
    const existingEntry = Number(getBody?.AttachmentEntry) > 0 ? Number(getBody.AttachmentEntry) : null;

    const form = new FormData();
    for (const f of files) form.append("files", f.blob, sanitizeSapFileName(f.name));

    let absoluteEntry: number;
    if (existingEntry) {
      const res = await fetch(`${sap.baseUrl}/Attachments2(${existingEntry})`, {
        method: "PATCH",
        headers: { Cookie: sap.cookies },
        body: form,
      });
      if (!res.ok && res.status !== 204) {
        const t = await res.text().catch(() => "");
        throw new Error(`Falha ao adicionar arquivos ao anexo ${existingEntry} [${res.status}]: ${t.slice(0, 300)}`);
      }
      absoluteEntry = existingEntry;
      const after = await fetch(`${sap.baseUrl}/Attachments2(${existingEntry})`, { headers: { Cookie: sap.cookies } });
      const afterBody = await after.json().catch(() => ({}));
      await ensureCopyToTargetDocument(sap.baseUrl, sap.cookies, absoluteEntry, afterBody, files.length);
    } else {
      const res = await fetch(`${sap.baseUrl}/Attachments2`, {
        method: "POST",
        headers: { Cookie: sap.cookies },
        body: form,
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(`Attachments2 [${res.status}]: ${resBody?.error?.message?.value || JSON.stringify(resBody).slice(0, 300)}`);
      }
      absoluteEntry = Number(resBody?.AbsoluteEntry);
      if (!absoluteEntry) throw new Error("SAP não retornou AbsoluteEntry do anexo");
      await ensureCopyToTargetDocument(sap.baseUrl, sap.cookies, absoluteEntry, resBody, files.length);

      const patchRes = await fetch(`${sap.baseUrl}/${endpoint}(${docEntry})`, {
        method: "PATCH",
        headers: { Cookie: sap.cookies, "Content-Type": "application/json" },
        body: JSON.stringify({ AttachmentEntry: absoluteEntry }),
      });
      if (!patchRes.ok && patchRes.status !== 204) {
        const t = await patchRes.text().catch(() => "");
        throw new Error(`Vínculo do anexo em ${endpoint}(${docEntry}) falhou [${patchRes.status}]: ${t.slice(0, 300)}`);
      }
    }

    await admin.from("expenses").update({
      sap_attachment_entry: absoluteEntry,
      sap_attachment_status: "success",
    }).eq("id", expenseId);

    await admin.from("expense_approval_log").insert({
      expense_id: expenseId,
      decision: "integrated",
      approver_name: caller.identity,
      approver_email: caller.email,
      remarks: `Anexo(s) adicionado(s) ao documento ${endpoint}(${docEntry}) no SAP: ${files.map((f) => f.name).join(", ")}`,
    } as any);

    return json(200, { ok: true, uploaded: files.length, attachmentEntry: absoluteEntry, docEntry });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[expense-attachment-sap-backfill]", msg);
    return json(502, { error: msg });
  } finally {
    if (sap) {
      try { await fetch(`${sap.baseUrl}/Logout`, { method: "POST", headers: { Cookie: sap.cookies } }); } catch { /* ignore */ }
    }
  }
});
