// Alertas proativos de degradação das integrações (SAP Service Layer, HanaAPI,
// PagCorp, Master Tax). Roda por cron: lê a saúde recente das integrações e
// dispara e-mail/Slack quando latência (p95) ou taxa de erro passam do limite,
// sem depender de alguém abrir o painel.
//
// Configuração por integração: public.integration_health_alert_settings
// Histórico dos disparos:      public.integration_health_alerts
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { withEdgeMetrics } from "../_shared/edge-metrics.ts";
import { filterHealthAlertRecipients } from "../_shared/health-alert-optout.ts";

const PROVIDER_LABEL: Record<string, string> = {
  sap_sl: "SAP Service Layer",
  hana: "HanaAPI V2",
  pagcorp: "PagCorp",
  mastertax: "Master Tax",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

interface Settings {
  provider: string;
  enabled: boolean;
  window_minutes: number;
  min_samples: number;
  p95_threshold_ms: number;
  error_rate_threshold: number;
  cooldown_minutes: number;
  notify_email: boolean;
  notify_slack: boolean;
  recipient_emails: string[] | null;
  slack_channel: string | null;
}

interface Snapshot {
  provider: string;
  total: number;
  errors: number;
  error_rate: number | null;
  p95_ms: number | null;
  last_at: string | null;
  last_error_code: string | null;
}

function fmtMs(v: number | null | undefined) {
  if (v == null) return "—";
  return v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`;
}

// Fallback de destinatários: quando a integração não tem e-mails configurados,
// usa a lista do secret HEALTH_ALERT_EMAILS e, por último, os admins do Cloud.
let adminEmailsCache: string[] | null = null;
async function resolveAdminEmails(sb: any): Promise<string[]> {
  if (adminEmailsCache) return adminEmailsCache;
  const envList = (Deno.env.get("HEALTH_ALERT_EMAILS") ?? "")
    .split(",").map((e) => e.trim()).filter(Boolean);
  if (envList.length > 0) {
    adminEmailsCache = envList;
    return envList;
  }
  const emails: string[] = [];
  try {
    const { data: roles } = await sb.from("user_roles").select("user_id").eq("role", "admin");
    const ids = new Set((roles ?? []).map((r: any) => r.user_id));
    if (ids.size > 0) {
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
      for (const u of list?.users ?? []) {
        if (ids.has(u.id) && u.email) emails.push(u.email);
      }
    }
  } catch { /* ignore */ }
  adminEmailsCache = Array.from(new Set(emails));
  return adminEmailsCache;
}

async function sendEmail(to: string[], subject: string, html: string): Promise<{ ok: boolean; detail: string }> {

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || to.length === 0) return { ok: false, detail: "sem destinatários" };
  try {
    const res = await fetch(`${url}/functions/v1/send-smtp-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({ to, subject, html }),
    });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, detail: res.ok ? "email enviado" : `email ${res.status}: ${text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, detail: `email erro: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function slackEnabled() {
  return !!Deno.env.get("SLACK_API_KEY") && !!Deno.env.get("LOVABLE_API_KEY");
}

