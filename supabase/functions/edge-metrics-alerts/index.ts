// Envia alertas WhatsApp quando funções edge ficam lentas (p95 > 10s) ou
// com alta taxa de erro (> 5%) na janela recente. Executado por cron.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { withEdgeMetrics } from "../_shared/edge-metrics.ts";

const WHATSAPP_URL = "http://63.177.171.140/sender_wpp";
const WHATSAPP_TOKEN = "777a5756-d6b3-4295-a031-e5c210998766";

const DEFAULT_PHONES = ["5531999474353"]; // Douglas Ferreira (admin infra)

const P95_THRESHOLD_MS = 10_000;
const ERROR_RATE_THRESHOLD = 5; // percentual
const MIN_SAMPLE = 10; // ignora janelas com pouquíssimas execuções

async function sendWhatsApp(to: string, message: string) {
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

Deno.serve(withEdgeMetrics("edge-metrics-alerts", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Janela de 5 minutos alinhada (bucket) para dedup
  const now = new Date();
  const bucketMs = Math.floor(now.getTime() / (5 * 60_000)) * (5 * 60_000);
  const windowStart = new Date(bucketMs - 5 * 60_000);
  const windowBucket = new Date(bucketMs).toISOString();

  const { data: rows, error } = await sb
    .from("edge_function_metrics")
    .select("function_name,duration_ms,ok")
    .gte("started_at", windowStart.toISOString());
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const grouped = new Map<string, { total: number; errors: number; durations: number[] }>();
  for (const r of rows ?? []) {
    const g = grouped.get(r.function_name) ?? { total: 0, errors: 0, durations: [] };
    g.total += 1;
    if (!r.ok) g.errors += 1;
    if (typeof r.duration_ms === "number") g.durations.push(r.duration_ms);
    grouped.set(r.function_name, g);
  }

  const phonesEnv = (Deno.env.get("EDGE_METRICS_ALERT_PHONES") ?? "").trim();
  const phones = phonesEnv ? phonesEnv.split(",").map((p) => p.trim()).filter(Boolean) : DEFAULT_PHONES;

  const alerts: Array<Record<string, unknown>> = [];

  for (const [fn, g] of grouped.entries()) {
    if (g.total < MIN_SAMPLE) continue;
    const sorted = [...g.durations].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
    const errRate = (g.errors / g.total) * 100;

    const problems: Array<{ kind: string; message: string; p95?: number; errorRate?: number }> = [];
    if (p95 > P95_THRESHOLD_MS) {
      problems.push({
        kind: "p95_latency",
        message: `⚠️ ERP Flow — latência alta em *${fn}*: p95 ${(p95 / 1000).toFixed(1)}s (limite ${P95_THRESHOLD_MS / 1000}s) em ${g.total} execuções nos últimos 5min.`,
        p95,
      });
    }
    if (errRate > ERROR_RATE_THRESHOLD) {
      problems.push({
        kind: "error_rate",
        message: `⚠️ ERP Flow — taxa de erro alta em *${fn}*: ${errRate.toFixed(1)}% (${g.errors}/${g.total}) nos últimos 5min.`,
        errorRate: errRate,
      });
    }

    for (const p of problems) {
      // Dedup: se já existe alerta desse (fn, kind, bucket), pula
      const { data: existing } = await sb
        .from("edge_metrics_alerts")
        .select("id")
        .eq("function_name", fn)
        .eq("kind", p.kind)
        .eq("window_bucket", windowBucket)
        .maybeSingle();
      if (existing) continue;

      const sendResults: string[] = [];
      let okAny = false;
      for (const to of phones) {
        try {
          const r = await sendWhatsApp(to, p.message);
          sendResults.push(`${to}:${r.status}`);
          if (r.ok) okAny = true;
        } catch (e) {
          sendResults.push(`${to}:err(${(e as Error).message})`);
        }
      }

      await sb.from("edge_metrics_alerts").insert({
        function_name: fn,
        kind: p.kind,
        window_bucket: windowBucket,
        p95_ms: p.p95 ?? null,
        error_rate: p.errorRate ?? errRate,
        total: g.total,
        errors: g.errors,
        message: p.message,
        sent_to: phones.join(","),
        ok: okAny,
        response: sendResults.join(" | "),
      });

      alerts.push({ function_name: fn, kind: p.kind, ok: okAny, sendResults });
    }
  }

  return new Response(JSON.stringify({ ok: true, window_bucket: windowBucket, evaluated: grouped.size, alerts }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}));
