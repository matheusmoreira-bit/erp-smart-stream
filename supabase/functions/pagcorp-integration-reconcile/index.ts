// Reconciliação PagCorp ⇄ ERP Flow / SAP.
//
// Problema tratado: quando o pedido de compra é criado a partir de uma
// transação do cartão mas o registro em `pagcorp_integration_log` não é
// gravado (falha tardia, integração disparada depois pela tela de Compras,
// retry/watcher, sessão SAP expirada no meio do fluxo), a transação continua
// aparecendo como "não integrada" no PagCorp, mesmo já existindo o pedido
// no SAP.
//
// Esta função recebe as transações exibidas na tela e, para as que não têm
// log, procura a despesa correspondente (origin=pagcorp, mesma empresa, já
// com DocEntry no SAP, mesmo valor/moeda e descrição equivalente) e recria
// o vínculo — deixando o status correto para todas as transações com o
// mesmo tipo de problema, não só para um caso pontual.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireUserOrSapSessionHeaders, authErrorResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface TxInput {
  id?: number | string;
  description?: string;
  amount?: number | string;
  currency?: string;
  date?: string;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/^PAGCORP\s*-\s*/, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function daysBetween(a: string | null, b: string | null): number {
  if (!a || !b) return 9999;
  const diff = Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime());
  return Math.round(diff / 86_400_000);
}

/** Descrições curtas geram falso positivo — exigimos um mínimo de sinal. */
const MIN_DESCRIPTION_SIGNAL = 6;
const MAX_DATE_DISTANCE_DAYS = 120;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    await requireUserOrSapSessionHeaders(req);
  } catch (err) {
    const authResp = authErrorResponse(err, corsHeaders);
    if (authResp) return authResp;
    return json({ error: "Não autenticado" }, 401);
  }

  let body: { companyDb?: string; transactions?: TxInput[]; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const companyDb = String(body.companyDb || "").trim();
  if (!companyDb) return json({ error: "companyDb obrigatório" }, 400);

  const transactions = (Array.isArray(body.transactions) ? body.transactions : [])
    .map((t) => ({
      id: Number(t.id),
      description: String(t.description || ""),
      amount: Number(t.amount),
      currency: String(t.currency || "BRL").toUpperCase(),
      date: toIsoDate(t.date),
    }))
    .filter((t) => Number.isFinite(t.id) && t.id > 0 && Number.isFinite(t.amount) && t.amount > 0)
    .slice(0, 500);

  if (transactions.length === 0) return json({ created: 0, links: [] });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1. Transações que já possuem log nesta empresa não são reconciliadas.
    const { data: existingLogs, error: logsErr } = await admin
      .from("pagcorp_integration_log")
      .select("pagcorp_expense_id, pagcorp_data, sap_doc_entry")
      .eq("company_db", companyDb);
    if (logsErr) throw logsErr;

    const linkedTxIds = new Set<number>();
    const linkedExpenseIds = new Set<string>();
    const linkedDocEntries = new Set<number>();
    for (const row of existingLogs || []) {
      linkedTxIds.add(Number(row.pagcorp_expense_id));
      const internal = (row.pagcorp_data as Record<string, unknown> | null)?.internalExpenseId;
      if (internal) linkedExpenseIds.add(String(internal));
      if (row.sap_doc_entry) linkedDocEntries.add(Number(row.sap_doc_entry));
    }

    const pending = transactions.filter((t) => !linkedTxIds.has(t.id));
    if (pending.length === 0) return json({ created: 0, links: [] });

    // 2. Despesas de cartão já integradas ao SAP nesta empresa.
    const oldest = pending
      .map((t) => t.date)
      .filter((d): d is string => !!d)
      .sort()[0];
    const since = oldest
      ? new Date(new Date(`${oldest}T00:00:00Z`).getTime() - MAX_DATE_DISTANCE_DAYS * 86_400_000)
        .toISOString()
      : new Date(Date.now() - 365 * 86_400_000).toISOString();

    const { data: expenses, error: expErr } = await admin
      .from("expenses")
      .select("id, remarks, total_amount, currency, sap_doc_entry, sap_doc_num, doc_date, created_at, status")
      .eq("company_db", companyDb)
      .eq("origin", "pagcorp")
      .not("sap_doc_entry", "is", null)
      .neq("status", "cancelado")
      .gte("created_at", since)
      .limit(3000);
    if (expErr) throw expErr;

    const candidates = (expenses || [])
      .filter((e) => !linkedExpenseIds.has(String(e.id)) && !linkedDocEntries.has(Number(e.sap_doc_entry)))
      .map((e) => ({
        id: String(e.id),
        remarks: normalizeText(e.remarks),
        amount: Number(e.total_amount),
        currency: String(e.currency || "BRL").toUpperCase(),
        docEntry: Number(e.sap_doc_entry),
        docNum: e.sap_doc_num == null ? null : Number(e.sap_doc_num),
        date: toIsoDate(e.doc_date) || toIsoDate(e.created_at),
      }));

    const used = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    const links: Array<Record<string, unknown>> = [];

    for (const tx of pending) {
      const needle = normalizeText(tx.description);
      if (needle.length < MIN_DESCRIPTION_SIGNAL) continue;

      const matches = candidates
        .filter((c) =>
          !used.has(c.id) &&
          c.currency === tx.currency &&
          Math.abs(c.amount - tx.amount) <= 0.02 &&
          (c.remarks.includes(needle) || needle.includes(c.remarks)) &&
          c.remarks.length >= MIN_DESCRIPTION_SIGNAL &&
          daysBetween(c.date, tx.date) <= MAX_DATE_DISTANCE_DAYS
        )
        .sort((a, b) => daysBetween(a.date, tx.date) - daysBetween(b.date, tx.date));

      // Ambiguidade (mesma descrição/valor em mais de uma despesa livre) não é
      // reconciliada automaticamente para não criar vínculo errado.
      if (matches.length !== 1) continue;
      const match = matches[0];
      used.add(match.id);

      rows.push({
        pagcorp_expense_id: tx.id,
        pagcorp_data: {
          description: tx.description,
          amount: tx.amount,
          currency: tx.currency,
          date: tx.date,
          internalExpenseId: match.id,
          reconciled: true,
          reconciled_at: new Date().toISOString(),
        },
        integration_type: "accountability",
        status: "success",
        company_db: companyDb,
        integrated_by: "reconciliação automática",
        sap_doc_entry: match.docEntry,
        sap_doc_num: match.docNum,
      });
      links.push({
        pagcorpExpenseId: tx.id,
        expenseId: match.id,
        docEntry: match.docEntry,
        docNum: match.docNum,
      });
    }

    if (rows.length === 0) return json({ created: 0, links: [] });
    if (body.dryRun) return json({ created: 0, dryRun: true, links });

    const { error: insErr } = await admin.from("pagcorp_integration_log").insert(rows);
    if (insErr) throw insErr;

    await admin.from("audit_log").insert({
      action: "pagcorp_integration_reconciled",
      entity_type: "pagcorp_integration_log",
      entity_id: null,
      company_db: companyDb,
      details: { created: rows.length, links },
    }).then(() => {}, () => {});

    return json({ created: rows.length, links });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pagcorp-integration-reconcile] error", message);
    return json({ error: message }, 500);
  }
});
