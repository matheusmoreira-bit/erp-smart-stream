// SAP Retry Queue Worker
// Runs every minute via pg_cron. Picks pending retry rows whose next_attempt_at
// has arrived, dispatches them to the origin edge function, and reschedules
// with exponential backoff on transient failure. When attempts >= max_attempts
// or the new error is not retryable, marks the row as exhausted and notifies
// admins via email + WhatsApp.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { backoffMinutes, classifySapError, nextAttemptAt, type SapRetryDocType } from "../_shared/sap-retry.ts";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import { blockIfIntegrationsDisabled } from "../_shared/integrations-mode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ROWS_PER_RUN = 20;
const STALE_IN_FLIGHT_MINUTES = 10;
const WHATSAPP_URL = Deno.env.get("WHATSAPP_URL") || "http://63.177.171.140/sender_wpp";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || Deno.env.get("WHATSAPP_API_TOKEN") || "";
const ADMIN_USER_CODES = ["matheus.moreira"];
const ADMIN_EMAILS = ["matheus.moreira@anagaming.com.br"];

function normalizePhone(p?: string | null): string {
  if (!p) return "";
  const d = p.replace(/\D+/g, "");
  if (!d) return "";
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

async function sendWhatsApp(to: string, message: string) {
  if (!WHATSAPP_TOKEN) {
    console.warn("[sap-retry-worker] WHATSAPP_TOKEN não configurado; notificação WhatsApp ignorada.");
    return false;
  }
  try {
    const body = new URLSearchParams({ to, message });
    const r = await fetch(WHATSAPP_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    return r.ok;
  } catch { return false; }
}

interface Dispatch {
  path: string;
  body: Record<string, unknown>;
}

// Payload conventions:
//   - Optional `__endpoint`/`__body` fully override dispatch (used by flows
//     that need extra fields, like pagcorp/synapse).
//   - Otherwise we use a doc-type default that just passes the ref_id.
function buildDispatch(docType: SapRetryDocType, refId: string, payload: Record<string, unknown>): Dispatch | null {
  if (typeof payload.__endpoint === "string" && payload.__body && typeof payload.__body === "object") {
    return { path: payload.__endpoint as string, body: payload.__body as Record<string, unknown> };
  }
  switch (docType) {
    case "expense":
      return { path: "expense-to-sap", body: { expense_id: refId, use_service_account: true } };
    case "advance":
      return { path: "advance-to-sap", body: { advance_id: refId, use_service_account: true } };
    case "baixa":
      // baixa-recebimento requires a live SAP session; auto-retry not supported.
      // Row stays in queue for visibility + manual "retry agora" via UI.
      return null;
    case "pagcorp":
    case "synapse_pagcorp":
      // These require full body; caller must supply __endpoint/__body.
      return null;
    default:
      return null;
  }
}

// deno-lint-ignore no-explicit-any
async function notifyExhausted(admin: any, row: any) {
  const link = `https://erp-flow.cactuscorporation.com/backoffice/retry-queue?id=${row.id}`;
  const subject = `[ERP] Retry esgotado — ${row.doc_type} · ${row.company_db || "-"} · ${row.ref_id}`;
  const html = `
    <h2>Retry automático esgotado</h2>
    <p>Um documento excedeu o limite de tentativas de integração ao SAP.</p>
    <ul>
      <li><b>Tipo:</b> ${row.doc_type}</li>
      <li><b>Empresa:</b> ${row.company_db || "-"}</li>
      <li><b>Documento:</b> ${row.ref_id}</li>
      <li><b>Tentativas:</b> ${row.attempts}/${row.max_attempts}</li>
      <li><b>Categoria:</b> ${row.error_category || "-"}</li>
    </ul>
    <p><b>Último erro:</b><br><code>${String(row.last_error || "").slice(0, 800)}</code></p>
    <p><a href="${link}">Abrir na fila de retries</a></p>
  `;
  // Email via existing SMTP function
  for (const to of ADMIN_EMAILS) {
    try {
      await admin.functions.invoke("send-smtp-email", {
        body: { to, subject, html, text: `Retry esgotado: ${row.doc_type} ${row.ref_id} - ${row.last_error || ""}` },
      });
    } catch (e) {
      console.warn("[sap-retry-worker] email failed:", (e as Error).message);
    }
  }
  // WhatsApp
  const message =
    `⚠️ *SAP: retry esgotado*\n\n` +
    `Tipo: ${row.doc_type}\n` +
    `Empresa: ${row.company_db || "-"}\n` +
    `Doc: ${row.ref_id}\n` +
    `Tentativas: ${row.attempts}/${row.max_attempts}\n\n` +
    `Erro: ${String(row.last_error || "").slice(0, 300)}\n\n` +
    link;
  for (const uc of ADMIN_USER_CODES) {
    try {
      const { data: ph } = await admin
        .from("user_phones").select("phone").eq("user_code", uc)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      const to = normalizePhone(ph?.phone);
      if (to) await sendWhatsApp(to, message);
    } catch (e) {
      console.warn("[sap-retry-worker] Falha ao notificar admin sobre retry esgotado:", e);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;
  const disabled = blockIfIntegrationsDisabled(corsHeaders);
  if (disabled) return disabled;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // Recupera linhas presas em `in_flight` (worker morto/timeout) devolvendo-as
  // à fila — sem isso um documento ficava travado para sempre sem alerta.
  const staleIso = new Date(Date.now() - STALE_IN_FLIGHT_MINUTES * 60_000).toISOString();
  const { data: reclaimed } = await admin
    .from("sap_retry_queue")
    .update({ status: "pending" })
    .eq("status", "in_flight")
    .lt("last_attempt_at", staleIso)
    .select("id");

  // Atomically claim up to N due rows.
  const nowIso = new Date().toISOString();

  const { data: due, error: selErr } = await admin
    .from("sap_retry_queue")
    .select("*")
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(MAX_ROWS_PER_RUN);

  if (selErr) {
    return new Response(JSON.stringify({ ok: false, error: selErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const claimed: any[] = [];
  for (const row of due || []) {
    const { data: upd } = await admin
      .from("sap_retry_queue")
      .update({ status: "in_flight", last_attempt_at: nowIso })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (upd) claimed.push(upd);
  }

  const results: Array<{ id: string; ok: boolean; action: string; error?: string }> = [];

  for (const row of claimed) {
    const attempts = (row.attempts || 0) + 1;
    const dispatch = buildDispatch(row.doc_type, row.ref_id, row.payload || {});
    if (!dispatch) {
      // Auto-retry not supported for this doc_type (e.g. baixa needs live SAP session).
      // Mark as exhausted so admins are notified once and can retry manually via UI.
      const { data: exhausted } = await admin.from("sap_retry_queue").update({
        status: "exhausted", attempts,
        last_error: (row.last_error || "") + " [auto-retry indisponível para este tipo — retry manual necessário]",
      }).eq("id", row.id).select("*").maybeSingle();
      if (exhausted && !exhausted.notified_exhausted_at) {
        await notifyExhausted(admin, exhausted);
        await admin.from("sap_retry_queue")
          .update({ notified_exhausted_at: new Date().toISOString() }).eq("id", row.id);
      }
      results.push({ id: row.id, ok: false, action: "manual_required" });
      continue;
    }

    const invoke = async (body: Record<string, unknown>) => {
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/${dispatch.path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            "x-internal-retry": "1",
          },
          body: JSON.stringify(body),
        });
        const parsed = await resp.json().catch(() => ({}));
        const good = resp.ok && parsed?.success !== false;
        return {
          ok: good,
          status: resp.status as number | undefined,
          error: good ? "" : (parsed?.error || JSON.stringify(parsed).slice(0, 500) || `HTTP ${resp.status}`),
        };
      } catch (e) {
        return { ok: false, status: undefined as number | undefined, error: (e as Error).message || "erro desconhecido" };
      }
    };

    const first = await invoke(dispatch.body);
    const ok = first.ok;
    const errText = first.error;
    const httpStatus = first.status;

    if (ok) {
      await admin.from("sap_retry_queue").update({
        status: "succeeded", attempts, last_error: null,
      }).eq("id", row.id);
      results.push({ id: row.id, ok: true, action: "succeeded" });
      continue;
    }

    const cls = classifySapError(httpStatus, errText);
    const isLastAttempt = !cls.retryable || attempts >= (row.max_attempts || 5);

    // NÃO integrar sem anexo. Falha de anexo é encerrada como "exhausted"
    // para o documento ser corrigido com anexo e reenviado.


    // Not retryable or attempts exhausted → mark exhausted + notify.
    if (isLastAttempt) {
      const { data: exhausted } = await admin.from("sap_retry_queue").update({
        status: "exhausted",
        attempts,
        last_error: errText.slice(0, 2000),
        error_category: cls.category,
      }).eq("id", row.id).select("*").maybeSingle();
      if (exhausted && !exhausted.notified_exhausted_at) {
        await notifyExhausted(admin, exhausted);
        await admin.from("sap_retry_queue")
          .update({ notified_exhausted_at: new Date().toISOString() })
          .eq("id", row.id);
      }
      results.push({ id: row.id, ok: false, action: "exhausted", error: errText.slice(0, 200) });
      continue;
    }

    // Reschedule com backoff exponencial + jitter.
    await admin.from("sap_retry_queue").update({
      status: "pending",
      attempts,
      next_attempt_at: nextAttemptAt(attempts),
      last_error: errText.slice(0, 2000),
      error_category: cls.category,
    }).eq("id", row.id);
    results.push({ id: row.id, ok: false, action: `rescheduled(+~${backoffMinutes(attempts)}m)`, error: errText.slice(0, 200) });

  }

  return new Response(
    JSON.stringify({ ok: true, reclaimed: (reclaimed || []).length, claimed: claimed.length, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
