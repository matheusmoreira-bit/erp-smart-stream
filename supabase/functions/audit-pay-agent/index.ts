// audit-pay-agent — sinais determinísticos de padrão/fraude + camada LLM de correlação e narrativa.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { admin } from "../_shared/audit-pay/sap.ts";

const SERVICE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authorize(req: Request, companyDb: string) {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
  const sb = createClient(SERVICE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data, error } = await sb.auth.getClaims(auth.replace("Bearer ", ""));
  if (error || !data?.claims) throw new Error("UNAUTHORIZED");
  const { data: allowed } = await sb.rpc("can_access_audit_console", { _company_db: companyDb });
  if (!allowed) throw new Error("FORBIDDEN");
}

type Sev = "baixa" | "media" | "alta" | "critica";
interface Signal {
  signal_type: string;
  entity_type: string;
  entity_ref: string;
  related_audit_result_ids: string[];
  severity: Sev;
  confidence: number;
  narrative: string;
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function round(n: number, p = 2) {
  return Number(n.toFixed(p));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const companyDb = String(body.company_db ?? "");
    if (!companyDb) return json({ error: "company_db é obrigatório" }, 400);
    await authorize(req, companyDb);

    const days = Math.min(Number(body.days ?? 90), 365);
    const periodStart = daysAgoIso(days);
    const sb = admin();

    const { data: cfg } = await sb
      .from("audit_pay_config")
      .select("approval_thresholds")
      .eq("company_db", companyDb)
      .maybeSingle();
    const thresholds: number[] = (Array.isArray(cfg?.approval_thresholds) ? cfg!.approval_thresholds : [])
      .map((t: any) => Number(t?.limit ?? t))
      .filter((n: number) => Number.isFinite(n) && n > 0)
      .sort((a: number, b: number) => a - b);

    const { data: results } = await sb
      .from("audit_pay_result")
      .select("id, fornecedor_code, fornecedor_name, solicitante, projeto, centro_custo, valor_pago, valor_baseline, overall_severity, has_findings, audited_at, baseline_snapshot, settlement_snapshot")
      .eq("company_db", companyDb)
      .gte("audited_at", periodStart)
      .limit(5000);

    const rows = results ?? [];
    const { data: findings } = await sb
      .from("audit_pay_finding")
      .select("audit_result_id, finding_type, severity")
      .eq("company_db", companyDb)
      .in("audit_result_id", rows.slice(0, 1000).map((r: any) => r.id));

    const byResult = new Map<string, string[]>();
    for (const f of findings ?? []) {
      const list = byResult.get(f.audit_result_id) ?? [];
      list.push(f.finding_type);
      byResult.set(f.audit_result_id, list);
    }

    const signals: Signal[] = [];

    // 1) Reincidência por fornecedor
    const perVendor = new Map<string, any[]>();
    for (const r of rows) {
      const k = r.fornecedor_code || r.fornecedor_name || "—";
      perVendor.set(k, [...(perVendor.get(k) ?? []), r]);
    }
    for (const [vendor, list] of perVendor) {
      const withFindings = list.filter((r) => r.has_findings);
      if (list.length >= 3 && withFindings.length / list.length >= 0.5 && withFindings.length >= 3) {
        signals.push({
          signal_type: "reincidencia",
          entity_type: "fornecedor",
          entity_ref: vendor,
          related_audit_result_ids: withFindings.map((r) => r.id),
          severity: withFindings.length >= 6 ? "alta" : "media",
          confidence: round(Math.min(0.5 + withFindings.length / 20, 0.95)),
          narrative: `${withFindings.length} de ${list.length} documentos do fornecedor ${vendor} apresentaram divergências no período.`,
        });
      }
    }

    // 2) Fracionamento (structuring) abaixo das faixas de alçada
    if (thresholds.length) {
      const perPair = new Map<string, any[]>();
      for (const r of rows) {
        const k = `${r.fornecedor_code ?? "?"}|${r.solicitante ?? "?"}`;
        perPair.set(k, [...(perPair.get(k) ?? []), r]);
      }
      for (const [pair, list] of perPair) {
        for (const t of thresholds) {
          const near = list.filter((r) => {
            const v = Number(r.valor_pago ?? 0);
            return v > t * 0.8 && v <= t;
          });
          if (near.length >= 3) {
            const dates = near.map((r) => new Date(r.audited_at).getTime()).sort();
            const spanDays = (dates[dates.length - 1] - dates[0]) / 86400000;
            if (spanDays <= 30) {
              signals.push({
                signal_type: "fracionamento",
                entity_type: "fornecedor",
                entity_ref: pair,
                related_audit_result_ids: near.map((r) => r.id),
                severity: near.length >= 5 ? "alta" : "media",
                confidence: round(Math.min(0.5 + near.length / 12, 0.9)),
                narrative: `${near.length} documentos entre ${round(t * 0.8)} e ${t} (logo abaixo da alçada) para ${pair} em ${Math.round(spanDays)} dias.`,
              });
            }
          }
        }
      }
    }

    // 3) Alteração pós-aprovação sistemática
    const posAprov = rows.filter((r) => (byResult.get(r.id) ?? []).includes("alteracao_pos_aprovacao"));
    if (posAprov.length >= 2) {
      signals.push({
        signal_type: "alteracao_pos_aprovacao",
        entity_type: "fornecedor",
        entity_ref: "múltiplos",
        related_audit_result_ids: posAprov.map((r) => r.id),
        severity: "alta",
        confidence: 0.8,
        narrative: `${posAprov.length} documentos tiveram campos alterados entre a aprovação e o pagamento.`,
      });
    }

    // 4) Mudança bancária antes do pagamento
    const bancos = rows.filter((r) => (byResult.get(r.id) ?? []).includes("troca_dados_bancarios"));
    for (const r of bancos) {
      signals.push({
        signal_type: "mudanca_bancaria_pre_pagamento",
        entity_type: "fornecedor",
        entity_ref: r.fornecedor_code ?? r.fornecedor_name ?? "—",
        related_audit_result_ids: [r.id],
        severity: "critica",
        confidence: 0.9,
        narrative: `Dados bancários do fornecedor ${r.fornecedor_name ?? r.fornecedor_code} mudaram entre a aprovação e o pagamento de ${round(Number(r.valor_pago ?? 0))}.`,
      });
    }

    // 5) Duplicidade (mesmo fornecedor + valor em janela curta)
    const dupMap = new Map<string, any[]>();
    for (const r of rows) {
      const k = `${r.fornecedor_code ?? "?"}|${round(Number(r.valor_pago ?? 0))}`;
      dupMap.set(k, [...(dupMap.get(k) ?? []), r]);
    }
    for (const [k, list] of dupMap) {
      if (list.length >= 2 && Number(list[0].valor_pago ?? 0) > 0) {
        signals.push({
          signal_type: "duplicidade",
          entity_type: "fornecedor",
          entity_ref: k,
          related_audit_result_ids: list.map((r) => r.id),
          severity: "alta",
          confidence: 0.7,
          narrative: `${list.length} pagamentos de mesmo valor para o mesmo fornecedor no período — possível duplicidade.`,
        });
      }
    }

    // 6) Fornecedor novo com primeiro pagamento alto
    for (const [vendor, list] of perVendor) {
      if (list.length === 1 && Number(list[0].valor_pago ?? 0) >= 50000) {
        signals.push({
          signal_type: "fornecedor_novo_alto_valor",
          entity_type: "fornecedor",
          entity_ref: vendor,
          related_audit_result_ids: [list[0].id],
          severity: "media",
          confidence: 0.6,
          narrative: `Primeiro pagamento auditado do fornecedor ${vendor} já é de ${round(Number(list[0].valor_pago))}.`,
        });
      }
    }

    // 7) Distribuição temporal anômala (fim de semana / madrugada)
    const anomalos = rows.filter((r) => {
      const d = new Date(r.settlement_snapshot?.doc_date ?? r.audited_at);
      const wd = d.getUTCDay();
      return wd === 0 || wd === 6;
    });
    if (anomalos.length >= 3) {
      signals.push({
        signal_type: "distribuicao_temporal_anomala",
        entity_type: "projeto",
        entity_ref: "—",
        related_audit_result_ids: anomalos.map((r) => r.id),
        severity: "media",
        confidence: 0.55,
        narrative: `${anomalos.length} documentos com data de pagamento em fim de semana.`,
      });
    }

    // 8) Valores redondos recorrentes
    const redondos = rows.filter((r) => {
      const v = Number(r.valor_pago ?? 0);
      return v >= 1000 && v % 1000 === 0;
    });
    if (redondos.length >= 5) {
      signals.push({
        signal_type: "valores_redondos",
        entity_type: "fornecedor",
        entity_ref: "múltiplos",
        related_audit_result_ids: redondos.map((r) => r.id),
        severity: "baixa",
        confidence: 0.5,
        narrative: `${redondos.length} pagamentos com valores exatamente redondos (múltiplos de 1.000).`,
      });
    }

    // 9) Conluio solicitante ↔ aprovador em documentos sinalizados
    const pairCount = new Map<string, any[]>();
    for (const r of rows.filter((x) => x.has_findings)) {
      const aprovadores: string[] = r.baseline_snapshot?.aprovadores ?? [];
      for (const a of aprovadores) {
        const k = `${r.solicitante ?? "?"} ↔ ${a}`;
        pairCount.set(k, [...(pairCount.get(k) ?? []), r]);
      }
    }
    for (const [pair, list] of pairCount) {
      if (list.length >= 4) {
        signals.push({
          signal_type: "conluio_solicitante_aprovador",
          entity_type: "par_solicitante_aprovador",
          entity_ref: pair,
          related_audit_result_ids: list.map((r) => r.id),
          severity: "alta",
          confidence: round(Math.min(0.5 + list.length / 20, 0.9)),
          narrative: `O par ${pair} aparece em ${list.length} documentos com divergências.`,
        });
      }
    }

    // ---- Camada LLM: prioriza, correlaciona e narra (saída JSON estrita) ----
    let enriched = signals;
    if (LOVABLE_API_KEY && signals.length) {
      try {
        const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_API_KEY },
          body: JSON.stringify({
            model: "google/gemini-3-flash",
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "Você é um analista de auditoria de pagamentos. Recebe sinais JÁ CALCULADOS por regra determinística. Você NÃO decide se é fraude: apenas prioriza, correlaciona e escreve a narrativa em português do Brasil. Responda SOMENTE com JSON: {\"signals\":[{\"index\":number,\"severity\":\"baixa|media|alta|critica\",\"confidence\":number,\"narrative\":string}]}.",
              },
              { role: "user", content: JSON.stringify(signals.map((s, i) => ({ index: i, ...s, related_audit_result_ids: s.related_audit_result_ids.length }))) },
            ],
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
          for (const s of parsed.signals ?? []) {
            const target = enriched[Number(s.index)];
            if (!target) continue;
            if (s.severity) target.severity = s.severity;
            if (typeof s.confidence === "number") target.confidence = Math.max(0, Math.min(1, s.confidence));
            if (s.narrative) target.narrative = String(s.narrative);
          }
        }
      } catch (_) {
        // A camada LLM é opcional: sinais determinísticos seguem válidos.
      }
    }

    // Persiste sinais (substitui os abertos do período para não duplicar)
    await sb
      .from("audit_pay_fraud_signal")
      .delete()
      .eq("company_db", companyDb)
      .eq("status", "aberto")
      .gte("period_start", periodStart);

    if (enriched.length) {
      const { error } = await sb.from("audit_pay_fraud_signal").insert(
        enriched.map((s) => ({
          company_db: companyDb,
          signal_type: s.signal_type,
          entity_type: s.entity_type,
          entity_ref: s.entity_ref,
          related_audit_result_ids: s.related_audit_result_ids,
          severity: s.severity,
          confidence: s.confidence,
          narrative: s.narrative,
          status: "aberto",
          period_start: periodStart,
          period_end: new Date().toISOString(),
        })),
      );
      if (error) throw new Error(error.message);
    }

    return json({ ok: true, signals: enriched.length, analyzed: rows.length });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    const status = msg === "UNAUTHORIZED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return json({ error: msg }, status);
  }
});
