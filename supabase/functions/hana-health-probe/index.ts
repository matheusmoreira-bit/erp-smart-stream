// Monitor de saúde do HanaAPI V2.
//
// Roda por cron (a cada 5 min) e também sob demanda pelo painel de integrações.
// Para cada endpoint conhecido (IP primário de cada empresa + IP de fallback)
// executa uma consulta leve (limit=1) numa view e registra o resultado em
// public.hana_health_probes.
//
// Alertas (e-mail/Slack) quando:
//   - todos os endpoints falham           -> kind "down" (critical)
//   - algum endpoint responde non-2XX/erro -> kind "endpoint_error" (warning)
//   - comunicação volta após um alerta     -> kind "recovered" (info)
//
// Configuração: public.integration_health_alert_settings (provider = 'hanaapi_v2')
// Histórico dos disparos: public.integration_health_alerts
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { withEdgeMetrics } from "../_shared/edge-metrics.ts";
import { generateDynamicToken, resolveHanaSchema } from "../_shared/hana-views.ts";
import { filterHealthAlertRecipients } from "../_shared/health-alert-optout.ts";

const DEFAULT_HANA_API_URL = "http://201.48.79.205:8001";
const FALLBACK_HANA_API_URL = "http://189.91.68.202:8001";
const PROVIDER = "hanaapi_v2";
const LABEL = "HanaAPI V2";
const PROBE_VIEW = "VW_FORNECEDORES";
const PROBE_TIMEOUT_MS = 12_000;
const GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

interface ProbeResult {
  base_url: string;
  company_db: string | null;
  view_name: string;
  ok: boolean;
  http_status: number | null;
  duration_ms: number;
  error_message: string | null;
}

function slBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function sapLogin(baseUrl: string, u: string, p: string, db: string): Promise<string> {
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: u, Password: p, CompanyDB: db }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`Login SAP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 160)}`);
  const json = await r.json();
  return String(json.SessionId ?? "");
}

async function probeBase(
  base: string,
  schema: string,
  sessionId: string,
  companyDb: string | null,
): Promise<ProbeResult> {
  const started = Date.now();
  const url = `${base.replace(/\/+$/, "")}/data/${encodeURIComponent(schema)}.${PROBE_VIEW}?limit=1`;
  try {
    const token = await generateDynamicToken();
    const r = await fetch(url, {
      headers: { dynamictoken: token, sessionid: sessionId },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = await r.text().catch(() => "");
    return {
      base_url: base,
      company_db: companyDb,
      view_name: PROBE_VIEW,
      ok: r.ok,
      http_status: r.status,
      duration_ms: Date.now() - started,
      error_message: r.ok ? null : `HTTP ${r.status}: ${body.slice(0, 240)}`,
    };
  } catch (e) {
    return {
      base_url: base,
      company_db: companyDb,
      view_name: PROBE_VIEW,
      ok: false,
      http_status: null,
      duration_ms: Date.now() - started,
      error_message: `sem comunicação: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

async function resolveAdminEmails(sb: any): Promise<string[]> {
  const envList = (Deno.env.get("HEALTH_ALERT_EMAILS") ?? "")
    .split(",").map((e) => e.trim()).filter(Boolean);
  if (envList.length > 0) return envList;
  const emails: string[] = [];
  try {
    const { data: roles } = await sb.from("user_roles").select("user_id").eq("role", "admin");
    const ids = new Set((roles ?? []).map((r: any) => r.user_id));
    if (ids.size > 0) {
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
      for (const u of list?.users ?? []) if (ids.has(u.id) && u.email) emails.push(u.email);
    }
  } catch { /* ignore */ }
  return Array.from(new Set(emails));
}

async function sendEmail(to: string[], subject: string, html: string) {
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

async function sendSlack(channel: string, text: string) {
  const slackKey = Deno.env.get("SLACK_API_KEY");
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!slackKey || !lovableKey) return { ok: false, detail: "slack não configurado" };
  try {
    const res = await fetch(`${GATEWAY_URL}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": slackKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, text, unfurl_links: false }),
    });
    const body = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, detail: `slack ${res.status}: ${body.slice(0, 200)}` };
    const parsed = (() => { try { return JSON.parse(body); } catch { return null; } })();
    if (parsed && parsed.ok === false) return { ok: false, detail: `slack erro: ${parsed.error}` };
    return { ok: true, detail: "slack enviado" };
  } catch (e) {
    return { ok: false, detail: `slack erro: ${e instanceof Error ? e.message : String(e)}` };
  }
}

