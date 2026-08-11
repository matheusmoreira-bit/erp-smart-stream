// Edge function: nf-entrada-erp-queue
//
// Fila de escrita assíncrona do módulo de NF de Entrada. A UI grava a INTENÇÃO
// (status pending) e o adapter do ERP correspondente aplica depois, devolvendo
// synced (com o id do documento) ou error (com a mensagem do ERP).
//
// Ações:
//   enqueue  — registra a intenção (idempotente por nota + documento alvo)
//   process  — processa itens pendentes/erro reprocessados via adapter
//   recheck  — consulta no ERP se o PC vinculado já tem NF de Entrada lançada
//
// Nenhuma regra aqui conhece o ERP concreto: tudo passa pelo contrato normalizado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getIntegrationPause, pauseResponse } from "../_shared/integration-pause.ts";
import { requireUserOrSapSessionHeaders, authErrorResponse } from "../_shared/auth.ts";
import { resolveAdapterForCompany } from "../_shared/nfentrada-adapters/index.ts";
import type { AdapterContext } from "../_shared/nfentrada-adapters/types.ts";

const MAX_ATTEMPTS = 5;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function idemKey(op: string, cnpj: string, chave: string, target: string): string {
  return [op, (cnpj || "").toUpperCase(), (chave || "").toUpperCase(), target].join("|");
}

