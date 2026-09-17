// Edge function: sap-archive-master-pull
// Copia os cadastros do SAP (itens, fornecedores/clientes, grupos, centros de
// custo, projetos, depósitos, listas de preço, condições de pagamento e plano
// de contas) para a base de backup do ERP Flow.
//
// POST { company_db, entities?: string[], incremental?: boolean, page_size?: number }
// Resposta: { done, records, results: [{ entity, fetched, done, error? }] }
// Por padrão a busca é INCREMENTAL (só o que mudou desde a última cópia).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import {
  ARCHIVE_MASTER_SPECS,
  masterSpecByKey,
  qs,
  sapGet,
  sapLogin,
  sapLogout,
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
    const pageSize = Math.min(Math.max(Number(body?.page_size) || 50, 10), 200);
    // Incremental é o padrão: só busca tudo quando o chamador pedir full.
    const incremental = body?.incremental === false ? false : true;

    const specs = (Array.isArray(body?.entities) && body.entities.length
      ? (body.entities.map(String).map(masterSpecByKey).filter(Boolean) as typeof ARCHIVE_MASTER_SPECS)
      : ARCHIVE_MASTER_SPECS
    ).slice().sort((a, b) => a.restoreOrder - b.restoreOrder);
    if (specs.length === 0) return json(400, { error: "entities inválidas" });

    const { data: runRow } = await sb.from("sap_archive_runs").insert({
      company_db: companyDb,
      kind: incremental ? "master_incremental" : "master",
      status: "running",
      triggered_by: auth.source,
    }).select("id").single();
    runId = (runRow as any)?.id ?? null;

    session = await sapLogin(sb, companyDb);

    const results: Array<Record<string, unknown>> = [];
    const errors: string[] = [];
    let totalRecords = 0;
    let allDone = true;

    for (const spec of specs) {
      if (Date.now() - started > TIME_BUDGET_MS) { allDone = false; break; }

      const { data: cursorRow } = await sb
        .from("sap_archive_master_cursors")
        .select("last_offset, completed, last_incremental_at")
        .eq("company_db", companyDb)
        .eq("entity_type", spec.key)
        .maybeSingle();

      const completedBefore = Boolean((cursorRow as any)?.completed);
      const sinceIso = (cursorRow as any)?.last_incremental_at as string | null;
      const useIncremental = incremental && completedBefore && Boolean(sinceIso);
      // Numa varredura incremental recomeça do zero (poucos registros mudam).
      let offset = useIncremental ? 0 : Number((cursorRow as any)?.last_offset || 0);
      let fetched = 0;
      let entityDone = false;
      let entityError: string | undefined;

      try {
        while (Date.now() - started < TIME_BUDGET_MS) {
          const path = `${spec.endpoint}${qs({
            $orderby: spec.keyField,
            $skip: offset > 0 ? offset : undefined,
            $filter: useIncremental ? `UpdateDate ge '${sinceIso!.slice(0, 10)}'` : undefined,
          })}`;
          let page: any;
          try {
            page = await sapGet(session, path, pageSize);
          } catch (e) {
            // Nem toda entidade aceita filtro por UpdateDate — cai para cópia total.
            if (useIncremental && /UpdateDate/i.test((e as Error).message)) {
              page = await sapGet(session, `${spec.endpoint}${qs({ $orderby: spec.keyField, $skip: offset > 0 ? offset : undefined })}`, pageSize);
            } else throw e;
          }
          const rows: any[] = Array.isArray(page?.value) ? page.value : [];
          if (rows.length === 0) { entityDone = true; break; }

          const records = rows
            .map((r) => {
              const code = r?.[spec.keyField];
              if (code === undefined || code === null || String(code) === "") return null;
              return {
                company_db: companyDb,
                entity_type: spec.key,
                code: String(code),
                name: spec.nameField ? (r?.[spec.nameField] ?? null) : null,
                payload: r,
                update_date: pickDate(r?.UpdateDate),
                fetched_at: new Date().toISOString(),
              };
            })
            .filter(Boolean) as Array<Record<string, unknown>>;

          if (records.length > 0) {
            const { error: upErr } = await sb
              .from("sap_archive_master_data")
              .upsert(records, { onConflict: "company_db,entity_type,code" });
            if (upErr) throw new Error(`Gravação do cadastro falhou: ${upErr.message}`);
          }

          fetched += rows.length;
          totalRecords += records.length;
          offset += rows.length;

          await sb.from("sap_archive_master_cursors").upsert({
            company_db: companyDb,
            entity_type: spec.key,
            last_offset: useIncremental ? Number((cursorRow as any)?.last_offset || 0) : offset,
            completed: completedBefore,
            updated_at: new Date().toISOString(),
          }, { onConflict: "company_db,entity_type" });

          if (rows.length < pageSize) { entityDone = true; break; }
        }
      } catch (e) {
        entityError = (e as Error).message;
        errors.push(`${spec.key}: ${entityError}`);
      }

      if (entityDone) {
        await sb.from("sap_archive_master_cursors").upsert({
          company_db: companyDb,
          entity_type: spec.key,
          last_offset: useIncremental ? Number((cursorRow as any)?.last_offset || 0) : offset,
          completed: true,
          updated_at: new Date().toISOString(),
          ...(useIncremental
            ? { last_incremental_at: new Date().toISOString() }
            : {
              last_full_sync_at: new Date().toISOString(),
              last_incremental_at: new Date().toISOString(),
            }),
        }, { onConflict: "company_db,entity_type" });
      } else {
        allDone = false;
      }

      results.push({ entity: spec.key, fetched, done: entityDone, error: entityError });
    }

    if (runId) {
      await sb.from("sap_archive_runs").update({
        status: errors.length ? "partial" : "ok",
        documents_count: totalRecords,
        errors: errors.slice(0, 50),
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
      }).eq("id", runId);
    }

    return json(200, { done: allDone, records: totalRecords, results, errors: errors.slice(0, 20) });
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
