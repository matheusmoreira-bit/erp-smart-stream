// Edge function: sap-archive-attachments
// Baixa os arquivos de anexo dos documentos já copiados para a base de backup
// e grava no bucket privado `sap-archive`.
//
// POST { company_db, limit?: number }
// Resposta: { done, enumerated, downloaded, failed, pending }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import { ARCHIVE_BUCKET, sapFetchFile, sapGet, sapLogin, sapLogout } from "../_shared/sap-archive.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-company-db, x-scheduler-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TIME_BUDGET_MS = 50_000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;

  const started = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let runId: string | null = null;
  let session: Awaited<ReturnType<typeof sapLogin>> | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const companyDb = String(body?.company_db || "").trim();
    if (!companyDb || !/^[A-Za-z0-9_\-]+$/.test(companyDb)) {
      return json(400, { error: "company_db obrigatório" });
    }

    const { data: runRow } = await sb.from("sap_archive_runs").insert({
      company_db: companyDb, kind: "attachments", status: "running", triggered_by: auth.source,
    }).select("id").single();
    runId = (runRow as any)?.id ?? null;

    session = await sapLogin(sb, companyDb);

    const errors: string[] = [];
    let enumerated = 0;
    let downloaded = 0;
    let failed = 0;

    // 1) Enumera anexos de documentos ainda não processados.
    while (Date.now() - started < TIME_BUDGET_MS / 2) {
      const { data: docs } = await sb
        .from("sap_archive_documents")
        .select("id, doc_type, doc_entry, attachment_entry")
        .eq("company_db", companyDb)
        .not("attachment_entry", "is", null)
        .eq("attachments_total", 0)
        .limit(20);
      const list = (docs || []) as any[];
      if (list.length === 0) break;

      for (const doc of list) {
        try {
          const att = await sapGet(session, `Attachments2(${doc.attachment_entry})`);
          const lines: any[] = Array.isArray(att?.Attachments2_Lines) ? att.Attachments2_Lines : [];
          if (lines.length > 0) {
            const rows = lines.map((l, idx) => ({
              company_db: companyDb,
              doc_type: doc.doc_type,
              doc_entry: doc.doc_entry,
              attachment_entry: Number(doc.attachment_entry),
              line_num: Number(l.Line ?? idx),
              file_name: String(l.FileName ?? `anexo_${idx}`),
              file_extension: l.FileExtension ?? null,
              source_path: l.SourcePath ?? null,
              status: "pending",
            }));
            await sb.from("sap_archive_attachments")
              .upsert(rows, { onConflict: "company_db,attachment_entry,line_num" });
          }
          await sb.from("sap_archive_documents")
            .update({ attachments_total: lines.length })
            .eq("id", doc.id);
          enumerated += lines.length;
        } catch (e) {
          const msg = (e as Error).message;
          errors.push(`anexos ${doc.doc_type}/${doc.doc_entry}: ${msg}`);
          await sb.from("sap_archive_documents")
            .update({ attachments_total: -1, last_error: msg })
            .eq("id", doc.id);
        }
      }
    }

    // 2) Baixa os arquivos pendentes.
    while (Date.now() - started < TIME_BUDGET_MS) {
      const { data: pend } = await sb
        .from("sap_archive_attachments")
        .select("id, doc_type, doc_entry, attachment_entry, line_num, file_name, file_extension")
        .eq("company_db", companyDb)
        .eq("status", "pending")
        .limit(10);
      const list = (pend || []) as any[];
      if (list.length === 0) break;

      for (const a of list) {
        if (Date.now() - started > TIME_BUDGET_MS) break;
        const fullName = a.file_extension ? `${a.file_name}.${a.file_extension}` : a.file_name;
        try {
          const bytes = await sapFetchFile(session, a.attachment_entry, fullName);
          const hash = await sha256Hex(bytes);
          const path = `${companyDb}/${a.doc_type}/${a.doc_entry}/${a.attachment_entry}_${a.line_num}_${safeName(fullName)}`;
          const { error: upErr } = await sb.storage.from(ARCHIVE_BUCKET).upload(path, bytes, {
            upsert: true,
            contentType: "application/octet-stream",
          });
          if (upErr) throw new Error(upErr.message);
          await sb.from("sap_archive_attachments").update({
            status: "stored", storage_path: path, byte_size: bytes.length,
            sha256: hash, downloaded_at: new Date().toISOString(), last_error: null,
          }).eq("id", a.id);
          downloaded++;
        } catch (e) {
          const msg = (e as Error).message;
          failed++;
          errors.push(`download ${fullName}: ${msg}`);
          await sb.from("sap_archive_attachments")
            .update({ status: "error", last_error: msg })
            .eq("id", a.id);
        }
      }
    }

    const { count: pending } = await sb
      .from("sap_archive_attachments")
      .select("id", { count: "exact", head: true })
      .eq("company_db", companyDb)
      .eq("status", "pending");

    if (runId) {
      await sb.from("sap_archive_runs").update({
        status: errors.length ? "partial" : "ok",
        attachments_count: downloaded,
        errors: errors.slice(0, 50),
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
      }).eq("id", runId);
    }

    return json(200, {
      done: (pending || 0) === 0,
      enumerated, downloaded, failed, pending: pending || 0,
      errors: errors.slice(0, 20),
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (runId) {
      await sb.from("sap_archive_runs").update({
        status: "error", errors: [msg],
        finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
      }).eq("id", runId);
    }
    return json(500, { error: msg });
  } finally {
    if (session) await sapLogout(session);
  }
});

// build: 1789670762
