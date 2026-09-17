// Edge function: integra transações do PagCorp diretamente como CONTAS A PAGAR
// no Omie. Empresas que rodam sobre o Omie não usam Pedido de Compra nem
// Lançamento Contábil Manual para cartão corporativo.
//
// POST /functions/v1/pagcorp-to-omie
// Body: {
//   companyDb: string,
//   transactions: PagCorpTransaction[],   // uma conta a pagar por transação
//   supplierCode: string | number,        // codigo_cliente_fornecedor (Omie)
//   supplierName?: string,
//   categoryCode: string,                 // codigo_categoria (Omie)
//   currentAccountCode: string | number,  // id da conta corrente (Omie)
//   dueDate?: string,                     // YYYY-MM-DD (default: data da transação)
//   integratedBy?: string,
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { AuthError, authErrorResponse, requireUser } from "../_shared/auth.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import { callOmieApi, loadOmieCredentials } from "../_shared/omie-api.ts";
import { getIntegrationPause, pauseResponse } from "../_shared/integration-pause.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-company-db, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface PagCorpTx {
  id: string | number;
  description?: string;
  amount?: number;
  currency?: string;
  date?: string;
  accountAlias?: string;
  accountCode?: string;
  accountName?: string;
  cardId?: string | number;
  cardName?: string;
  cardLastDigits?: string;
  [key: string]: unknown;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value);
  const iso = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function toBrDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Texto da prestação de contas, quando o PagCorp devolve algum. */
function pickAccountabilityText(tx: Record<string, unknown>): string {
  const candidates: unknown[] = [
    tx.accountabilityDescription,
    tx.accountabilityObservation,
    tx.accountabilityJustification,
    tx.expenseAccountabilityDescription,
    tx.receiptDescription,
    tx.justification,
    tx.observation,
    tx.observations,
    tx.note,
    tx.notes,
    tx.comments,
  ];
  const receipts = Array.isArray(tx.receipts) ? (tx.receipts as Record<string, unknown>[]) : [];
  for (const r of receipts) {
    candidates.push(r?.description, r?.observation, r?.justification, r?.note, r?.notes, r?.comments);
  }
  for (const candidate of candidates) {
    const text = typeof candidate === "string" ? candidate.trim() : "";
    if (text) return text;
  }
  return "";
}

function buildObservation(tx: PagCorpTx): string {
  const base = String(tx.description || "").trim();
  const accountability = pickAccountabilityText(tx as Record<string, unknown>);
  const holder = String(tx.cardName || tx.accountAlias || tx.accountName || "").trim();
  const parts = [
    "PagCorp",
    holder,
    base,
    accountability && !base.toLowerCase().includes(accountability.toLowerCase()) ? accountability : "",
  ].filter(Boolean);
  return parts.join(" - ").slice(0, 490);
}

