// Notificação WhatsApp das aprovações pendentes registradas no próprio ERP Flow.
//
// Este watcher NÃO depende do HANA/HanaAPI (que pode estar indisponível):
// lê as despesas com status `pendente_aprovacao` na base do ERP Flow e avisa
// o aprovador atual. Dedup de 24h por (empresa, documento, aprovador).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import { blockIfIntegrationsDisabled } from "../_shared/integrations-mode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WHATSAPP_URL = Deno.env.get("WHATSAPP_URL") || "http://63.177.171.140/sender_wpp";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || Deno.env.get("WHATSAPP_API_TOKEN") || "";
const ERP_FLOW_URL = "https://erp-flow.cactuscorporation.com";

function normalizePhone(p?: string | null): string {
  if (!p) return "";
  const digits = String(p).replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

const PARTICLES = new Set(["de", "da", "do", "das", "dos", "e", "di", "del"]);

function slugTokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t && !PARTICLES.has(t));
}

/** Resolve o user_code a partir do nome de exibição do aprovador. */
function matchUserCode(displayName: string, codes: string[]): string | null {
  const nameTokens = slugTokens(displayName);
  if (!nameTokens.length) return null;
  const first = nameTokens[0];
  const last = nameTokens[nameTokens.length - 1];

  const scored = codes
    .map((code) => {
      const codeTokens = slugTokens(code);
      if (!codeTokens.length) return { code, score: 0 };
      let score = 0;
      if (codeTokens[0] === first) score += 2;
      if (codeTokens[codeTokens.length - 1] === last) score += 2;
      if (codeTokens.every((t) => nameTokens.includes(t))) score += 1;
      return { code, score };
    })
    .filter((s) => s.score >= 4)
    .sort((a, b) => b.score - a.score);

  if (scored.length) return scored[0].code;

  // fallback: primeiro nome único
  const byFirst = codes.filter((c) => slugTokens(c)[0] === first);
  return byFirst.length === 1 ? byFirst[0] : null;
}

async function sendWhatsApp(to: string, message: string) {
  if (!WHATSAPP_TOKEN) return { ok: false, status: 0, body: "WHATSAPP_TOKEN ausente" };
  const body = new URLSearchParams({ to, message });
  const resp = await fetch(WHATSAPP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  return { ok: resp.ok, status: resp.status, body: await resp.text().catch(() => "") };
}

function money(v: unknown, currency?: string | null) {
  const n = Number(v || 0);
  const cur = (currency || "BRL").trim().toUpperCase() || "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(n);
  } catch {
    return `${cur} ${n.toFixed(2)}`;
  }
}