Deno.serve(withEdgeMetrics("hana-health-probe", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const dryRun = !!(body as any)?.dryRun;

  // 1. Credenciais das empresas com HanaAPI habilitada.
  const { data: credRows, error: credErr } = await sb
    .from("system_credentials")
    .select("company_db, credential_key, credential_value")
    .eq("system_name", "sap");
  if (credErr) {
    return new Response(JSON.stringify({ error: credErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const byCompany = new Map<string, Record<string, string>>();
  for (const r of (credRows ?? []) as any[]) {
    if (!r.company_db) continue;
    const kv = byCompany.get(r.company_db) ?? {};
    kv[r.credential_key] = r.credential_value ?? "";
    byCompany.set(r.company_db, kv);
  }
  const isTestBase = (db: string) => /tst|teste|test/i.test(db);
  const candidates = Array.from(byCompany.entries())
    .filter(([, kv]) =>
      kv.service_layer_url && kv.username && kv.password &&
      kv.use_hana_db !== "false" &&
      (kv.username || "").trim().toLowerCase() === "apiuser"
    )
    // Produção primeiro: bases de teste podem não ter as views publicadas.
    .sort((a, b) => Number(isTestBase(a[0])) - Number(isTestBase(b[0])));

  if (candidates.length === 0) {
    return new Response(JSON.stringify({ ok: true, skipped: "nenhuma empresa com HanaAPI habilitada" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Endpoints a sondar: IPs configurados + primário padrão + fallback.
  const bases = new Set<string>([DEFAULT_HANA_API_URL, FALLBACK_HANA_API_URL]);
  for (const [, kv] of candidates) {
    const u = (kv.hana_api_url ?? "").trim();
    if (u) bases.add(u.replace(/\/+$/, ""));
  }
  const baseList = Array.from(bases);

  // 3. Sessão do Service Layer (header sessionid do HanaAPI). Se a empresa
  // escolhida não tiver a view publicada (404 "nao encontrado"), tenta a próxima.
  let probes: ProbeResult[] = [];
  let loginError: string | null = null;
  let lastCompany: string | null = null;

  for (const [companyDb, kv] of candidates.slice(0, 4)) {
    let sessionId = "";
    try {
      sessionId = await sapLogin(slBaseUrl(kv.service_layer_url), kv.username, kv.password, kv.db_name || companyDb);
    } catch (e) {
      loginError = e instanceof Error ? e.message : String(e);
      continue;
    }
    if (!sessionId) continue;
    lastCompany = companyDb;
    const schema = resolveHanaSchema(companyDb, kv.db_name);
    const attempt = await Promise.all(baseList.map((base) => probeBase(base, schema, sessionId, companyDb)));
    probes = attempt;
    const schemaIssue = attempt.every((p) =>
      p.http_status === 404 && /nao encontrado|não encontrado/i.test(p.error_message ?? "")
    );
    if (!schemaIssue) break;
  }

  if (probes.length === 0) {
    probes = baseList.map((base) => ({
      base_url: base,
      company_db: lastCompany,
      view_name: PROBE_VIEW,
      ok: false,
      http_status: null,
      duration_ms: 0,
      error_message: `sem sessão SAP para sondar: ${loginError ?? "login indisponível"}`,
    }));
  }


  await sb.from("hana_health_probes").insert(probes);

  const failing = probes.filter((p) => !p.ok);
  const allDown = failing.length === probes.length;

  // 4. Configuração de alerta.
  const { data: cfgRow } = await sb
    .from("integration_health_alert_settings")
    .select("*")
    .eq("provider", PROVIDER)
    .maybeSingle();
  const cfg = cfgRow as any;
  const results: any[] = [];

  const alertsEnabled = cfg?.enabled !== false;
  const cooldownMin = Number(cfg?.cooldown_minutes ?? 30);
  const windowMin = Number(cfg?.window_minutes ?? 15);

  async function recentAlert(kinds: string[], minutes: number) {
    const since = new Date(Date.now() - minutes * 60_000).toISOString();
    const { data } = await sb
      .from("integration_health_alerts")
      .select("id, kind, created_at")
      .eq("provider", PROVIDER)
      .in("kind", kinds)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    return (data ?? [])[0] ?? null;
  }

  async function dispatch(kind: string, severity: string, headline: string, lines: string[]) {
    const icon = severity === "critical" ? "🔴" : severity === "info" ? "✅" : "⚠️";
    const message = `${icon} ERP Flow — ${LABEL}: ${headline}`;
    if (dryRun) {
      results.push({ kind, dryRun: true, message, lines });
      return;
    }
    const channels: string[] = [];
    const details: string[] = [];
    let ok = false;

    if (cfg?.notify_email !== false) {
      let to = ((cfg?.recipient_emails ?? []) as string[]).filter(Boolean);
      if (to.length === 0) to = await resolveAdminEmails(sb);
      const html = `
        <div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
          <h2 style="margin:0 0 12px">${icon} ${LABEL} — ${headline}</h2>
          <ul style="margin:0 0 12px;padding-left:18px">${lines.map((l) => `<li>${l}</li>`).join("")}</ul>
          <p style="margin:0;color:#666">Monitor automático do HanaAPI V2 (sondagem a cada 5 minutos).</p>
        </div>`;
      const r = await sendEmail(to, `[ERP Flow] ${LABEL} — ${headline}`, html);
      channels.push("email"); details.push(r.detail); ok = ok || r.ok;
    }
    if (cfg?.notify_slack && cfg?.slack_channel) {
      const r = await sendSlack(cfg.slack_channel, `${message}\n${lines.join("\n")}`);
      channels.push("slack"); details.push(r.detail); ok = ok || r.ok;
    }

    await sb.from("integration_health_alerts").insert({
      provider: PROVIDER,
      kind,
      severity,
      message: `${message} ${lines.join(" | ")}`.slice(0, 900),
      total: probes.length,
      errors: failing.length,
      error_rate: probes.length ? Number(((100 * failing.length) / probes.length).toFixed(2)) : null,
      p95_ms: probes.length ? Math.max(...probes.map((p) => p.duration_ms)) : null,
      window_minutes: windowMin,
      channels,
      delivery_ok: ok,
      delivery_detail: details.join(" | ").slice(0, 500),
    });
    results.push({ kind, severity, sent: ok, channels });
  }

  if (alertsEnabled) {
    if (failing.length > 0) {
      const kind = allDown ? "down" : "endpoint_error";
      const severity = allDown ? "critical" : "warning";
      const dup = await recentAlert([kind], cooldownMin);
      if (dup) {
        results.push({ kind, skipped: "cooldown" });
      } else {
        const headline = allDown
          ? "comunicação indisponível em todos os endpoints"
          : `falha em ${failing.length} de ${probes.length} endpoint(s)`;
        const lines = failing.map((p) =>
          `${p.base_url} — ${p.http_status ? `HTTP ${p.http_status}` : "sem resposta"} (${p.duration_ms}ms): ${(p.error_message ?? "").slice(0, 180)}`
        );
        const okLines = probes.filter((p) => p.ok).map((p) => `${p.base_url} — OK (${p.duration_ms}ms)`);
        await dispatch(kind, severity, headline, [...lines, ...okLines]);
      }
    } else {
      // Recuperação: só notifica se houve alerta aberto nas últimas 6h.
      const lastIssue = await recentAlert(["down", "endpoint_error"], 360);
      const lastRecovery = await recentAlert(["recovered"], 360);
      const needsRecovery = lastIssue &&
        (!lastRecovery || new Date(lastRecovery.created_at) < new Date(lastIssue.created_at));
      if (needsRecovery) {
        await dispatch("recovered", "info", "comunicação restabelecida", probes.map((p) =>
          `${p.base_url} — OK (${p.duration_ms}ms)`
        ));
      }
    }
  }

  // Retenção: mantém 30 dias de sondagens.
  await sb.from("hana_health_probes")
    .delete()
    .lt("created_at", new Date(Date.now() - 30 * 24 * 3600_000).toISOString());

  return new Response(JSON.stringify({ ok: true, probes, allDown, alerts: results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}));
