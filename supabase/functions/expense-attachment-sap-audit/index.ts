// Auditoria + patch em lote de anexos de documentos já integrados ao SAP.
//
// Percorre TODAS as empresas com integração de anexos habilitada, confere no
// próprio SAP se o documento (PurchaseOrders/Orders) possui AttachmentEntry e,
// quando não possui e a NF de entrada ainda NÃO foi lançada, sobe os arquivos
// do ERP Flow e vincula ao documento (com CopyToTargetDocument = tYES).
//
// POST { company_db?: string, dry_run?: boolean, limit?: number }
// Somente admins (Cloud) ou super-usuários SAP.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
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
  console.log(`[audit] login SAP ${db} @ ${baseUrl}`);
  const res = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    signal: AbortSignal.timeout(60000),
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
  return { baseUrl, cookies: `B1SESSION=${sid}${rid ? `; ROUTEID=${rid}` : ""}` };
}

async function markCopyToTarget(baseUrl: string, cookies: string, absoluteEntry: number, body: any, count: number) {
  try {
    const lines = Array.isArray(body?.Attachments2_Lines) ? body.Attachments2_Lines : [];
    const patchLines = lines.length > 0
      ? lines.map((l: { Line?: number }, idx: number) => ({
          Line: typeof l?.Line === "number" ? l.Line : idx,
          CopyToTargetDocument: "tYES",
        }))
      : Array.from({ length: count }, (_, idx) => ({ Line: idx, CopyToTargetDocument: "tYES" }));
    const res = await fetch(`${baseUrl}/Attachments2(${absoluteEntry})`, {
      method: "PATCH",
      headers: { Cookie: cookies, "Content-Type": "application/json" },
      body: JSON.stringify({ Attachments2_Lines: patchLines }),
    });
    if (!res.ok) console.warn(`CopyToTargetDocument PATCH falhou [${res.status}]`);
  } catch (e) {
    console.warn("CopyToTargetDocument erro:", (e as Error).message);
  }
}

async function isCallerPrivileged(req: Request, admin: SupabaseClient) {
  try {
    const u = await requireUser(req);
    const { data } = await admin.rpc("has_role", { _user_id: u.id, _role: "admin" });
    if (data === true) return true;
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
  }
  const sap = await validateSapSession(req);
  if (sap) {
    const { data: mapped } = await admin.rpc("is_sap_user_admin", { _sap_username: sap.userName.toLowerCase() });
    if (mapped === true || sap.userName.toLowerCase() === "manager") return true;
  }
  return false;
}

