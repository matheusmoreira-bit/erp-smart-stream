// Edge function: sap-archive-restore
// Devolve ao SAP os documentos guardados na base de backup do ERP Flow.
//
// POST {
//   company_db,                 // base de origem do backup
//   target_company_db?,         // base destino (default = company_db)
//   dry_run?: boolean,          // default TRUE (apenas simula/valida)
//   doc_types?: string[],
//   limit?: number,
//   confirm?: string            // obrigatório quando dry_run = false: nome da base destino
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import {
  ARCHIVE_BUCKET,
  ARCHIVE_DOC_SPECS,
  ARCHIVE_MASTER_SPECS,
  masterKeyRef,
  masterSpecByKey,
  sanitizeForRestore,
  sanitizeMasterForRestore,
  sapGet,
  sapLogin,
  sapLogout,
  sapPost,
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
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Cadastros exigidos pelo documento (para a simulação). */
function requiredMasterData(payload: any): { cards: string[]; items: string[] } {
  const cards = payload?.CardCode ? [String(payload.CardCode)] : [];
  const items = new Set<string>();
  for (const l of (payload?.DocumentLines || [])) {
    if (l?.ItemCode) items.add(String(l.ItemCode));
  }
  return { cards, items: [...items] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;

  const started = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let session: Awaited<ReturnType<typeof sapLogin>> | null = null;
  let runId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const companyDb = String(body?.company_db || "").trim();
    const targetDb = String(body?.target_company_db || companyDb).trim();
    const dryRun = body?.dry_run === false ? false : true;
    const limit = Math.min(Math.max(Number(body?.limit) || 25, 1), 100);

    if (!companyDb || !/^[A-Za-z0-9_\-]+$/.test(companyDb)) return json(400, { error: "company_db obrigatório" });
    if (!/^[A-Za-z0-9_\-]+$/.test(targetDb)) return json(400, { error: "target_company_db inválido" });
    if (!dryRun && String(body?.confirm || "") !== targetDb) {
      return json(400, { error: `Confirmação obrigatória: envie confirm = "${targetDb}".` });
    }

    // Fase de cadastros: itens, fornecedores/clientes, grupos, centros de custo…
    // Por padrão os cadastros vão antes dos documentos (o documento depende deles).
    const masterOnly = body?.master_only === true;
    const includeMaster = masterOnly || body?.include_master !== false;
    // Quando a lista vem do painel, a ORDEM ESCOLHIDA pelo usuário é respeitada.
    const masterSpecs = Array.isArray(body?.entities) && body.entities.length
      ? (body.entities.map(String).map(masterSpecByKey).filter(Boolean) as typeof ARCHIVE_MASTER_SPECS)
      : ARCHIVE_MASTER_SPECS.slice().sort((a, b) => a.restoreOrder - b.restoreOrder);
    const masterLimit = Math.min(Math.max(Number(body?.master_limit) || 200, 1), 500);

    const specs = masterOnly
      ? []
      : Array.isArray(body?.doc_types) && body.doc_types.length
        ? (body.doc_types.map(String).map(specByKey).filter(Boolean) as typeof ARCHIVE_DOC_SPECS)
        : ARCHIVE_DOC_SPECS.slice().sort((a, b) => a.restoreOrder - b.restoreOrder);


    const { data: runRow } = await sb.from("sap_archive_runs").insert({
      company_db: companyDb,
      kind: dryRun ? "restore_dry_run" : "restore",
      status: "running",
      triggered_by: auth.source,
    }).select("id").single();
    runId = (runRow as any)?.id ?? null;

    session = await sapLogin(sb, targetDb);

    const missingCards = new Set<string>();
    const missingItems = new Set<string>();
    const checkedCards = new Map<string, boolean>();
    const checkedItems = new Map<string, boolean>();
    const errors: string[] = [];
    const perType: Array<Record<string, unknown>> = [];
    const perEntity: Array<Record<string, unknown>> = [];
    let restored = 0;
    let masterRestored = 0;
    let allDone = true;

    async function cardExists(code: string): Promise<boolean> {
      if (checkedCards.has(code)) return checkedCards.get(code)!;
      let ok = false;
      try {
        await sapGet(session!, `BusinessPartners('${encodeURIComponent(code)}')?$select=CardCode`);
        ok = true;
      } catch { ok = false; }
      checkedCards.set(code, ok);
      return ok;
    }
    async function itemExists(code: string): Promise<boolean> {
      if (checkedItems.has(code)) return checkedItems.get(code)!;
      let ok = false;
      try {
        await sapGet(session!, `Items('${encodeURIComponent(code)}')?$select=ItemCode`);
        ok = true;
      } catch { ok = false; }
      checkedItems.set(code, ok);
      return ok;
    }

    // ---- Cadastros ---------------------------------------------------------
    if (includeMaster) {
      for (const ms of masterSpecs) {
        if (Date.now() - started > TIME_BUDGET_MS) { allDone = false; break; }

        const { data: alreadyRows } = await sb
          .from("sap_archive_master_restore_map")
          .select("code")
          .eq("source_company_db", companyDb)
          .eq("target_company_db", targetDb)
          .eq("entity_type", ms.key)
          .eq("status", "restored");
        const doneCodes = new Set((alreadyRows || []).map((r: any) => String(r.code)));

        const { data: rows } = await sb
          .from("sap_archive_master_data")
          .select("code, name, payload")
          .eq("company_db", companyDb)
          .eq("entity_type", ms.key)
          .order("code", { ascending: true })
          .limit(masterLimit + doneCodes.size);

        const pending = ((rows || []) as any[])
          .filter((r) => !doneCodes.has(String(r.code)))
          .slice(0, masterLimit);

        let created = 0;
        let existing = 0;

        for (const row of pending) {
          if (Date.now() - started > TIME_BUDGET_MS) { allDone = false; break; }
          const code = String(row.code);

          // Já existe na base destino? Então só registra e segue.
          let exists = false;
          try {
            await sapGet(session, `${ms.endpoint}${masterKeyRef(ms, code)}?$select=${ms.keyField}`);
            exists = true;
          } catch { exists = false; }

          if (exists) {
            existing++;
            if (!dryRun) {
              await sb.from("sap_archive_master_restore_map").upsert({
                source_company_db: companyDb, target_company_db: targetDb,
                entity_type: ms.key, code, status: "restored", error_message: null,
                restored_at: new Date().toISOString(),
              }, { onConflict: "source_company_db,target_company_db,entity_type,code" });
            }
            continue;
          }

          if (dryRun || ms.readOnly) continue;

          try {
            await sapPost(session, ms.endpoint, sanitizeMasterForRestore(row.payload, ms.stripOnRestore));
            created++; masterRestored++;
            await sb.from("sap_archive_master_restore_map").upsert({
              source_company_db: companyDb, target_company_db: targetDb,
              entity_type: ms.key, code, status: "restored", error_message: null,
              restored_at: new Date().toISOString(),
            }, { onConflict: "source_company_db,target_company_db,entity_type,code" });
          } catch (e) {
            const msg = (e as Error).message;
            errors.push(`${ms.key}/${code}: ${msg}`);
            await sb.from("sap_archive_master_restore_map").upsert({
              source_company_db: companyDb, target_company_db: targetDb,
              entity_type: ms.key, code, status: "error", error_message: msg.slice(0, 500),
            }, { onConflict: "source_company_db,target_company_db,entity_type,code" });
          }
        }

        const { count: total } = await sb
          .from("sap_archive_master_data")
          .select("id", { count: "exact", head: true })
          .eq("company_db", companyDb)
          .eq("entity_type", ms.key);

        const remaining = (total || 0) - doneCodes.size - created - existing;
        if (remaining > 0 && !dryRun) allDone = false;
        perEntity.push({
          entity: ms.key, label: ms.label, total: total || 0,
          created, existing, remaining: Math.max(remaining, 0),
        });
      }
    }


    for (const spec of specs) {
      if (Date.now() - started > TIME_BUDGET_MS) { allDone = false; break; }

      const { data: already } = await sb
        .from("sap_archive_restore_map")
        .select("source_doc_entry")
        .eq("source_company_db", companyDb)
        .eq("target_company_db", targetDb)
        .eq("doc_type", spec.key)
        .eq("status", "restored");
      const doneEntries = new Set((already || []).map((r: any) => Number(r.source_doc_entry)));

      const { data: docs } = await sb
        .from("sap_archive_documents")
        .select("doc_entry, doc_num, payload")
        .eq("company_db", companyDb)
        .eq("doc_type", spec.key)
        .order("doc_entry", { ascending: true })
        .limit(limit + doneEntries.size);

      const pending = ((docs || []) as any[]).filter((d) => !doneEntries.has(Number(d.doc_entry))).slice(0, limit);
      let typeRestored = 0;

      for (const doc of pending) {
        if (Date.now() - started > TIME_BUDGET_MS) { allDone = false; break; }
        const { cards, items } = requiredMasterData(doc.payload);
        for (const c of cards) if (!(await cardExists(c))) missingCards.add(c);
        for (const i of items) if (!(await itemExists(i))) missingItems.add(i);

        if (dryRun) continue;
        if (cards.some((c) => missingCards.has(c)) || items.some((i) => missingItems.has(i))) {
          errors.push(`${spec.key}/${doc.doc_entry}: cadastro ausente no destino`);
          continue;
        }

        const payload = sanitizeForRestore(doc.payload, spec.stripOnRestore);
        payload.Comments = [
          String(payload.Comments || "").slice(0, 180),
          `[Restaurado do backup ERP Flow — ${spec.key} #${doc.doc_num ?? doc.doc_entry}]`,
        ].filter(Boolean).join(" ").slice(0, 254);

        try {
          const created = await sapPost(session, spec.endpoint, payload);
          await sb.from("sap_archive_restore_map").upsert({
            source_company_db: companyDb,
            target_company_db: targetDb,
            doc_type: spec.key,
            source_doc_entry: Number(doc.doc_entry),
            source_doc_num: doc.doc_num ?? null,
            target_doc_entry: created?.DocEntry ?? null,
            target_doc_num: created?.DocNum ?? null,
            status: "restored",
            error_message: null,
            restored_at: new Date().toISOString(),
          }, { onConflict: "source_company_db,target_company_db,doc_type,source_doc_entry" });
          restored++; typeRestored++;
        } catch (e) {
          const msg = (e as Error).message;
          errors.push(`${spec.key}/${doc.doc_entry}: ${msg}`);
          await sb.from("sap_archive_restore_map").upsert({
            source_company_db: companyDb,
            target_company_db: targetDb,
            doc_type: spec.key,
            source_doc_entry: Number(doc.doc_entry),
            source_doc_num: doc.doc_num ?? null,
            status: "error",
            error_message: msg.slice(0, 500),
          }, { onConflict: "source_company_db,target_company_db,doc_type,source_doc_entry" });
        }
      }

      const { count: total } = await sb
        .from("sap_archive_documents")
        .select("id", { count: "exact", head: true })
        .eq("company_db", companyDb)
        .eq("doc_type", spec.key);

      const remaining = (total || 0) - doneEntries.size - typeRestored;
      if (remaining > 0 && !dryRun) allDone = false;
      perType.push({ doc_type: spec.key, total: total || 0, restored: typeRestored, remaining });
    }

    if (runId) {
      await sb.from("sap_archive_runs").update({
        status: errors.length ? "partial" : "ok",
        documents_count: restored + masterRestored,
        errors: errors.slice(0, 50),
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
      }).eq("id", runId);
    }

    return json(200, {
      dry_run: dryRun,
      done: allDone,
      restored,
      master_restored: masterRestored,
      per_entity: perEntity,
      per_type: perType,
      missing_business_partners: [...missingCards].slice(0, 100),
      missing_items: [...missingItems].slice(0, 100),
      errors: errors.slice(0, 20),
      bucket: ARCHIVE_BUCKET,
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

// build: 1789673539