Deno.serve(async (req) => {
  const foreignOrigin = rejectForeignOrigin(req);
  if (foreignOrigin) return foreignOrigin;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não suportado" }, 405);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const companyDb = typeof body.companyDb === "string" ? body.companyDb.trim() : "";
    const supplierCode = String(body.supplierCode ?? "").trim();
    const supplierName = typeof body.supplierName === "string" ? body.supplierName : null;
    const categoryCode = String(body.categoryCode ?? "").trim();
    const currentAccountCode = String(body.currentAccountCode ?? "").trim();
    const dueDateOverride = toIsoDate(body.dueDate);
    const integratedBy = typeof body.integratedBy === "string" ? body.integratedBy : null;
    const transactions: PagCorpTx[] = Array.isArray(body.transactions)
      ? body.transactions
      : body.transaction
        ? [body.transaction]
        : [];

    if (!companyDb) return json({ error: "companyDb é obrigatório" }, 400);
    if (!supplierCode) return json({ error: "Selecione o fornecedor" }, 400);
    if (!categoryCode) return json({ error: "Selecione a categoria" }, 400);
    if (!currentAccountCode) return json({ error: "Selecione a conta corrente" }, 400);
    if (transactions.length === 0) return json({ error: "Nenhuma transação informada" }, 400);
    if (transactions.length > 100) return json({ error: "Máximo de 100 transações por vez" }, 400);

    // Autorização: usuário autenticado e liberado para a empresa Omie.
    let callerEmail: string | null = null;
    try {
      const caller = await requireUser(req);
      callerEmail = caller.email;
    } catch (authErr) {
      const resp = authErrorResponse(authErr, corsHeaders);
      if (resp) return resp;
      throw authErr;
    }
    if (!callerEmail) return json({ error: "Sessão sem e-mail — refaça o login" }, 401);

    const { data: allowed, error: allowErr } = await supabase.rpc(
      "is_email_allowed_for_omie_company",
      { _email: callerEmail, _company_db: companyDb },
    );
    if (allowErr) return json({ error: "Falha ao validar acesso à empresa" }, 500);
    if (allowed !== true) return json({ error: "Sem acesso a esta empresa" }, 403);

    const pause = await getIntegrationPause(supabase, companyDb);
    if (pause?.paused) return pauseResponse(pause, corsHeaders);

    const credentials = await loadOmieCredentials(supabase, companyDb);

    // Transações já integradas com sucesso não são reenviadas.
    const ids = transactions.map((t) => Number(t.id)).filter((n) => Number.isFinite(n));
    const { data: existingLogs } = await supabase
      .from("pagcorp_integration_log")
      .select("pagcorp_expense_id, sap_doc_num")
      .eq("company_db", companyDb)
      .eq("status", "success")
      .in("pagcorp_expense_id", ids);
    const alreadyDone = new Set((existingLogs || []).map((row: any) => Number(row.pagcorp_expense_id)));

    const results: Array<{
      id: string | number;
      success: boolean;
      skipped?: boolean;
      docNum?: number | null;
      error?: string;
    }> = [];

    for (const transaction of transactions) {
      const txId = Number(transaction.id);
      if (alreadyDone.has(txId)) {
        results.push({ id: transaction.id, success: true, skipped: true });
        continue;
      }

      const amount = Number(transaction.amount) || 0;
      const txDate = toIsoDate(transaction.date) || new Date().toISOString().slice(0, 10);
      const dueDate = dueDateOverride || txDate;
      const observation = buildObservation(transaction);

      const logInsert = await supabase
        .from("pagcorp_integration_log")
        .insert({
          pagcorp_expense_id: txId,
          pagcorp_data: {
            description: transaction.description,
            amount,
            currency: transaction.currency,
            date: transaction.date,
            accountAlias: transaction.accountAlias,
            accountCode: transaction.accountCode,
            accountName: transaction.accountName,
            cardId: transaction.cardId,
            cardName: transaction.cardName,
            cardLastDigits: transaction.cardLastDigits,
            postingType: "accounts_payable",
            erp: "omie",
          } as any,
          integration_type: "omie_accounts_payable",
          status: "pending",
          company_db: companyDb,
          integrated_by: integratedBy || callerEmail,
        } as any)
        .select("id")
        .single();

      if (logInsert.error) {
        results.push({ id: transaction.id, success: false, error: `Falha ao registrar log: ${logInsert.error.message}` });
        continue;
      }
      const logId = (logInsert.data as any).id;

      const payload = {
        codigo_lancamento_integracao: `PAGCORP-${txId}`,
        codigo_cliente_fornecedor: Number(supplierCode),
        data_vencimento: toBrDate(dueDate),
        data_previsao: toBrDate(dueDate),
        data_emissao: toBrDate(txDate),
        valor_documento: amount,
        codigo_categoria: categoryCode,
        id_conta_corrente: Number(currentAccountCode),
        numero_documento: String(txId),
        observacao: observation,
      };

      try {
        const response = await callOmieApi<any>(
          credentials,
          "financas/contapagar/",
          "IncluirContaPagar",
          payload,
        );
        const omieId = Number(response?.codigo_lancamento_omie) || null;
        await supabase
          .from("pagcorp_integration_log")
          .update({
            status: "success",
            sap_doc_entry: omieId,
            sap_doc_num: omieId,
            sap_payload: payload as any,
            sap_response: { omie: response, postingType: "accounts_payable" } as any,
          } as any)
          .eq("id", logId);
        results.push({ id: transaction.id, success: true, docNum: omieId });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erro desconhecido";
        await supabase
          .from("pagcorp_integration_log")
          .update({
            status: "error",
            error_message: message.slice(0, 1000),
            sap_payload: payload as any,
          } as any)
          .eq("id", logId);
        results.push({ id: transaction.id, success: false, error: message });
      }
    }

    const created = results.filter((r) => r.success && !r.skipped).length;
    const failed = results.filter((r) => !r.success);

    try {
      await supabase.rpc("insert_audit_log", {
        p_action: "pagcorp_omie_accounts_payable_integrated",
        p_entity_type: "pagcorp_transaction",
        p_entity_id: transactions.map((t) => String(t.id)).join(","),
        p_company_db: companyDb,
        p_actor_email: integratedBy || callerEmail || undefined,
        p_details: {
          created,
          failed: failed.length,
          supplier_code: supplierCode,
          supplier_name: supplierName,
          category_code: categoryCode,
          current_account_code: currentAccountCode,
        } as any,
      });
    } catch (auditErr) {
      console.warn("pagcorp-to-omie audit log failed:", auditErr);
    }

    return json({
      success: failed.length === 0,
      created,
      skipped: results.filter((r) => r.skipped).length,
      failed: failed.length,
      results,
      ...(failed.length > 0 ? { error: failed[0].error } : {}),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return json({ error: error.message }, error.status);
    }
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("pagcorp-to-omie failed:", message);
    return json({ error: message }, 500);
  }
});