interface ExpenseRow {
  id: string;
  company_db: string;
  current_approver: string | null;
  supplier_name: string | null;
  requester_name: string | null;
  total_amount: number | null;
  currency: string | null;
  doc_type: string | null;
  sap_doc_num: number | null;
  created_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;
  const disabled = blockIfIntegrationsDisabled(corsHeaders);
  if (disabled) return disabled;

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = Boolean(body?.dry_run);
  } catch { /* sem body */ }

  const sent: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];

  try {
    const { data: companies } = await sb
      .from("companies")
      .select("company_db, display_name, is_active")
      .eq("is_active", true);
    const companyNames = new Map<string, string>();
    const allowed: string[] = [];
    for (const c of (companies || []) as { company_db: string; display_name: string }[]) {
      if (/^sbo_teste_/i.test(c.company_db) || /^tst_/i.test(c.company_db)) continue;
      companyNames.set(c.company_db, c.display_name);
      allowed.push(c.company_db);
    }

    const { data: expenses, error: eErr } = await sb
      .from("expenses")
      .select("id, company_db, current_approver, supplier_name, requester_name, total_amount, currency, doc_type, sap_doc_num, created_at")
      .eq("status", "pendente_aprovacao")
      .in("company_db", allowed.length ? allowed : [""])
      .order("created_at", { ascending: true });
    if (eErr) throw eErr;

    const { data: phoneRows } = await sb.from("user_phones").select("company_db, user_code, phone");
    const { data: profileRows } = await sb
      .from("user_profiles")
      .select("user_code, phone, notify_whatsapp_approvals");

    const phonesByCompany = new Map<string, Map<string, string>>();
    const globalPhones = new Map<string, string>();
    for (const r of (phoneRows || []) as { company_db: string; user_code: string; phone: string }[]) {
      if (!phonesByCompany.has(r.company_db)) phonesByCompany.set(r.company_db, new Map());
      phonesByCompany.get(r.company_db)!.set(r.user_code, r.phone);
      if (!globalPhones.has(r.user_code)) globalPhones.set(r.user_code, r.phone);
    }
    const optOut = new Set<string>();
    for (const p of (profileRows || []) as { user_code: string; phone: string | null; notify_whatsapp_approvals: boolean }[]) {
      if (p.phone && !globalPhones.has(p.user_code)) globalPhones.set(p.user_code, p.phone);
      if (p.notify_whatsapp_approvals === false) optOut.add(p.user_code);
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentAlerts } = await sb
      .from("whatsapp_flow_approval_alerts")
      .select("company_db, expense_id, approver_code")
      .gte("sent_at", since);
    const alreadySent = new Set(
      (recentAlerts || []).map((r: { company_db: string; expense_id: string; approver_code: string }) =>
        `${r.company_db}|${r.expense_id}|${r.approver_code}`
      ),
    );

    // Agrupa por aprovador para enviar UMA mensagem consolidada por pessoa.
    interface Bucket { code: string; phone: string; items: Array<{ ex: ExpenseRow; name: string }> }
    const buckets = new Map<string, Bucket>();

    for (const ex of (expenses || []) as ExpenseRow[]) {
      const approversRaw = (ex.current_approver || "")
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!approversRaw.length) {
        skipped.push({ expense_id: ex.id, reason: "sem aprovador" });
        continue;
      }

      const companyPhones = phonesByCompany.get(ex.company_db) || new Map<string, string>();
      const candidateCodes = Array.from(new Set([...companyPhones.keys(), ...globalPhones.keys()]));

      for (const approverName of approversRaw) {
        const code = matchUserCode(approverName, candidateCodes);
        if (!code) {
          skipped.push({ expense_id: ex.id, approver: approverName, reason: "usuário não identificado" });
          continue;
        }
        if (optOut.has(code)) {
          skipped.push({ expense_id: ex.id, approver: code, reason: "opt-out" });
          continue;
        }
        const phone = normalizePhone(companyPhones.get(code) || globalPhones.get(code));
        if (!phone) {
          skipped.push({ expense_id: ex.id, approver: code, reason: "sem telefone" });
          continue;
        }
        if (alreadySent.has(`${ex.company_db}|${ex.id}|${code}`)) {
          skipped.push({ expense_id: ex.id, approver: code, reason: "já avisado nas últimas 24h" });
          continue;
        }
        const bucket = buckets.get(code) || { code, phone, items: [] };
        bucket.items.push({ ex, name: approverName });
        buckets.set(code, bucket);
      }
    }

    for (const bucket of buckets.values()) {
      const lines = bucket.items.slice(0, 15).map(({ ex }) => {
        const dias = Math.max(0, Math.floor((Date.now() - new Date(ex.created_at).getTime()) / 86_400_000));
        const tipo = ex.doc_type === "sales" ? "Venda" : "Compra";
        const docRef = ex.sap_doc_num ? `#${ex.sap_doc_num}` : "s/ nº";
        return `• ${tipo} ${docRef} · ${companyNames.get(ex.company_db) || ex.company_db}\n  ${ex.supplier_name || "—"} · ${money(ex.total_amount, ex.currency)} · ${dias}d`;
      });
      const extra = bucket.items.length > 15 ? `\n… e mais ${bucket.items.length - 15} documento(s).` : "";
      const msg =
        `🔔 *Aprovações pendentes no ERP Flow*\n` +
        `Você tem ${bucket.items.length} documento(s) aguardando sua aprovação:\n\n` +
        lines.join("\n") + extra +
        `\n\nAprovar: ${ERP_FLOW_URL}/aprovacoes?tab=pending`;

      if (dryRun) {
        sent.push({ approver: bucket.code, phone: bucket.phone, docs: bucket.items.length, dry_run: true });
        continue;
      }

      const res = await sendWhatsApp(bucket.phone, msg);
      if (!res.ok) {
        skipped.push({ approver: bucket.code, reason: `falha WhatsApp ${res.status}`, docs: bucket.items.length });
        continue;
      }
      await sb.from("whatsapp_flow_approval_alerts").insert(
        bucket.items.map(({ ex, name }) => ({
          company_db: ex.company_db,
          expense_id: ex.id,
          approver_code: bucket.code,
          whatsapp_to: bucket.phone,
          payload: {
            approver_name: name,
            supplier: ex.supplier_name,
            requester: ex.requester_name,
            amount: ex.total_amount,
            currency: ex.currency,
            doc_type: ex.doc_type,
            sap_doc_num: ex.sap_doc_num,
            digest: true,
          },
        })),
      );
      sent.push({ approver: bucket.code, phone: bucket.phone, docs: bucket.items.length });
    }

    await sb.from("notification_send_runs").insert({
      function_name: "whatsapp-flow-approval-watcher",
      status: "success",
      recipients_count: sent.length,
      details: { sent, skipped, dry_run: dryRun },
    });

    return new Response(
      JSON.stringify({ ok: true, dry_run: dryRun, sent_count: sent.length, sent, skipped }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    await sb.from("notification_send_runs").insert({
      function_name: "whatsapp-flow-approval-watcher",
      status: "error",
      recipients_count: sent.length,
      error_message: (e as Error).message,
      details: { sent, skipped },
    }).catch?.(() => {});
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
