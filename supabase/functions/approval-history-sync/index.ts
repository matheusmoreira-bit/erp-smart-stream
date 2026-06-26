import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireAdminOrSapSession, authErrorResponse } from "../_shared/auth.ts";
import { tryWatcherLock, releaseWatcherLock, isTestCompanyDb } from "../_shared/watcher-lock.ts";

/**
 * approval-history-sync
 * --------------------------------------------------------------
 * Importa o histórico/fila de aprovações a partir de um webhook n8n
 * (Ana Gaming) para a tabela local public.approval_history.
 *
 * O webhook retorna um array com um único objeto { data: [...] }
 * em que cada item representa uma combinação aprovação × aprovador.
 *
 * Atualmente o payload traz apenas pedidos em aberto (sem decisão),
 * portanto decision é gravado como "P" (pending) por padrão.
 */

const WEBHOOK_URL =
  Deno.env.get("APPROVAL_HISTORY_WEBHOOK_URL") ||
  "https://anagaming.app.n8n.cloud/webhook/496a9d2a-2ff0-4e7c-9d2e-755900bb040a";


const DOC_TYPE_TO_OBJECT: Record<string, string> = {
  "Pedido de Compra": "22",
  "Solicitação de Compra": "1470000113",
  "Nota Fiscal de Entrada": "18",
  "Pagamento Efetuado": "540000006",
  "Solicitação de Pagamento": "112",
  "Pedido de Venda": "17",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number | null {
  const n = toNumber(v);
  return n === null ? null : Math.trunc(n);
}

function toIsoDate(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeCurrency(v: unknown): string | null {
  const s = (v == null ? "" : String(v)).trim();
  if (!s) return null;
  if (s === "R$" || /reais?/i.test(s)) return "BRL";
  if (s === "US$" || /^USD?$/i.test(s) || /d[oó]lar/i.test(s)) return "USD";
  if (s === "€" || /^EUR$/i.test(s) || /euro/i.test(s)) return "EUR";
  return s.toUpperCase().slice(0, 8);
}

interface WebhookRow {
  Empresa?: string;
  Code?: number;
  Aprovador?: string;
  "Email do aprovador"?: string;
  "Código da resposta do aprovador"?: string;
  "Resposta do aprovador"?: string;
  "Comentário do aprovador"?: string | null;
  "Data da resposta do aprovador"?: string | null;
  "Hora da resposta do aprovador"?: string | null;
  "Tipo de solicitação"?: string;
  "Draft DocEntry"?: number;
  "Nº do documento"?: number;
  Solicitante?: string;
  "Código PN/Fornecedor"?: string;
  "Fornecedor / Parceiro"?: string;
  "Código da moeda original"?: string;
  "Valor do documento na moeda original"?: number;
  "Valor total"?: number;
  "Data do documento"?: string;
  "Data de criação"?: string;
  "Data de vencimento"?: string;
  Observações?: string;
  "Modelo de aprovação"?: string;
}

// W = Waiting/Pending, Y = Approved, N = Rejected
function mapDecision(code: unknown): string {
  const s = (code == null ? "" : String(code)).trim().toUpperCase();
  if (s === "Y" || s === "A") return "Y";
  if (s === "N" || s === "R") return "N";
  return "P";
}

function combineDateTime(date?: string | null, time?: string | null): string | null {
  if (!date) return null;
  const baseIso = toIsoDate(date);
  if (!baseIso) return null;
  if (!time) return baseIso;
  let hh = 0, mm = 0, ss = 0;
  const t = String(time).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) {
    const parts = t.split(":").map((p) => parseInt(p, 10));
    hh = parts[0] || 0; mm = parts[1] || 0; ss = parts[2] || 0;
  } else if (/^\d{3,4}$/.test(t)) {
    const n = parseInt(t, 10);
    hh = Math.floor(n / 100); mm = n % 100;
  }
  const d = new Date(baseIso);
  d.setUTCHours(hh, mm, ss, 0);
  return d.toISOString();
}

function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function resolveCompanyDb(
  empresa: string | undefined,
  lookup: Map<string, string>,
  fallback: string,
): string {
  if (!empresa) return fallback;
  const key = normalizeName(empresa);
  return lookup.get(key) || fallback;
}

function mapRow(r: WebhookRow, companyDb: string) {
  const code = r.Code != null ? String(r.Code) : "";
  const email = (r["Email do aprovador"] || "").toLowerCase().trim();
  const docType = r["Tipo de solicitação"] || null;
  const objectType = docType ? DOC_TYPE_TO_OBJECT[docType] || null : null;
  const total =
    toNumber(r["Valor total"]) ??
    toNumber(r["Valor do documento na moeda original"]);
  const decision = mapDecision(r["Código da resposta do aprovador"]);
  const decisionDate =
    decision === "P"
      ? null
      : combineDateTime(
          r["Data da resposta do aprovador"],
          r["Hora da resposta do aprovador"],
        );
  const comment = (r["Comentário do aprovador"] || "").trim() || null;
  const obs = (r.Observações || "").trim() || null;
  const remarks = [comment, obs].filter(Boolean).join("\n\n") || null;

  return {
    external_id: `${code}::${email || "unknown"}`,
    company_db: companyDb,
    decision,
    decision_date: decisionDate,
    approver_code: null,
    approver_name: r.Aprovador || null,
    approver_email: r["Email do aprovador"] || null,
    requester_code: null,
    requester_name: r.Solicitante || null,
    doc_object_type: objectType,
    doc_type_name: docType,
    doc_entry: toInt(r["Draft DocEntry"]),
    doc_num: toInt(r["Nº do documento"]),
    doc_total: total,
    currency: normalizeCurrency(r["Código da moeda original"]),
    card_code: r["Código PN/Fornecedor"] || null,
    card_name: r["Fornecedor / Parceiro"] || null,
    remarks,
    stage_name: r["Modelo de aprovação"] || null,
    step: null,
    raw: r as unknown as Record<string, unknown>,
    synced_at: new Date().toISOString(),
  };
}


async function updateSyncState(
  supabase: ReturnType<typeof createClient>,
  status: string,
  message: string,
  count: number,
) {
  await supabase.from("approval_history_sync_state").upsert(
    {
      id: 1,
      last_sync_at: new Date().toISOString(),
      last_status: status,
      last_message: message,
      last_count: count,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let lockAcquired = false;
  try {
    try {
      await requireAdminOrSapSession(req);
    } catch (err) {
      const r = authErrorResponse(err, corsHeaders);
      if (r) return r;
      throw err;
    }

    // Lock anti-execução-paralela
    lockAcquired = await tryWatcherLock(supabase, "approval-history-sync", 20);
    if (!lockAcquired) {
      return jsonResponse({ success: true, skipped: "another_run_in_progress" });
    }

    let body: { companyDb?: string } = {};
    try { body = await req.json(); } catch { /* no body */ }
    const companyDb = (body.companyDb || "").trim();
    if (!companyDb) {
      await releaseWatcherLock(supabase, "approval-history-sync", "error", "companyDb missing");
      return jsonResponse({ success: false, error: "companyDb é obrigatório" }, 400);
    }

    const res = await fetch(WEBHOOK_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Webhook HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch {
      throw new Error(`Resposta inesperada do webhook: ${text.slice(0, 300)}`);
    }

    const groups: Array<{ data?: WebhookRow[] }> = Array.isArray(parsed)
      ? (parsed as Array<{ data?: WebhookRow[] }>)
      : [parsed as { data?: WebhookRow[] }];

    const rows: WebhookRow[] = [];
    for (const g of groups) {
      if (Array.isArray(g?.data)) rows.push(...g.data);
    }

    if (rows.length === 0) {
      await updateSyncState(supabase, "success", "Nenhum registro recebido", 0);
      await releaseWatcherLock(supabase, "approval-history-sync", "ok", "no rows");
      return jsonResponse({ success: true, received: 0, upserted: 0 });
    }

    // Mapa empresa (display_name normalizado) -> company_db
    const { data: companiesData } = await supabase
      .from("companies")
      .select("company_db,display_name");
    const companyLookup = new Map<string, string>();
    for (const c of (companiesData || []) as Array<{ company_db: string; display_name: string }>) {
      companyLookup.set(normalizeName(c.display_name), c.company_db);
      companyLookup.set(normalizeName(c.company_db), c.company_db);
    }

    // Deduplica por (company_db, external_id), filtrando teste e linhas sem empresa
    const mapped = new Map<string, ReturnType<typeof mapRow>>();
    let skippedTest = 0;
    let skippedUnknownCompany = 0;
    for (const r of rows) {
      // Detecta linhas sem campo Empresa reconhecível: vão para quarentena (não usa fallback silencioso)
      const rawEmpresa = (r.Empresa || "").trim();
      const resolved = resolveCompanyDb(rawEmpresa, companyLookup, "");
      if (!resolved) {
        skippedUnknownCompany++;
        console.warn(`[approval-history-sync] linha sem Empresa reconhecível (Code=${r.Code}): "${rawEmpresa}" — ignorada`);
        continue;
      }
      if (isTestCompanyDb(resolved)) {
        skippedTest++;
        continue;
      }
      const row = mapRow(r, resolved);
      if (row.external_id.startsWith("::")) continue;
      mapped.set(`${row.company_db}::${row.external_id}`, row);
    }
    const payload = Array.from(mapped.values());

    // Máquina de estado: NÃO sobrescrever decisão final (Y/N) com pendente (P).
    // Pré-carrega decisões atuais e filtra do payload os updates que regrediram.
    const externalIds = payload.map((p) => p.external_id);
    const existingByKey = new Map<string, string>();
    if (externalIds.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < externalIds.length; i += CHUNK) {
        const ids = externalIds.slice(i, i + CHUNK);
        const { data: existing } = await supabase
          .from("approval_history")
          .select("company_db,external_id,decision")
          .in("external_id", ids);
        for (const e of (existing || []) as Array<{ company_db: string; external_id: string; decision: string | null }>) {
          existingByKey.set(`${e.company_db}::${e.external_id}`, e.decision || "");
        }
      }
    }
    let skippedRegression = 0;
    const safePayload = payload.filter((p) => {
      const prev = existingByKey.get(`${p.company_db}::${p.external_id}`);
      if ((prev === "Y" || prev === "N") && p.decision === "P") {
        skippedRegression++;
        console.warn(`[approval-history-sync] decisão final (${prev}) preservada em ${p.company_db}::${p.external_id} — pendente ignorado`);
        return false;
      }
      return true;
    });

    // Upsert em lotes
    const BATCH = 200;
    let upserted = 0;
    for (let i = 0; i < safePayload.length; i += BATCH) {
      const slice = safePayload.slice(i, i + BATCH);
      const { error } = await supabase
        .from("approval_history")
        .upsert(slice, { onConflict: "company_db,external_id" });
      if (error) throw new Error(error.message);
      upserted += slice.length;
    }

    const summary = `Sincronizados ${upserted} (teste:${skippedTest}, sem-empresa:${skippedUnknownCompany}, regressões:${skippedRegression})`;
    await updateSyncState(supabase, "success", summary, upserted);
    await releaseWatcherLock(supabase, "approval-history-sync", "ok", summary);

    return jsonResponse({
      success: true,
      received: rows.length,
      upserted,
      skipped: { test: skippedTest, unknown_company: skippedUnknownCompany, regression: skippedRegression },
      companyDb,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await updateSyncState(supabase, "error", message, 0).catch(() => {});
    if (lockAcquired) await releaseWatcherLock(supabase, "approval-history-sync", "error", message);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