Deno.serve(async (req) => {
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const auditKey = Deno.env.get("ATTACHMENT_AUDIT_KEY") || "";
  const auditKey2 = Deno.env.get("ATTACHMENT_AUDIT_KEY2") || "";
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const provided = req.headers.get("x-internal-key") || "";
  const internal = (!!svcKey && (provided === svcKey || bearer === svcKey)) ||
    (!!auditKey && provided === auditKey) ||
    (!!auditKey2 && provided === auditKey2);
  if (!internal) {
    let ok = false;
    try { ok = await isCallerPrivileged(req, admin); } catch { ok = false; }
    if (!ok) return json(403, { error: "Apenas administradores podem executar a auditoria de anexos." });
  }

  const body = await req.json().catch(() => ({}));
  const onlyCompany = String(body?.company_db || "").trim();
  const dryRun = body?.dry_run !== false; // padrão: simulação
  const limit = Math.min(Number(body?.limit) || 500, 2000);

  // Empresas com credenciais SAP
  const { data: credRows, error: credErr } = await admin
    .from("system_credentials")
    .select("company_db, credential_key, credential_value")
    .eq("system_name", "sap");
  if (credErr) return json(500, { error: credErr.message });
  const byCompany = new Map<string, Record<string, string>>();
  for (const r of credRows || []) {
    const db = String((r as any).company_db || "");
    if (!db) continue;
    if (onlyCompany && db !== onlyCompany) continue;
    const c = byCompany.get(db) || {};
    c[(r as any).credential_key] = (r as any).credential_value;
    byCompany.set(db, c);
  }

  console.log(`[audit] start dry_run=${dryRun} companies=${byCompany.size}`);
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const report: any[] = [];

  const work = async () => {

  for (const [companyDb, creds] of byCompany) {
    const entry: any = { company_db: companyDb, checked: 0, missing: [], patched: [], errors: [] };
    console.log(`[audit] empresa ${companyDb}`);
    if ((creds.integrate_attachments || "").toLowerCase() !== "true") {
      entry.skipped = "integração de anexos desativada";
      report.push(entry);
      continue;
    }

    // Documentos integrados, com anexos no Flow, e ainda sem NF de entrada lançada
    const { data: expenses, error: expErr } = await admin
      .from("expenses")
      .select("id, doc_type, status, sap_doc_entry, sap_doc_num, supplier_name, sap_attachment_entry")
      .eq("company_db", companyDb)
      .not("sap_doc_entry", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (expErr) { entry.errors.push(expErr.message); report.push(entry); continue; }

    const candidates = (expenses || []).filter(
      (e: any) => Number(e.sap_doc_entry) > 0 && !BLOCKED_STATUSES.has(String(e.status)),
    );
    if (!candidates.length) { report.push(entry); continue; }

    const ids = candidates.map((e: any) => e.id);
    const { data: attRows } = await admin
      .from("expense_attachments")
      .select("id, expense_id, file_path, file_name")
      .in("expense_id", ids);
    const attByExpense = new Map<string, any[]>();
    for (const a of attRows || []) {
      const list = attByExpense.get((a as any).expense_id) || [];
      list.push(a);
      attByExpense.set((a as any).expense_id, list);
    }

    const { data: nfRows } = await admin
      .from("nf_entrada_imports")
      .select("expense_id, status, sap_invoice_draft_id")
      .in("expense_id", ids);
    const nfPosted = new Set(
      (nfRows || [])
        .filter((r: any) => r.sap_invoice_draft_id || ["awaiting_invoice", "completed"].includes(String(r.status)))
        .map((r: any) => String(r.expense_id)),
    );

    const todo = candidates.filter((e: any) => (attByExpense.get(e.id) || []).length > 0 && !nfPosted.has(String(e.id)));
    if (!todo.length) { report.push(entry); continue; }

    let sap: { baseUrl: string; cookies: string } | null = null;
    try {
      sap = await loginSap(creds, companyDb);

      for (const exp of todo) {
        const endpoint = exp.doc_type === "sales" ? "Orders" : "PurchaseOrders";
        const docEntry = Number(exp.sap_doc_entry);
        entry.checked++;
        try {
          const getRes = await fetch(`${sap.baseUrl}/${endpoint}(${docEntry})?$select=AttachmentEntry,DocNum`, {
            headers: { Cookie: sap.cookies },
          });
          const getBody = await getRes.json().catch(() => ({}));
          if (!getRes.ok) {
            entry.errors.push(`${endpoint}(${docEntry}): consulta falhou [${getRes.status}]`);
            continue;
          }
          const existingEntry = Number(getBody?.AttachmentEntry) > 0 ? Number(getBody.AttachmentEntry) : 0;
          if (existingEntry) {
            if (Number(exp.sap_attachment_entry || 0) !== existingEntry) {
              await admin.from("expenses")
                .update({ sap_attachment_entry: existingEntry, sap_attachment_status: "success" })
                .eq("id", exp.id);
            }
            continue;
          }

          const info = {
            expense_id: exp.id,
            doc_entry: docEntry,
            doc_num: getBody?.DocNum ?? exp.sap_doc_num,
            supplier: exp.supplier_name,
            status: exp.status,
            attachments: (attByExpense.get(exp.id) || []).length,
          };
          entry.missing.push(info);
          if (dryRun) continue;

          // Baixa arquivos e sobe
          const files: { name: string; blob: Blob }[] = [];
          for (const a of attByExpense.get(exp.id) || []) {
            const { data: blob } = await admin.storage.from("expense-attachments").download(a.file_path);
            if (blob) files.push({ name: a.file_name || "anexo", blob });
          }
          if (!files.length) { entry.errors.push(`${exp.id}: arquivos não encontrados no storage`); continue; }

          const form = new FormData();
          for (const f of files) form.append("files", f.blob, sanitizeSapFileName(f.name));
          const res = await fetch(`${sap.baseUrl}/Attachments2`, { method: "POST", headers: { Cookie: sap.cookies }, body: form });
          const resBody = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(`Attachments2 [${res.status}]: ${resBody?.error?.message?.value || ""}`);
          const absoluteEntry = Number(resBody?.AbsoluteEntry);
          if (!absoluteEntry) throw new Error("SAP não retornou AbsoluteEntry");
          await markCopyToTarget(sap.baseUrl, sap.cookies, absoluteEntry, resBody, files.length);

          const patchRes = await fetch(`${sap.baseUrl}/${endpoint}(${docEntry})`, {
            method: "PATCH",
            headers: { Cookie: sap.cookies, "Content-Type": "application/json" },
            body: JSON.stringify({ AttachmentEntry: absoluteEntry }),
          });
          if (!patchRes.ok && patchRes.status !== 204) {
            const t = await patchRes.text().catch(() => "");
            throw new Error(`Vínculo em ${endpoint}(${docEntry}) falhou [${patchRes.status}]: ${t.slice(0, 200)}`);
          }

          await admin.from("expenses")
            .update({ sap_attachment_entry: absoluteEntry, sap_attachment_status: "success" })
            .eq("id", exp.id);
          await admin.from("expense_approval_log").insert({
            expense_id: exp.id,
            decision: "integrated",
            approver_name: "sistema",
            remarks: `Patch de anexo (auditoria): ${files.length} arquivo(s) enviados ao ${endpoint}(${docEntry}).`,
          } as any);

          entry.patched.push({ ...info, attachment_entry: absoluteEntry });
        } catch (e) {
          entry.errors.push(`${exp.id}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      entry.errors.push((e as Error).message);
    } finally {
      if (sap) { try { await fetch(`${sap.baseUrl}/Logout`, { method: "POST", headers: { Cookie: sap.cookies } }); } catch { /* ignore */ } }
    }

    report.push(entry);
    await admin.from("integration_log").insert({
      system_name: "sap",
      action: "expense-attachment-audit",
      company_db: companyDb,
      status: (entry.errors?.length || 0) > 0 ? "partial" : "success",
      duration_ms: Date.now() - startedAt,
      request_meta: { run_id: runId, dry_run: dryRun, limit },
      response_meta: {
        checked: entry.checked,
        missing: entry.missing,
        patched: entry.patched,
        errors: entry.errors,
        skipped: entry.skipped ?? null,
      },
    } as any);
  }

  const totals = {
    checked: report.reduce((s, r) => s + (r.checked || 0), 0),
    missing: report.reduce((s, r) => s + (r.missing?.length || 0), 0),
    patched: report.reduce((s, r) => s + (r.patched?.length || 0), 0),
    errors: report.reduce((s, r) => s + (r.errors?.length || 0), 0),
  };
  console.log(`[audit] fim ${JSON.stringify(totals)}`);
  await admin.from("integration_log").insert({
    system_name: "sap",
    action: "expense-attachment-audit",
    company_db: onlyCompany || null,
    status: totals.errors > 0 ? "partial" : "success",
    duration_ms: Date.now() - startedAt,
    request_meta: { run_id: runId, dry_run: dryRun, limit },
    response_meta: { totals, companies: report },
  } as any);
  };

  if (body?.wait === true) {
    await work();
  } else {
    // @ts-ignore EdgeRuntime
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work());
    else work();
  }

  return json(202, { ok: true, run_id: runId, dry_run: dryRun, mode: body?.wait === true ? "sync" : "background" });
});