async function log(
  sb: any,
  importId: string,
  step: string,
  message: string,
  actor: string,
  payload?: unknown,
) {
  await sb.from("nf_entrada_logs").insert({
    import_id: importId,
    step,
    message: message.slice(0, 2000),
    actor,
    payload: payload ?? null,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: {
    action?: "enqueue" | "process" | "recheck";
    import_id?: string;
    import_ids?: string[];
    operation?: "invoice_draft" | "purchase_order";
    payload?: Record<string, unknown>;
    queue_id?: string;
    limit?: number;
    cron?: boolean;
  } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const action = body.action || "process";
  let actor = "nf-entrada-erp-queue";

  // Chamadas de usuário exigem sessão; o cron interno (service role) não.
  if (!body.cron) {
    try {
      const auth = await requireUserOrSapSessionHeaders(req);
      actor = (auth as any)?.email || req.headers.get("x-sap-user") || actor;
    } catch (e) {
      const resp = authErrorResponse(e, corsHeaders);
      if (resp) return resp;
      throw e;
    }
  }

  try {
    // ─────────────────────────── ENQUEUE ───────────────────────────
    if (action === "enqueue") {
      const ids = body.import_ids?.length ? body.import_ids : body.import_id ? [body.import_id] : [];
      if (!ids.length) return json(400, { error: "import_id ou import_ids é obrigatório" });
      const operation = body.operation || "invoice_draft";

      const { data: rows, error } = await sb
        .from("nf_entrada_imports")
        .select("*")
        .in("id", ids);
      if (error) return json(500, { error: error.message });

      const results: Array<{ import_id: string; queued: boolean; queue_id?: string; reason?: string }> = [];

      for (const row of (rows || []) as any[]) {
        if (row.status === "cancelled") {
          results.push({ import_id: row.id, queued: false, reason: "NF cancelada" });
          continue;
        }
        if (!row.sap_company_db) {
          results.push({ import_id: row.id, queued: false, reason: "NF sem empresa (base) definida" });
          continue;
        }

        let target = "";
        if (operation === "invoice_draft") {
          const poEntry = row.sap_matched_po_doc_entry;
          if (!poEntry || row.sap_matched_po_is_draft !== false) {
            results.push({ import_id: row.id, queued: false, reason: "Sem Pedido de Compra efetivo vinculado" });
            continue;
          }
          if (row.erp_invoice_posted) {
            results.push({ import_id: row.id, queued: false, reason: "NF de Entrada já lançada no ERP" });
            continue;
          }
          if (row.sap_invoice_draft_id) {
            results.push({ import_id: row.id, queued: false, reason: "Esboço já existe no ERP" });
            continue;
          }
          target = String(poEntry);
        } else {
          target = "new-po";
        }

        const key = idemKey(operation, row.cnpj_fornecedor || "", row.chave_acesso || row.id, target);

        const { data: existing } = await sb
          .from("nf_entrada_write_queue")
          .select("id, status")
          .eq("idempotency_key", key)
          .maybeSingle();
        if (existing && existing.status !== "error") {
          results.push({ import_id: row.id, queued: false, queue_id: existing.id, reason: "Intenção já registrada" });
          continue;
        }

        const { erp_type } = await resolveAdapterForCompany(sb, row.sap_company_db);

        if (existing) {
          await sb.from("nf_entrada_write_queue")
            .update({ status: "pending", error_message: null, payload: body.payload ?? {}, requested_by: actor })
            .eq("id", existing.id);
          results.push({ import_id: row.id, queued: true, queue_id: existing.id });
        } else {
          const { data: ins, error: insErr } = await sb
            .from("nf_entrada_write_queue")
            .insert({
              import_id: row.id,
              company_db: row.sap_company_db,
              erp_type,
              operation,
              idempotency_key: key,
              payload: body.payload ?? {},
              requested_by: actor,
            })
            .select("id")
            .single();
          if (insErr) {
            results.push({ import_id: row.id, queued: false, reason: insErr.message });
            continue;
          }
          results.push({ import_id: row.id, queued: true, queue_id: ins.id });
        }

        await log(sb, row.id, `queue_${operation}`, `Intenção de escrita registrada (${erp_type})`, actor, body.payload ?? null);
      }

      return json(200, { ok: true, results });
    }

    // ─────────────────────────── RECHECK ───────────────────────────
    // Valida de fato, contra o ERP, se o PC vinculado já tem NF de Entrada.
    if (action === "recheck") {
      const pause = await getIntegrationPause("sap_b1");
      if (pause) return pauseResponse(pause, corsHeaders);

      const ids = body.import_ids?.length ? body.import_ids : body.import_id ? [body.import_id] : [];
      let q = sb.from("nf_entrada_imports")
        .select("id, sap_company_db, sap_matched_po_doc_entry, sap_matched_po_is_draft, erp_invoice_posted")
        .not("sap_matched_po_doc_entry", "is", null)
        .eq("sap_matched_po_is_draft", false)
        .neq("status", "cancelled");
      if (ids.length) q = q.in("id", ids);
      else q = q.eq("erp_invoice_posted", false).limit(body.limit ?? 40);

      const { data: rows, error } = await q;
      if (error) return json(500, { error: error.message });

      const results: Array<{ id: string; posted: boolean; doc?: string | null; error?: string }> = [];
      for (const row of (rows || []) as any[]) {
        try {
          const { adapter } = await resolveAdapterForCompany(sb, row.sap_company_db);
          const ctx: AdapterContext = { supabase: sb, company_db: row.sap_company_db, actor };
          const nfe = await adapter.nfEntradaJaLancada(ctx, String(row.sap_matched_po_doc_entry));
          await sb.from("nf_entrada_imports").update({
            erp_invoice_posted: !!nfe,
            erp_invoice_doc_entry: nfe?.id ?? null,
            erp_invoice_checked_at: new Date().toISOString(),
          }).eq("id", row.id);
          results.push({ id: row.id, posted: !!nfe, doc: nfe?.numero ?? nfe?.id ?? null });
        } catch (e) {
          results.push({ id: row.id, posted: false, error: (e as Error).message });
        }
      }
      return json(200, { ok: true, results });
    }

    // ─────────────────────────── PROCESS ───────────────────────────
    const pause = await getIntegrationPause("sap_b1");
    if (pause) return pauseResponse(pause, corsHeaders);

    let q = sb.from("nf_entrada_write_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(body.limit ?? 20);
    if (body.queue_id) q = sb.from("nf_entrada_write_queue").select("*").eq("id", body.queue_id);

    const { data: queue, error: qErr } = await q;
    if (qErr) return json(500, { error: qErr.message });

    const processed: Array<{ id: string; status: string; document_id?: string; error?: string }> = [];

    for (const item of (queue || []) as any[]) {
      if (item.attempts >= MAX_ATTEMPTS) {
        processed.push({ id: item.id, status: "error", error: "Máximo de tentativas atingido" });
        continue;
      }

      // Trava otimista: só processa quem ainda está pending.
      const { data: locked } = await sb
        .from("nf_entrada_write_queue")
        .update({ status: "processing", attempts: item.attempts + 1 })
        .eq("id", item.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (!locked) continue;

      try {
        const { adapter } = await resolveAdapterForCompany(sb, item.company_db);
        const ctx: AdapterContext = { supabase: sb, company_db: item.company_db, actor: item.requested_by || actor };

        const { data: nf } = await sb.from("nf_entrada_imports").select("*").eq("id", item.import_id).maybeSingle();
        if (!nf) throw new Error("NF capturada não encontrada");

        let result;
        if (item.operation === "invoice_draft") {
          // Reconfere no ERP antes de escrever: evita esboço sobre NF já lançada.
          const already = await adapter.nfEntradaJaLancada(ctx, String(nf.sap_matched_po_doc_entry));
          if (already) {
            await sb.from("nf_entrada_imports").update({
              erp_invoice_posted: true,
              erp_invoice_doc_entry: already.id,
              erp_invoice_checked_at: new Date().toISOString(),
              status: "completed",
            }).eq("id", nf.id);
            await sb.from("nf_entrada_write_queue").update({
              status: "synced",
              erp_document_id: already.id,
              erp_document_type: "invoice_posted",
              processed_at: new Date().toISOString(),
              error_message: null,
            }).eq("id", item.id);
            await log(sb, nf.id, "queue_invoice_draft", `NF já lançada no ERP (doc ${already.numero ?? already.id}) — nada a provisionar`, actor);
            processed.push({ id: item.id, status: "synced", document_id: already.id });
            continue;
          }

          const linhas = (item.payload?.linhas as any[]) || [];
          result = await adapter.provisionarEsbocoNFEntrada(ctx, {
            pedido_id: String(nf.sap_matched_po_doc_entry),
            fornecedor_id: nf.sap_matched_card_code,
            chave_nf: nf.chave_acesso,
            numero_nf: nf.numero_nf,
            data_documento: (item.payload?.data_documento as string) || null,
            comentario: (item.payload?.comentario as string) || null,
            linhas,
          });

          await sb.from("nf_entrada_imports").update({
            sap_invoice_draft_id: result.document_id,
            status: "completed",
            last_error: null,
          }).eq("id", nf.id);
        } else {
          const payload = item.payload as any;
          result = await adapter.criarPedidoCompra(ctx, {
            fornecedor_id: payload?.fornecedor_id || nf.sap_matched_card_code,
            data_documento: payload?.data_documento || nf.data_emissao,
            comentario: payload?.comentario || `NF capturada ${nf.numero_nf ?? nf.chave_acesso}`,
            linhas: payload?.linhas || [],
          });

          // PC criado: a nota volta ao ciclo do Fluxo 1 (pronta p/ provisionar).
          await sb.from("nf_entrada_imports").update({
            sap_matched_po_doc_entry: result.document_id,
            sap_matched_po_is_draft: false,
            sap_match_reason: "PC criado a partir da nota órfã (aprovado no ERP Flow)",
            status: "awaiting_invoice",
            last_error: null,
          }).eq("id", nf.id);
        }

        await sb.from("nf_entrada_write_queue").update({
          status: "synced",
          erp_document_id: result.document_id,
          erp_document_type: result.document_type,
          processed_at: new Date().toISOString(),
          error_message: null,
        }).eq("id", item.id);

        await log(
          sb, nf.id, `queue_${item.operation}`,
          `Escrita aplicada no ERP (${result.document_type}) — documento ${result.numero ?? result.document_id}`,
          item.requested_by || actor,
          { queue_id: item.id, document_id: result.document_id },
        );

        processed.push({ id: item.id, status: "synced", document_id: result.document_id });
      } catch (e) {
        const msg = (e as Error).message;
        await sb.from("nf_entrada_write_queue").update({
          status: "error",
          error_message: msg.slice(0, 1000),
          processed_at: new Date().toISOString(),
        }).eq("id", item.id);
        await sb.from("nf_entrada_imports").update({ last_error: msg.slice(0, 1000) }).eq("id", item.import_id);
        await log(sb, item.import_id, `queue_${item.operation}`, `Erro do ERP: ${msg}`, item.requested_by || actor);
        processed.push({ id: item.id, status: "error", error: msg });
      }
    }

    return json(200, { ok: true, processed });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});