async function sendSlack(channel: string, text: string): Promise<{ ok: boolean; detail: string }> {
  if (!slackEnabled()) return { ok: false, detail: "slack não configurado" };
  try {
    const res = await fetch(`${GATEWAY_URL}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
        "X-Connection-Api-Key": Deno.env.get("SLACK_API_KEY")!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, text, unfurl_links: false }),
    });
    const body = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, detail: `slack ${res.status}: ${body.slice(0, 200)}` };
    let parsed: any = null;
    try { parsed = JSON.parse(body); } catch { /* ignore */ }
    if (parsed && parsed.ok === false) return { ok: false, detail: `slack erro: ${parsed.error}` };
    return { ok: true, detail: "slack enviado" };
  } catch (e) {
    return { ok: false, detail: `slack erro: ${e instanceof Error ? e.message : String(e)}` };
  }
}

Deno.serve(withEdgeMetrics("integration-health-alerts", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let dryRun = false;
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    dryRun = !!body?.dryRun;
  } catch { /* ignore */ }

  const { data: settingsRows, error: settingsError } = await sb
    .from("integration_health_alert_settings")
    .select("*");
  if (settingsError) {
    return new Response(JSON.stringify({ error: settingsError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const settings = (settingsRows ?? []) as Settings[];
  const maxWindow = Math.max(30, ...settings.map((s) => Number(s.window_minutes) || 30));

  const { data: snapRows, error: snapError } = await sb.rpc("get_integration_health_snapshot", {
    _minutes: maxWindow,
  });
  if (snapError) {
    return new Response(JSON.stringify({ error: snapError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const snapshots = new Map<string, Snapshot>();
  for (const r of (snapRows ?? []) as Snapshot[]) snapshots.set(r.provider, r);

  const results: any[] = [];

  for (const cfg of settings) {
    if (!cfg.enabled) continue;
    const label = PROVIDER_LABEL[cfg.provider] ?? cfg.provider;

    // Recorte por janela específica da integração (quando menor que a global).
    let snap = snapshots.get(cfg.provider) ?? null;
    if (Number(cfg.window_minutes) < maxWindow) {
      const { data: scoped } = await sb.rpc("get_integration_health_snapshot", {
        _minutes: Number(cfg.window_minutes),
      });
      snap = ((scoped ?? []) as Snapshot[]).find((r) => r.provider === cfg.provider) ?? null;
    }
    if (!snap) continue;

    const total = Number(snap.total ?? 0);
    if (total < Number(cfg.min_samples ?? 5)) continue;

    const errorRate = Number(snap.error_rate ?? 0);
    const p95 = Number(snap.p95_ms ?? 0);
    const problems: Array<{ kind: string; severity: string; text: string }> = [];

    if (errorRate > Number(cfg.error_rate_threshold)) {
      problems.push({
        kind: "error_rate",
        severity: errorRate > Number(cfg.error_rate_threshold) * 2 ? "critical" : "warning",
        text: `taxa de erro ${errorRate.toFixed(1)}% (${snap.errors}/${total}) acima do limite de ${Number(cfg.error_rate_threshold)}%`,
      });
    }
    if (p95 > Number(cfg.p95_threshold_ms)) {
      problems.push({
        kind: "p95_latency",
        severity: p95 > Number(cfg.p95_threshold_ms) * 2 ? "critical" : "warning",
        text: `latência p95 ${fmtMs(p95)} acima do limite de ${fmtMs(Number(cfg.p95_threshold_ms))}`,
      });
    }
    if (problems.length === 0) continue;

    for (const p of problems) {
      // Cooldown: evita repetir o mesmo alerta em sequência.
      const since = new Date(Date.now() - Number(cfg.cooldown_minutes ?? 60) * 60_000).toISOString();
      const { data: recent } = await sb
        .from("integration_health_alerts")
        .select("id")
        .eq("provider", cfg.provider)
        .eq("kind", p.kind)
        .gte("created_at", since)
        .limit(1);
      if (recent && recent.length > 0) {
        results.push({ provider: cfg.provider, kind: p.kind, skipped: "cooldown" });
        continue;
      }

      const icon = p.severity === "critical" ? "🔴" : "⚠️";
      const message =
        `${icon} ERP Flow — degradação em ${label}: ${p.text} nos últimos ${cfg.window_minutes} min.` +
        (snap.last_error_code ? ` Último erro: ${snap.last_error_code}.` : "");

      if (dryRun) {
        results.push({ provider: cfg.provider, kind: p.kind, dryRun: true, message });
        continue;
      }

      const channels: string[] = [];
      const details: string[] = [];
      let ok = false;

      if (cfg.notify_email) {
        let to = (cfg.recipient_emails ?? []).filter(Boolean);
        if (to.length === 0) to = await resolveAdminEmails(sb);
        to = filterHealthAlertRecipients(to);


        const html = `
          <div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
            <h2 style="margin:0 0 12px">${icon} Degradação detectada — ${label}</h2>
            <p style="margin:0 0 12px">${p.text} nos últimos ${cfg.window_minutes} minutos.</p>
            <ul style="margin:0 0 12px;padding-left:18px">
              <li>Execuções: ${total}</li>
              <li>Erros: ${snap.errors} (${errorRate.toFixed(2)}%)</li>
              <li>Latência p95: ${fmtMs(p95)}</li>
              <li>Última execução: ${snap.last_at ? new Date(snap.last_at).toLocaleString("pt-BR") : "—"}</li>
              ${snap.last_error_code ? `<li>Último erro: ${snap.last_error_code}</li>` : ""}
            </ul>
            <p style="margin:0;color:#666">Alerta automático do painel de saúde das integrações.</p>
          </div>`;
        const r = await sendEmail(to, `[ERP Flow] Degradação em ${label}`, html);
        channels.push("email");
        details.push(r.detail);
        ok = ok || r.ok;
      }

      if (cfg.notify_slack && cfg.slack_channel) {
        const r = await sendSlack(cfg.slack_channel, message);
        channels.push("slack");
        details.push(r.detail);
        ok = ok || r.ok;
      }

      await sb.from("integration_health_alerts").insert({
        provider: cfg.provider,
        kind: p.kind,
        severity: p.severity,
        message,
        total,
        errors: Number(snap.errors ?? 0),
        error_rate: errorRate,
        p95_ms: p95,
        window_minutes: Number(cfg.window_minutes),
        channels,
        delivery_ok: ok,
        delivery_detail: details.join(" | ").slice(0, 500),
      });

      results.push({ provider: cfg.provider, kind: p.kind, sent: ok, channels });
    }
  }

  return new Response(JSON.stringify({ ok: true, evaluated: settings.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}));
