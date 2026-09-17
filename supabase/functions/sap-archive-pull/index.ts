// Edge function: sap-archive-pull
// Copia documentos do SAP (pedidos de compra, NF de entrada, pagamentos,
// pedidos de venda, NF de saída, recebimentos e adiantamentos) para a base de
// backup do ERP Flow (`public.sap_archive_documents`).
//
// POST { company_db, doc_types?: string[], incremental?: boolean, page_size?: number }
// Resposta: { done, results: [{ doc_type, fetched, cursor, done, error? }] }
// A tela deve chamar repetidamente enquanto `done` for false.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import {
  ARCHIVE_DOC_SPECS,
  qs,
  sapGet,
  sapLogin,
  sapLogout,
  specByKey,
} from "../_shared/sap-archive.ts";

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

function pickDate(v: unknown): string | null {
  if (typeof v !== "string" || v.length < 10) return null;
  return v.slice(0, 10);
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
    const pageSize = Math.min(Math.max(Number(body?.page_size) || 20, 5), 50);
    const incremental = Boolean(body?.incremental);
    const requested: string[] = Array.isArray(body?.doc_types) && body.doc_types.length
      ? body.doc_types.map(String)
      : ARCHIVE_DOC_SPECS.map((s) => s.key);

    const specs = requested.map(specByKey).filter(Boolean) as typeof ARCHIVE_DOC_SPECS;
    if (specs.length === 0) return json(400, { error: "doc_types inválidos" });

    const { data: runRow } = await sb.from("sap_archive_runs").insert({
      company_db: companyDb,
      kind: incremental ? "pull_incremental" : "pull",
      status: "running",
      triggered_by: auth.source,
    }).select("id").single();
    runId = (runRow as any)?.id ?? null;

    session = await sapLogin(sb, companyDb);

    const results: Array<Record<string, unknown>> = [];
    const errors: string[] = [];
    let totalDocs = 0;
    let allDone = true;

    for (const spec of specs) {
      if (Date.now() - started > TIME_BUDGET_MS) { allDone = false; break; }

      const { data: cursorRow } = await sb
        .from("sap_archive_cursors")
        .select("last_doc_entry, completed, last_incremental_at")
        .eq("company_db", companyDb)
        .eq("doc_type", spec.key)
        .maybeSingle();

      let cursor = Number((cursorRow as any)?.last_doc_entry || 0);
      const completedBefore = Boolean((cursorRow as any)?.completed);
      const sinceIso = (cursorRow as any)?.last_incremental_at as string | null;
      const useIncremental = incremental && completedBefore;
      let skip = 0;
      let fetched = 0;
      let typeDone = false;
      let typeError: string | undefined;

      try {
        while (Date.now() - started < TIME_BUDGET_MS) {
          const filter = useIncremental
            ? `UpdateDate ge '${(sinceIso ? sinceIso.slice(0, 10) : "1900-01-01")}'`
            : `DocEntry gt ${cursor}`;
          const path = `${spec.endpoint}${qs({
            $filter: filter,
            $orderby: useIncremental ? "DocEntry" : "DocEntry",
            $skip: useIncremental && skip > 0 ? skip : undefined,
          })}`;
          const page = await sapGet(session, path, pageSize);
          const rows: any[] = Array.isArray(page?.value) ? page.value : [];
          if (rows.length === 0) { typeDone = true; break; }

          const docs = rows.map((r) => ({
            company_db: companyDb,
            doc_type: spec.key,
            doc_entry: Number(r.DocEntry),
            doc_num: r.DocNum ?? null,
            doc_date: pickDate(r.DocDate),
            card_code: r.CardCode ?? null,
            card_name: r.CardName ?? null,
            doc_total: typeof r.DocTotal === "number" ? r.DocTotal : null,
            doc_currency: r.DocCurrency ?? null,
            doc_status: r.DocumentStatus ?? r.Cancelled ?? null,
            update_date: pickDate(r.UpdateDate),
            attachment_entry: r.AttachmentEntry ?? null,
            payload: r,
            last_error: null,
            fetched_at: new Date().toISOString(),
          }));

          const { error: upErr } = await sb
            .from("sap_archive_documents")
            .upsert(docs, { onConflict: "company_db,doc_type,doc_entry" });
          if (upErr) throw new Error(`Gravação no arquivo falhou: ${upErr.message}`);

          fetched += docs.length;
          totalDocs += docs.length;
          if (useIncremental) skip += rows.length;
          else cursor = Math.max(cursor, ...docs.map((d) => d.doc_entry));

          await sb.from("sap_archive_cursors").upsert({
            company_db: companyDb,
            doc_type: spec.key,
            last_doc_entry: cursor,
            completed: completedBefore,
            updated_at: new Date().toISOString(),
          }, { onConflict: "company_db,doc_type" });

          if (rows.length < pageSize) { typeDone = true; break; }
        }
      } catch (e) {
        typeError = (e as Error).message;
        errors.push(`${spec.key}: ${typeError}`);
      }

      if (typeDone) {
        await sb.from("sap_archive_cursors").upsert({
          company_db: companyDb,
          doc_type: spec.key,
          last_doc_entry: cursor,
          completed: true,
          updated_at: new Date().toISOString(),
          ...(useIncremental
            ? { last_incremental_at: new Date().toISOString() }
            : { last_full_sync_at: new Date().toISOString(), last_incremental_at: new Date().toISOString() }),
        }, { onConflict: "company_db,doc_type" });
      } else {
        allDone = false;
      }

      results.push({ doc_type: spec.key, fetched, cursor, done: typeDone, error: typeError });
    }

    if (runId) {
      await sb.from("sap_archive_runs").update({
        status: errors.length ? "partial" : "ok",
        documents_count: totalDocs,
        errors,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
      }).eq("id", runId);
    }

    return json(200, { done: allDone, documents: totalDocs, results, errors });
  } catch (e) {
    const msg = (e as Error).message;
    if (runId) {
      await sb.from("sap_archive_runs").update({
        status: "error",
        errors: [msg],
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
      }).eq("id", runId);
    }
    return json(500, { error: msg });
  } finally {
    if (session) await sapLogout(session);
  }
});

// build: 1789670762
