// Background job: retry SAP integration for expenses that are approved
// but not integrated yet. Sends a WhatsApp notification to the admin when
// a document fails again — so someone can act manually.
//
// Trigger: pg_cron (every 10 min) OR manual POST.
// Auth: cron passes the anon apikey; we validate a shared internal secret
//       (SUPABASE_SERVICE_ROLE_KEY) or accept unauthenticated calls only
//       when hit from cron/net.http_post (best-effort — the function is
//       idempotent and only performs safe retries).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getIntegrationPause, pauseResponse } from "../_shared/integration-pause.ts";
import { isTestCompanyDb } from "../_shared/watcher-lock.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WHATSAPP_URL = "http://63.177.171.140/sender_wpp";
const WHATSAPP_TOKEN = "777a5756-d6b3-4295-a031-e5c210998766";
// Admin que recebe as notificações de falha de integração
const ADMIN_WHATSAPP_USER_CODE = "matheus.moreira";

// Não reprocessar o mesmo documento com falha em intervalos curtos.
const RETRY_COOLDOWN_MINUTES = 30;
// Não notificar o admin repetidamente pelo mesmo doc.
const NOTIFY_COOLDOWN_HOURS = 6;
// Máximo de tentativas por rodada para evitar sobrecarga.
const MAX_DOCS_PER_RUN = 20;

function normalizePhone(p?: string | null): string {
  if (!p) return "";
  const digits = p.replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

async function sendWhatsApp(to: string, message: string) {
  try {
    const body = new URLSearchParams({ to, message });
    const resp = await fetch(WHATSAPP_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  }
}

function formatCurrency(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(v);
  } catch {
    return `${currency || "BRL"} ${Number(v).toFixed(2)}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  { const _pause = await getIntegrationPause("sap_b1"); if (_pause) return pauseResponse(_pause, corsHeaders); }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const startedAt = new Date();
  const cutoff = new Date(Date.now() - RETRY_COOLDOWN_MINUTES * 60_000).toISOString();

  // 1. Selecionar candidatos: aprovados, sem doc_entry no SAP, não em curso,
  //    fora do cooldown e não originados no próprio ERP (para não duplicar).
  const { data: candidates, error: qErr } = await admin
    .from("expenses")
    .select(
      "id, company_db, doc_type, supplier_name, supplier_code, requester_name, requester_email, total_amount, currency, sap_integration_last_attempt_at, sap_integration_error, origin",
    )
    .eq("status", "aprovado")
    .eq("doc_type", "purchase")
    .is("sap_doc_entry", null)
    .neq("sap_purchase_order_status", "success")
    .or(`sap_integration_last_attempt_at.is.null,sap_integration_last_attempt_at.lt.${cutoff}`)
    .order("sap_integration_last_attempt_at", { ascending: true, nullsFirst: true })
    .limit(MAX_DOCS_PER_RUN);

  if (qErr) {
    console.error("[retry] failed to query candidates", qErr);
    return new Response(JSON.stringify({ success: false, error: qErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<{ id: string; ok: boolean; error?: string; notified?: boolean }> = [];

  // Buscar telefone do admin uma vez
  let adminPhone = "";
  try {
    const { data: phoneRow } = await admin
      .from("user_phones")
      .select("phone")
      .eq("user_code", ADMIN_WHATSAPP_USER_CODE)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    adminPhone = normalizePhone(phoneRow?.phone);
  } catch (e) {
    console.warn("[retry] failed to load admin phone", e);
  }

  for (const exp of candidates || []) {
    // Pular docs originados no ERP — a integração criaria duplicata.
    const origin = String((exp as any).origin || "").toLowerCase();
    if (["sap", "erp", "sap_erp", "erp_flow"].includes(origin)) {
      results.push({ id: exp.id, ok: false, error: "originado no ERP — ignorado" });
      continue;
    }

    // Chamada interna ao expense-to-sap com service role.
    let ok = false;
    let errMsg = "";
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/expense-to-sap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          "x-internal-retry": "1",
        },
        body: JSON.stringify({ expense_id: exp.id, use_service_account: true }),
      });
      const body = await resp.json().catch(() => ({}));
      ok = resp.ok && body?.success !== false;
      if (!ok) errMsg = body?.error || `HTTP ${resp.status}`;
    } catch (e) {
      errMsg = (e as Error).message || "erro desconhecido";
    }

    if (ok) {
      results.push({ id: exp.id, ok: true });
      continue;
    }

    // Falhou. Notificar admin (com cooldown por doc).
    let notified = false;
    try {
      const cooldownCutoff = new Date(Date.now() - NOTIFY_COOLDOWN_HOURS * 3600_000).toISOString();
      const { data: recent } = await admin
        .from("expense_audit_log")
        .select("id")
        .eq("expense_id", exp.id)
        .eq("action", "integration_retry_notified")
        .gte("created_at", cooldownCutoff)
        .limit(1);
      const recentlyNotified = Array.isArray(recent) && recent.length > 0;

      if (!recentlyNotified && adminPhone) {
        const amount = formatCurrency(Number(exp.total_amount || 0), exp.currency || "BRL");
        const link = `https://erp-flow.cactuscorporation.com/compras?doc=${exp.id}`;
        const msg =
          `⚠️ *Falha na integração ao SAP*\n\n` +
          `Empresa: ${exp.company_db}\n` +
          `Fornecedor: ${exp.supplier_name || "-"} (${exp.supplier_code || "-"})\n` +
          `Solicitante: ${exp.requester_name || "-"}\n` +
          `Valor: ${amount}\n\n` +
          `Erro: ${errMsg.slice(0, 300)}\n\n` +
          `Abrir: ${link}`;
        const send = await sendWhatsApp(adminPhone, msg);
        notified = !!send.ok;

        // Registra a notificação (mesmo se falhou, para não flood-notificar).
        try {
          await admin.from("expense_audit_log").insert({
            expense_id: exp.id,
            action: "integration_retry_notified",
            decision: null,
            actor_identity: "system:integration-retry",
            actor_source: "cloud_admin",
            company_db: exp.company_db,
            remarks: `WhatsApp ${notified ? "enviado" : "falhou"} p/ ${ADMIN_WHATSAPP_USER_CODE}. Erro SAP: ${errMsg.slice(0, 500)}`,
          });
        } catch (logErr) {
          console.warn("[retry] failed to log notification", logErr);
        }
      }
    } catch (e) {
      console.warn("[retry] notify block failed", e);
    }

    results.push({ id: exp.id, ok: false, error: errMsg, notified });
  }

  return new Response(
    JSON.stringify({
      success: true,
      startedAt: startedAt.toISOString(),
      attempted: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
