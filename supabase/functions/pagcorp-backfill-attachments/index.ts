// Backfill de anexos PagCorp em documentos SAP já integrados sem AttachmentEntry.
// Percorre pagcorp_integration_log filtrando linhas com sap_doc_entry NOT NULL e
// sem AttachmentEntry no sap_payload; baixa os recibos de pagcorp_data, faz upload
// via SAP /Attachments2 e PATCH no documento (endpoint configurado em
// synapse_integrations.parameters.sap_endpoint) para gravar o AttachmentEntry.
//
// POST body: { company_db?: string, log_ids?: string[], limit?: number, dry_run?: boolean }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireUser, AuthError } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface SapSession { baseUrl: string; cookies: string }

async function loginSap(supabase: any, companyDb: string): Promise<SapSession> {
  const { data, error } = await supabase
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (error) throw new Error(`credenciais SAP: ${error.message}`);
  if (!data?.length) throw new Error(`credenciais SAP não configuradas para ${companyDb}`);
  const c: Record<string, string> = {};
  for (const r of data) c[r.credential_key] = r.credential_value;
  let baseUrl = (c.service_layer_url || c.base_url || c.url || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("URL SAP não configurada");
  if (baseUrl.includes("/b1s/v1")) baseUrl = baseUrl.replace("/b1s/v1", "/b1s/v2");
  else if (!baseUrl.includes("/b1s/v2")) baseUrl = `${baseUrl}/b1s/v2`;
  const res = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      CompanyDB: c.company_db || c.CompanyDB || companyDb,
      UserName: c.username || c.UserName,
      Password: c.password || c.Password,
    }),
  });
  if (!res.ok) throw new Error(`SAP login falhou HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { baseUrl, cookies: res.headers.get("set-cookie") || "" };
}

function extFromContentType(ct: string | null): string {
  const c = (ct || "").toLowerCase().split(";")[0].trim();
  const map: Record<string, string> = {
    "application/pdf": "pdf", "image/jpeg": "jpg", "image/jpg": "jpg",
    "image/png": "png", "image/gif": "gif", "image/webp": "webp",
    "image/heic": "heic", "image/heif": "heif",
    "application/xml": "xml", "text/xml": "xml",
    "application/zip": "zip", "text/plain": "txt",
  };
  return map[c] || "";
}
function extFromUrl(u: string): string {
  try {
    const m = new URL(u).pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
    return m ? m[1].toLowerCase() : "";
  } catch { return ""; }
}
function ensureFilename(raw: string | undefined, idx: number, url: string, ct: string | null): string {
  const base = (raw || `recibo_${idx}`).trim().replace(/[\r\n\t]/g, "").replace(/[\\/]+/g, "_");
  if (/\.[a-zA-Z0-9]{2,5}$/.test(base)) return base;
  return `${base}.${extFromUrl(url) || extFromContentType(ct) || "pdf"}`;
}
function collectReceiptUrls(receipts: any[]): { url: string; name?: string }[] {
  const out: { url: string; name?: string }[] = [];
  const seen = new Set<string>();
  const push = (u: unknown, n?: unknown) => {
    if (typeof u !== "string" || !u || seen.has(u)) return;
    seen.add(u); out.push({ url: u, name: typeof n === "string" ? n : undefined });
  };
  for (const r of receipts || []) {
    if (!r) continue;
    if (Array.isArray(r.files)) {
      for (const f of r.files) {
        if (typeof f === "string") push(f);
        else if (f && typeof f === "object") push(f.url || f.fileUrl || f.link, f.fileName || f.name);
      }
    }
    push(r.url || r.fileUrl || r.link || r.downloadUrl || r.receiptUrl || r.imageUrl || r?.file?.url, r.fileName || r.name);
  }
  return out;
}
async function downloadReceipts(receipts: any[]): Promise<{ name: string; blob: Blob }[]> {
  const files: { name: string; blob: Blob }[] = [];
  for (const src of collectReceiptUrls(receipts)) {
    try {
      const res = await fetch(src.url);
      if (!res.ok) { console.warn(`recibo ${src.url}: HTTP ${res.status}`); continue; }
      const blob = await res.blob();
      files.push({ name: ensureFilename(src.name, files.length + 1, src.url, res.headers.get("content-type")), blob });
    } catch (e) { console.warn(`erro baixando ${src.url}`, e); }
  }
  return files;
}
async function uploadAttachments(sap: SapSession, files: { name: string; blob: Blob }[]): Promise<number | null> {
  if (!files.length) return null;
  const form = new FormData();
  for (const f of files) form.append("files", f.blob, f.name);
  const res = await fetch(`${sap.baseUrl}/Attachments2`, { method: "POST", headers: { Cookie: sap.cookies }, body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Attachments2 HTTP ${res.status}: ${body?.error?.message?.value || JSON.stringify(body)}`);
  const absoluteEntry: number | null = body.AbsoluteEntry ?? null;
  if (absoluteEntry != null) {
    try {
      const lines = Array.isArray(body?.Attachments2_Lines) ? body.Attachments2_Lines : [];
      const patchLines = lines.length > 0
        ? lines.map((l: { Line?: number }, idx: number) => ({
            Line: typeof l?.Line === "number" ? l.Line : idx,
            CopyToTargetDocument: "tYES",
          }))
        : files.map((_, idx) => ({ Line: idx, CopyToTargetDocument: "tYES" }));
      const patchRes = await fetch(`${sap.baseUrl}/Attachments2(${absoluteEntry})`, {
        method: "PATCH",
        headers: { Cookie: sap.cookies, "Content-Type": "application/json" },
        body: JSON.stringify({ Attachments2_Lines: patchLines }),
      });
      if (!patchRes.ok) {
        const txt = await patchRes.text().catch(() => "");
        console.warn(`Attachments2 PATCH CopyToTargetDocument falhou [${patchRes.status}]: ${txt.slice(0, 200)}`);
      }
    } catch (e) {
      console.warn("Attachments2 PATCH CopyToTargetDocument erro:", (e as Error).message);
    }
  }
  return absoluteEntry;
}
async function patchDocumentAttachment(sap: SapSession, endpoint: string, docEntry: number, attachmentEntry: number): Promise<void> {
  const res = await fetch(`${sap.baseUrl}/${endpoint}(${docEntry})`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: sap.cookies },
    body: JSON.stringify({ AttachmentEntry: attachmentEntry }),
  });
  if (res.status === 204 || res.ok) return;
  const body = await res.text().catch(() => "");
  throw new Error(`PATCH ${endpoint}(${docEntry}) HTTP ${res.status}: ${body.slice(0, 300)}`);
}
async function logoutSap(sap: SapSession) {
  try { await fetch(`${sap.baseUrl}/Logout`, { method: "POST", headers: { Cookie: sap.cookies } }); } catch { /* ignore */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Admin auth: aceita JWT com role=service_role (backfill via ops) ou usuário Cloud com role admin.
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  let isServiceRole = false;
  if (bearer) {
    try {
      const parts = bearer.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(
          atob(parts[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(parts[1].length + (4 - parts[1].length % 4) % 4, "=")),
        );
        if (payload?.role === "service_role") isServiceRole = true;
      }
    } catch { /* ignore */ }
  }
  if (!isServiceRole) {
    try {
      const u = await requireUser(req);
      const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: u.id, _role: "admin" });
      if (!isAdmin) return json(403, { error: "admin required" });
    } catch (e) {
      if (e instanceof AuthError) return json(e.status, { error: e.message });
      return json(500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  const body = await req.json().catch(() => ({}));
  const companyDbFilter: string | undefined = body.company_db || undefined;
  const logIdsFilter: string[] | undefined = Array.isArray(body.log_ids) ? body.log_ids : undefined;
  const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);
  const dryRun = body.dry_run === true;

  let q = supabase
    .from("pagcorp_integration_log")
    .select("id, company_db, sap_doc_entry, sap_payload, sap_response, pagcorp_data, integration_type")
    .not("sap_doc_entry", "is", null);
  if (companyDbFilter) q = q.eq("company_db", companyDbFilter);
  if (logIdsFilter?.length) q = q.in("id", logIdsFilter);
  const { data: rows, error: rowsErr } = await q.order("created_at", { ascending: false }).limit(limit);
  if (rowsErr) return json(500, { error: rowsErr.message });

  // Só ficam de fora as linhas em que o PurchaseOrder no SAP já reflete o vínculo
  // (sap_response.purchase_order.AttachmentEntry populado).
  function existingAttachment(r: any): number | null {
    const resp = r.sap_response || {};
    const po = resp.purchase_order || {};
    // 1) attachment já vinculado no doc SAP (retornado pelo POST)
    if (typeof po.AttachmentEntry === "number" && po.AttachmentEntry > 0) return null;
    // 2) attachment já subido para SAP mas não vinculado ao doc → reutilizar
    if (typeof resp.attachmentEntry === "number" && resp.attachmentEntry > 0) return resp.attachmentEntry;
    return null;
  }
  function alreadyLinked(r: any): boolean {
    const resp = r.sap_response || {};
    const po = resp.purchase_order || {};
    return typeof po.AttachmentEntry === "number" && po.AttachmentEntry > 0;
  }
  const targets = (rows || []).filter((r: any) => !alreadyLinked(r));

  // resolve endpoint per company_db (fallback PurchaseInvoices)
  const companies = Array.from(new Set(targets.map((r: any) => r.company_db)));
  const endpointByCompany: Record<string, string> = {};
  if (companies.length) {
    const { data: cfg } = await supabase
      .from("synapse_integrations")
      .select("company_db, parameters")
      .eq("integration_key", "pagcorp_erp_sync")
      .in("company_db", companies);
    for (const c of (cfg || []) as any[]) {
      endpointByCompany[c.company_db] = String(c.parameters?.sap_endpoint || "PurchaseInvoices");
    }
  }

  if (dryRun) {
    return json(200, {
      dry_run: true,
      candidates: targets.map((r: any) => ({
        id: r.id, company_db: r.company_db, sap_doc_entry: r.sap_doc_entry,
        endpoint: endpointByCompany[r.company_db] || "PurchaseInvoices",
        existing_attachment_entry: existingAttachment(r),
        receipt_count: collectReceiptUrls(r.pagcorp_data?.receipts || []).length,
      })),
      total: targets.length,
    });
  }

  // group by company to reuse SAP session
  const byCompany: Record<string, any[]> = {};
  for (const r of targets) (byCompany[r.company_db] ||= []).push(r);

  const results: any[] = [];
  for (const [companyDb, list] of Object.entries(byCompany)) {
    let sap: SapSession | null = null;
    try {
      sap = await loginSap(supabase, companyDb);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      for (const r of list) results.push({ id: r.id, company_db: companyDb, ok: false, error: `login: ${msg}` });
      continue;
    }
    const endpoint = endpointByCompany[companyDb] || "PurchaseInvoices";
    for (const r of list) {
      try {
        let attachmentEntry: number | null = existingAttachment(r);
        let filesCount = 0;
        let source: "reused" | "uploaded" = "reused";
        if (attachmentEntry == null) {
          const receipts = r.pagcorp_data?.receipts || [];
          const files = await downloadReceipts(receipts);
          if (!files.length) {
            results.push({ id: r.id, company_db: companyDb, sap_doc_entry: r.sap_doc_entry, ok: false, skipped: "sem recibos" });
            continue;
          }
          filesCount = files.length;
          attachmentEntry = await uploadAttachments(sap, files);
          source = "uploaded";
        }
        if (attachmentEntry == null) throw new Error("Attachments2 sem AbsoluteEntry");
        await patchDocumentAttachment(sap, endpoint, Number(r.sap_doc_entry), attachmentEntry);

        // update sap_payload/sap_response to reflect the added AttachmentEntry
        const patched = { ...(r.sap_payload || {}) };
        if (patched.purchase_order && typeof patched.purchase_order === "object") {
          patched.purchase_order = { ...patched.purchase_order, AttachmentEntry: attachmentEntry };
        }
        patched.AttachmentEntry = attachmentEntry;
        patched.attachment_backfilled_at = new Date().toISOString();
        const patchedResp = { ...(r.sap_response || {}) };
        if (patchedResp.purchase_order && typeof patchedResp.purchase_order === "object") {
          patchedResp.purchase_order = { ...patchedResp.purchase_order, AttachmentEntry: attachmentEntry };
        }
        patchedResp.attachmentEntry = attachmentEntry;
        patchedResp.attachment_backfilled_at = new Date().toISOString();

        await supabase.from("pagcorp_integration_log")
          .update({ sap_payload: patched, sap_response: patchedResp, updated_at: new Date().toISOString() })
          .eq("id", r.id);

        results.push({
          id: r.id, company_db: companyDb, sap_doc_entry: r.sap_doc_entry,
          endpoint, attachment_entry: attachmentEntry, files: filesCount, source, ok: true,
        });
      } catch (e) {
        results.push({
          id: r.id, company_db: companyDb, sap_doc_entry: r.sap_doc_entry, ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    await logoutSap(sap);
  }

  return json(200, {
    total: targets.length,
    success: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  });
});
