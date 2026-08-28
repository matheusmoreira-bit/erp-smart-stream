import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { classifyPagCorpDocuments, isPagCorpAiEligible } from "@/lib/pagcorp-document-classification";
import { extractPagCorpAccountability } from "@/lib/pagcorp-accountability";

// ---------------------------------------------------------------------------
// In-memory cache for pagcorp-integration-status
// Reduz chamadas repetidas quando o usuário navega entre telas / refaz o
// mesmo filtro. TTL curto para não mascarar mudanças reais (integração
// acabou de rodar, marcações de não-dedutíveis, etc.).
// ---------------------------------------------------------------------------
const INTEGRATION_STATUS_TTL_MS = 30_000;
const INTEGRATION_STATUS_CHUNK = 5000;

type IntegrationStatusPayload = {
  integrations: any[];
  relations: any[];
  nondeductibleCards: any[];
  nondeductibleExpenses: any[];
  classifications: any[];
};

const integrationStatusCache = new Map<string, { at: number; data: IntegrationStatusPayload }>();
const integrationStatusInflight = new Map<string, Promise<IntegrationStatusPayload>>();
let lastIntegrationStatusWarnAt = 0;

// Reconciliação automática (PagCorp ⇄ despesa já integrada ao SAP):
// roda no máximo uma vez a cada 2 min por empresa, para transações que
// aparecem como "não integradas" mas podem ter pedido no SAP.
const RECONCILE_COOLDOWN_MS = 120_000;
const lastReconcileAt = new Map<string, number>();

function integrationStatusKey(companyDb: string, ids: number[]): string {
  // Ordena e junta para gerar chave estável independente da ordem do array.
  const sorted = [...ids].sort((a, b) => a - b);
  return `${companyDb}::${sorted.length}::${sorted.join(",")}`;
}

async function fetchIntegrationStatus(
  companyDb: string,
  expenseIds: number[],
): Promise<IntegrationStatusPayload> {
  const key = integrationStatusKey(companyDb, expenseIds);

  // 1. Cache hit válido
  const cached = integrationStatusCache.get(key);
  if (cached && Date.now() - cached.at < INTEGRATION_STATUS_TTL_MS) {
    return cached.data;
  }

  // 2. Dedupe requisições concorrentes com a mesma chave
  const inflight = integrationStatusInflight.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    const { sapFunctionFetch } = await import("@/lib/auth-fetch");
    const merged: IntegrationStatusPayload = {
      integrations: [],
      relations: [],
      nondeductibleCards: [],
      nondeductibleExpenses: [],
      classifications: [],
    };
    const seenCards = new Set<string>();

    // Chunk defensivo: a edge function limita a 5000 ids por chamada.
    for (let i = 0; i < Math.max(expenseIds.length, 1); i += INTEGRATION_STATUS_CHUNK) {
      const chunk = expenseIds.slice(i, i + INTEGRATION_STATUS_CHUNK);
      const res = await sapFunctionFetch("pagcorp-integration-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyDb, expenseIds: chunk }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(body.error || body.warning || `pagcorp-integration-status ${res.status}`));
      }
      const {
        integrations = [],
        relations = [],
        nondeductibleCards = [],
        nondeductibleExpenses = [],
        classifications = [],
      } = await res.json();

      merged.integrations.push(...(integrations as any[]));
      merged.relations.push(...(relations as any[]));
      merged.nondeductibleExpenses.push(...(nondeductibleExpenses as any[]));
      merged.classifications.push(...(classifications as any[]));
      // Cartões não dependem de expenseIds; dedupe por card_identifier.
      for (const c of nondeductibleCards as any[]) {
        const cid = String(c?.card_identifier ?? "");
        if (!cid || seenCards.has(cid)) continue;
        seenCards.add(cid);
        merged.nondeductibleCards.push(c);
      }

      if (expenseIds.length === 0) break; // um único fetch "vazio"
    }

    integrationStatusCache.set(key, { at: Date.now(), data: merged });
    return merged;
  })();

  integrationStatusInflight.set(key, promise);
  try {
    return await promise;
  } finally {
    integrationStatusInflight.delete(key);
  }
}

/**
 * Invalida o cache de integration-status. Chamar após ações que mudam o
 * estado no servidor (integrar, reverter, marcar não-dedutível).
 */
export function invalidatePagCorpIntegrationStatus(companyDb?: string) {
  if (!companyDb) {
    integrationStatusCache.clear();
    return;
  }
  for (const k of integrationStatusCache.keys()) {
    if (k.startsWith(`${companyDb}::`)) integrationStatusCache.delete(k);
  }
}

export interface PagCorpTransaction {
  id: string | number;
  date: string;
  description: string;
  amount: number;
  currency?: string;
  accountCode?: string;
  accountName?: string;
  accountAlias?: string;
  cardId?: string | number;
  cardName?: string;
  cardLastDigits?: string;
  eventClassification?: string;
  status?: string;
  /** Razão social do estabelecimento identificada pela IA do PagCorp (aiAnalysis). */
  merchantName?: string | null;
  /** CNPJ do estabelecimento (aiAnalysis) — pode ser alfanumérico; sempre string. */
  merchantTaxId?: string | null;
  documentAnalysisStatus?: "pending" | "processing" | "completed" | "error";
  /** True only after pagcorp-integration-status was read successfully for this row. */
  integrationStatusResolved?: boolean;
  hasFiscalDocument?: boolean | null;
  documentKinds?: string[];
  documentAnalysisError?: string | null;
  postingType?: "purchase_order" | "journal_entry";

  hasAccountability?: boolean;
  accountabilityApproved?: boolean;
  accountabilityId?: string | number | null;
  accountabilityDate?: string | null;
  accountabilityDescription?: string | null;
  accountabilityStatus?: string | null;
  accountabilityApprovedAt?: string | null;
  accountabilityApproverName?: string | null;
  attachments?: unknown[];
  receipts?: any[];
  integrated?: boolean;
  integrationLogId?: string;
  sapDocNum?: number | null;
  sapDocEntry?: number | null;
  /**
   * Uma transação pode gerar N pedidos de compra quando os anexos trazem
   * notas de fornecedores/CNPJs diferentes. Aqui ficam TODOS os vínculos
   * (o primeiro também é espelhado nos campos singulares acima, para
   * compatibilidade com as telas que leem só um pedido).
   */
  integrationLinks?: Array<{
    logId: string;
    docNum: number | null;
    docEntry: number | null;
    settlementStatus: string | null;
    settlementPaymentDocNum: number | null;
    settlementError: string | null;
    /** NF de entrada encontrada no SAP para o pedido (mesmo lançada manualmente). */
    nfFound?: boolean;
    /** Pagamento (baixa) encontrado no SAP para o pedido. */
    paymentFound?: boolean;
    postingType?: "purchase_order" | "journal_entry";
  }>;
  settlementStatus?: string | null;
  settlementPaymentDocNum?: number | null;
  settlementError?: string | null;
  /** Verdadeiro quando todos os pedidos da transação já têm NF no SAP. */
  nfFoundInSap?: boolean;
  /** Verdadeiro quando todos os pedidos da transação já têm pagamento no SAP. */
  paymentFoundInSap?: boolean;

  isReversed?: boolean;
  isNondeductible?: boolean;
  nondeductibleAtExpense?: boolean;
  nondeductibleSupplierCode?: string;
  nondeductibleSupplierName?: string;
  [key: string]: unknown;
}

function enrichPagCorpAccountability(transaction: PagCorpTransaction): PagCorpTransaction {
  const details = extractPagCorpAccountability(transaction);
  const receipts = Array.isArray(transaction.receipts) ? transaction.receipts : [];
  transaction.hasAccountability = receipts.length > 0
    || details.id != null
    || details.date != null
    || details.description != null;
  transaction.accountabilityApproved = Number(transaction.statusId) === 3
    || receipts.some((receipt) => Number(receipt?.statusId) === 3);
  transaction.accountabilityId = transaction.accountabilityId ?? details.id;
  transaction.accountabilityDate = details.date;
  transaction.accountabilityDescription = details.description;
  transaction.accountabilityStatus = details.status;
  transaction.accountabilityApprovedAt = details.approvedAt;
  transaction.accountabilityApproverName = details.approverName;
  return transaction;
}

/**
 * Aplica (in-place) o status de integração/baixa e as marcações de
 * não-dedutibilidade em uma lista de transações. Usado tanto no fetch novo
 * quanto na pintura a partir do cache — assim o cache nunca "congela" um
 * status antigo (ex.: NF/baixa lançadas manualmente no SAP depois).
 */
async function applyIntegrationStatus(
  items: PagCorpTransaction[],
  companyDb: string,
): Promise<boolean> {
  const expenseIds = items
    .map((t) => Number(t.id))
    .filter((id) => Number.isFinite(id) && !Number.isNaN(id));
  try {
    const {
      integrations = [],
      relations = [],
      nondeductibleCards = [],
      nondeductibleExpenses = [],
      classifications = [],
    } = await fetchIntegrationStatus(companyDb, expenseIds);

    items.forEach((transaction) => {
      transaction.integrationStatusResolved = true;
    });

    const classificationMap = new Map<number, any>();
    (classifications as any[]).forEach((row) => classificationMap.set(Number(row.pagcorp_expense_id), row));
    items.forEach((transaction) => {
      const row = classificationMap.get(Number(transaction.id));
      transaction.documentAnalysisStatus = row?.status || "pending";
      transaction.hasFiscalDocument = row?.has_fiscal_document ?? null;
      transaction.documentKinds = Array.isArray(row?.document_kinds) ? row.document_kinds : [];
      transaction.documentAnalysisError = row?.error_message ?? null;
      transaction.postingType = row?.has_fiscal_document === true ? "purchase_order" : row?.status === "completed" ? "journal_entry" : undefined;
    });

    // Relações reais no SAP (NF de entrada / pagamento) por log.
    const relByLog = new Map<string, { nf: boolean; pay: boolean }>();
    (relations as any[]).forEach((r) => {
      relByLog.set(String(r.pagcorp_log_id), { nf: !!r.nf_found, pay: !!r.payment_found });
    });

    type Link = NonNullable<PagCorpTransaction["integrationLinks"]>[number];
    const integratedMap = new Map<number, Link[]>();
    (integrations as any[]).forEach((log) => {
      const key = Number(log.pagcorp_expense_id);
      const rel = relByLog.get(String(log.id));
      const postingType = log.integration_type === "journal_entry" || log.pagcorp_data?.postingType === "journal_entry"
        ? "journal_entry"
        : "purchase_order";
      const link: Link = {
        logId: log.id,
        docNum: log.sap_doc_num ?? null,
        docEntry: log.sap_doc_entry ?? null,
        settlementStatus: log.settlement_status ?? null,
        settlementPaymentDocNum: log.settlement_payment_doc_num ?? null,
        settlementError: log.settlement_error ?? null,
        nfFound: rel?.nf ?? false,
        paymentFound: rel?.pay ?? false,
        postingType,
      };
      const list = integratedMap.get(key);
      if (list) list.push(link);
      else integratedMap.set(key, [link]);
    });

    items.forEach((t) => {
      const links = integratedMap.get(Number(t.id));
      if (!links || links.length === 0) {
        // Sem log nesta empresa: limpa qualquer resíduo vindo do cache.
        t.integrated = false;
        t.integrationLinks = undefined;
        t.nfFoundInSap = false;
        t.paymentFoundInSap = false;
        return;
      }
      links.sort((a, b) => (a.docNum ?? 0) - (b.docNum ?? 0));
      const hit = links[0];
      t.integrated = true;
      t.integrationLinks = links;
      t.integrationLogId = hit.logId;
      t.postingType = hit.postingType;
      t.sapDocNum = hit.docNum;
      t.sapDocEntry = hit.docEntry;
      // Fatos do SAP: NF/pagamento existentes valem para todos os pedidos.
      t.nfFoundInSap = links.every((l) => l.nfFound || l.paymentFound);
      t.paymentFoundInSap = links.every((l) => l.paymentFound);
      const statuses = links.map((l) => l.settlementStatus);
      t.settlementStatus = t.paymentFoundInSap
        ? "settled"
        : statuses.some((s) => s === "error")
          ? "error"
          : statuses.every((s) => s === "settled")
            ? "settled"
            : statuses.find((s) => s && s !== "settled") ?? hit.settlementStatus;
      t.settlementPaymentDocNum = hit.settlementPaymentDocNum;
      t.settlementError = t.paymentFoundInSap
        ? null
        : links.find((l) => l.settlementError)?.settlementError ?? null;
    });

    // Não-dedutíveis por cartão
    if ((nondeductibleCards as any[]).length) {
      const map = new Map<string, { code: string; name?: string }>();
      (nondeductibleCards as any[]).forEach((c) =>
        map.set(String(c.card_identifier), { code: c.supplier_code, name: c.supplier_name }),
      );
      items.forEach((t) => {
        const key = (t.cardLastDigits && String(t.cardLastDigits).trim()) ||
          (t.cardName && String(t.cardName).trim()) || "";
        const hit = key ? map.get(key) : undefined;
        if (hit) {
          t.isNondeductible = true;
          t.nondeductibleSupplierCode = hit.code;
          t.nondeductibleSupplierName = hit.name;
        }
      });
    }

    // Overrides por expense (prevalece sobre o do cartão)
    if ((nondeductibleExpenses as any[]).length) {
      const map = new Map<number, { code?: string; name?: string }>();
      (nondeductibleExpenses as any[]).forEach((r) =>
        map.set(Number(r.pagcorp_expense_id), {
          code: r.supplier_code || undefined,
          name: r.supplier_name || undefined,
        }),
      );
      items.forEach((t) => {
        const hit = map.get(Number(t.id));
        if (hit) {
          t.isNondeductible = true;
          t.nondeductibleAtExpense = true;
          if (hit.code) t.nondeductibleSupplierCode = hit.code;
          if (hit.name) t.nondeductibleSupplierName = hit.name;
        }
      });
    }
  } catch (e) {
    items.forEach((transaction) => {
      transaction.integrationStatusResolved = false;
    });
    const now = Date.now();
    if (now - lastIntegrationStatusWarnAt > 30_000) {
      lastIntegrationStatusWarnAt = now;
      console.warn("PagCorp integration-status fetch failed:", e);
    }
    return false;
  }
  return true;
}

export function usePagCorp() {

  const [transactions, setTransactions] = useState<PagCorpTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = useCallback(async (startDate?: string, endDate?: string, companyDb?: string) => {
    setError(null);
    const cacheKey = `pagcorp:txns:${startDate || ""}:${endDate || ""}`;

    // 1. Stale-while-revalidate: paint cached data instantly when available.
    let hadCache = false;
    if (companyDb) {
      try {
        const { readCache } = await import("@/lib/external-cache");
        const cached = await readCache<PagCorpTransaction[]>(cacheKey, companyDb);
        if (cached?.data?.length) {
          hadCache = true;
          cached.data.forEach(enrichPagCorpAccountability);
          // O cache guarda os dados do PagCorp, mas o status de integração /
          // NF / baixa muda no SAP a qualquer momento. Revalida ANTES de
          // publicar na tela para não disparar IA sobre status `pending`
          // armazenado em cache visual antigo.
          await applyIntegrationStatus(cached.data, companyDb);
          setTransactions([...cached.data]);
        }

      } catch {/* ignore cache errors */}
    }
    if (!hadCache) setIsLoading(true);

    try {
      const { sapFunctionFetch } = await import("@/lib/auth-fetch");

      // A API do PagCorp limita a consulta a ~1 mês. Para períodos maiores,
      // quebramos em janelas de até 30 dias e buscamos sequencialmente,
      // concatenando os resultados (a deduplicação abaixo cuida de sobreposições).
      const windows: Array<{ start?: string; end?: string }> = [];
      if (startDate && endDate) {
        const MS_DAY = 24 * 60 * 60 * 1000;
        let cursor = new Date(`${startDate}T00:00:00`);
        const final = new Date(`${endDate}T00:00:00`);
        let guard = 0;
        while (cursor.getTime() <= final.getTime() && guard < 60) {
          const chunkEnd = new Date(Math.min(cursor.getTime() + 30 * MS_DAY, final.getTime()));
          windows.push({
            start: cursor.toISOString().slice(0, 10),
            end: chunkEnd.toISOString().slice(0, 10),
          });
          cursor = new Date(chunkEnd.getTime() + MS_DAY);
          guard++;
        }
      }
      if (windows.length === 0) windows.push({ start: startDate, end: endDate });

      const rawItems: any[] = [];
      for (const w of windows) {
        const params: Record<string, string> = {};
        if (w.start) params.startDate = w.start;
        if (w.end) params.endDate = w.end;
        if (companyDb) params.companyDb = companyDb;

        const queryString = new URLSearchParams(params).toString();
        const url = `pagcorp-proxy${queryString ? `?${queryString}` : ""}`;
        const res = await sapFunctionFetch(url);

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `Erro ${res.status}`);
        }

        const result = await res.json();
        if (Array.isArray(result.items)) rawItems.push(...result.items);
      }

      // Dedupe por expenseId: a API do PagCorp tem retornado a mesma transação repetida.
      // Mantemos a primeira ocorrência por (id ?? expenseId).
      const dedupedRaw: any[] = [];
      const seenExpenseIds = new Set<string | number>();
      for (const it of rawItems) {
        const key = it?.id ?? it?.expenseId;
        if (key != null) {
          if (seenExpenseIds.has(key)) continue;
          seenExpenseIds.add(key);
        }
        dedupedRaw.push(it);
      }

      const seenIds = new Set<string | number>();
      const items: PagCorpTransaction[] = dedupedRaw.map((item: any, index: number) => {
        const receipts = item.receipts || [];

        // Resolve a STABLE + UNIQUE id. Spread item LAST would otherwise let an
        // undefined item.id overwrite our computed id, and duplicate ids would
        // make a single checkbox click toggle multiple rows.
        let resolvedId: string | number = item.id ?? item.expenseId ?? index;
        if (seenIds.has(resolvedId)) {
          resolvedId = `${resolvedId}-${index}`;
        }
        seenIds.add(resolvedId);

        return enrichPagCorpAccountability({
          ...item,
          id: resolvedId,
          date: item.eventDate || item.date || item.expenseDate || item.createdAt || "",
          description: item.description || item.expenseDescription || "—",
          amount: item.amount || item.value || item.expenseValue || 0,
          currency: (() => {
            // Prioriza a moeda original da compra; só assume BRL como último recurso.
            const candidates = [
              item.originalCurrencyCode,
              item.originalCurrency,
              item.paymentCurrency,
              item.paymentCurrencyCode,
              item.eventCurrency,
              item.eventCurrencyCode,
              item.cardCurrency,
              item.cardCurrencyCode,
              item.currencyCode,
              item.currency,
              item.currencySymbol,
            ];
            for (const c of candidates) {
              if (!c) continue;
              const s = String(c).toUpperCase().trim();
              if (!s || s === "##" || s === "N/A") continue;
              if (s === "R$" || s === "BRL") return "BRL";
              if (s === "US$" || s === "$" || s === "USD") return "USD";
              if (/^[A-Z]{3}$/.test(s)) return s;
            }
            // Heurística textual final
            const text = [item.eventClassification, item.classification, item.description]
              .map((x) => String(x || "").toLowerCase()).join(" ");
            if (/(dolar|dólar|dollar|\busd\b|us\$|exterior)/.test(text)) return "USD";
            return "BRL";
          })(),
          accountCode: item.accountCode || item.account || "",
          accountName: item.accountName || item.parentAccountAlias || item.accountAlias || "",
          accountAlias: item.accountAlias || item.parentAccountAlias || "",
          cardId: item.cardId || item.card_id || "",
          cardName: item.cardName || item.card_name || item.accountAlias || item.parentAccountAlias || "",
          cardLastDigits: item.cardLastDigits || item.lastDigits || "",
          status: item.status || item.statusDescription || "",
          // Novo objeto `aiAnalysis` (API PagCorp, produção a partir de 17/08).
          // Retrocompatível: ausente/nulo mantém o comportamento anterior.
          merchantName:
            (typeof item.aiAnalysis?.companyName === "string" && item.aiAnalysis.companyName.trim()) || null,
          merchantTaxId:
            (item.aiAnalysis?.companyDocument != null && String(item.aiAnalysis.companyDocument).trim()) || null,
          attachments: item.attachments || [],

          receipts,
          integrated: false,
          integrationStatusResolved: false,
          isReversed: Number(item.amount || item.value || item.expenseValue || 0) === 0,
        });
      });

      // Busca status de integração + marcações de não-dedutibilidade via
      // Edge Function (usa service_role internamente, valida sessão SAP).
      if (companyDb) {
        await applyIntegrationStatus(items, companyDb);
      }



      setTransactions(items);

      // Catálogo de cartões: upsert distintos vistos nesta busca para alimentar
      // o mapeamento de cartões mesmo sem refazer a chamada ao PagCorp.
      if (companyDb && items.length > 0) {
        try {
          const cardMap = new Map<string, {
            company_db: string;
            card_identifier: string;
            card_name: string | null;
            card_last_digits: string | null;
            card_label: string | null;
            account_alias: string | null;
            last_seen_at: string;
          }>();
          const nowIso = new Date().toISOString();
          for (const t of items) {
            const last = t.cardLastDigits ? String(t.cardLastDigits).trim() : "";
            const cardId = t.cardId ? String(t.cardId).trim() : "";
            const name = t.cardName ? String(t.cardName).trim() : "";
            const identifier = last || cardId || name;
            if (!identifier || cardMap.has(identifier)) continue;
            const label = [name || t.accountAlias || t.accountName, last ? `•••• ${last}` : cardId ? `ID ${cardId}` : null].filter(Boolean).join(" ") || identifier;
            cardMap.set(identifier, {
              company_db: companyDb,
              card_identifier: identifier,
              card_name: name || null,
              card_last_digits: last || null,
              card_label: label,
              account_alias: t.accountAlias ? String(t.accountAlias) : null,
              last_seen_at: nowIso,
            });
          }
          if (cardMap.size > 0) {
            const { sapFunctionFetch } = await import("@/lib/auth-fetch");
            await sapFunctionFetch("pagcorp-card-mapping", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "catalog", cards: Array.from(cardMap.values()) }),
            });
          }
        } catch (e) {
          console.warn("PagCorp card catalog upsert failed:", e);
        }
      }

      // Persist to DB cache so the next visit / period switch is instant
      if (companyDb) {
        try {
          const { writeCache } = await import("@/lib/external-cache");
          await writeCache(cacheKey, companyDb, items);
        } catch (e) {
          console.warn("PagCorp cache write failed:", e);
        }
      }

    } catch (e) {
      console.error("PagCorp fetch error:", e);
      if (!hadCache) setError(e instanceof Error ? e.message : "Erro ao buscar transações");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logIntegration = useCallback(async (
    transaction: PagCorpTransaction,
    integrationType: "generic" | "accountability",
    status: "success" | "error" | "pending",
    companyDb?: string,
    integratedBy?: string,
    sapDocEntry?: number,
    sapDocNum?: number,
    errorMessage?: string,
    sapPayload?: any,
    sapResponse?: any,
  ) => {
    const { data, error } = await supabase
      .from("pagcorp_integration_log")
      .insert({
        pagcorp_expense_id: Number(transaction.id),
        pagcorp_data: {
          description: transaction.description,
          amount: transaction.amount,
          currency: transaction.currency,
          date: transaction.date,
          accountAlias: transaction.accountAlias,
          accountCode: transaction.accountCode,
          hasAccountability: transaction.hasAccountability,
          accountabilityApproved: transaction.accountabilityApproved,
          receipts: transaction.receipts,
        },
        integration_type: integrationType,
        status,
        company_db: companyDb || null,
        integrated_by: integratedBy || null,
        sap_doc_entry: sapDocEntry || null,
        sap_doc_num: sapDocNum || null,
        error_message: errorMessage || null,
        sap_payload: sapPayload || null,
        sap_response: sapResponse || null,
      } as any)
      .select("id")
      .single();

    if (error) throw error;
    invalidatePagCorpIntegrationStatus(companyDb);

    // Audit
    const { logAuditAction } = await import("@/hooks/useAuditLog");
    await logAuditAction({
      action: "integrate",
      entity_type: "pagcorp_transaction",
      entity_id: String(transaction.id),
      details: { integrationType, status, companyDb, sapDocEntry, sapDocNum, amount: transaction.amount, description: transaction.description },
    });

    return data;
  }, []);

  /**
   * Direct integration: PagCorp transaction → SAP (PC + NF + Pagamento), no
   * approvals, no internal expense row. Logs everything in pagcorp_integration_log.
   */
  const integrateDirect = useCallback(async (
    transaction: PagCorpTransaction,
    integrationType: "generic" | "accountability",
    companyDb: string,
    supplierCode: string,
    supplierName?: string,
    integratedBy?: string,
    lineOverrides?: Record<string, { costCenter?: string | null; project?: string | null; item?: string | null }>,
    nondeductible?: boolean,
    postingType: "purchase_order" | "journal_entry" = "purchase_order",
    journalEntry?: { debitAccount: string; creditAccount: string; costCenter?: string | null; project?: string | null; remarks?: string },
  ) => {
    const { sapFunctionFetch } = await import("@/lib/auth-fetch");
    const res = await sapFunctionFetch("pagcorp-to-sap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction,
        companyDb,
        integrationType,
        supplierCode,
        supplierName,
        integratedBy,
        lineOverrides: lineOverrides || {},
        nondeductible: !!nondeductible,
        postingType,
        journalEntry,
      }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.success === false) {
      throw new Error(result.error || `Erro ${res.status}`);
    }
    invalidatePagCorpIntegrationStatus(companyDb);
    return result;
  }, []);

  const integrateJournalBatch = useCallback(async (
    transactions: PagCorpTransaction[],
    companyDb: string,
    integratedBy: string | undefined,
    journalEntry: {
      debitAccount: string;
      creditAccount: string;
      costCenter?: string | null;
      project?: string | null;
      remarks?: string;
      exchangeRate?: number | null;
    },
    lineOverrides?: Record<string, { costCenter?: string | null; project?: string | null; item?: string | null }>,
  ) => {
    const { sapFunctionFetch } = await import("@/lib/auth-fetch");
    const response = await sapFunctionFetch("pagcorp-to-sap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactions,
        companyDb,
        integrationType: "generic",
        integratedBy,
        postingType: "journal_entry",
        journalEntry,
        ...(lineOverrides && Object.keys(lineOverrides).length > 0 ? { lineOverrides } : {}),
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false) {
      throw new Error(result.error || `Erro ${response.status}`);
    }
    invalidatePagCorpIntegrationStatus(companyDb);
    return result;
  }, []);

  const classifyDocuments = useCallback(async (
    transaction: PagCorpTransaction,
    companyDb: string,
    options: { force?: boolean } = {},
  ) => {
    if (!isPagCorpAiEligible(transaction)) {
      return {
        status: "pending" as const,
        hasFiscalDocument: null,
        documentKinds: [],
        confidence: null,
      };
    }
    // Mantém a classificação anterior visível enquanto reprocessa — só o
    // status muda para "processing".
    setTransactions((current) => current.map((item) =>
      item.id === transaction.id ? { ...item, documentAnalysisStatus: "processing", documentAnalysisError: null } : item
    ));
    const previous = { hasFiscalDocument: transaction.hasFiscalDocument, documentKinds: transaction.documentKinds, postingType: transaction.postingType };
    const result = await classifyPagCorpDocuments(transaction, companyDb, options).catch((error) => ({
      status: "error" as const,
      hasFiscalDocument: null,
      documentKinds: [],
      confidence: null,
      errorMessage: error instanceof Error ? error.message : String(error),
    }));
    invalidatePagCorpIntegrationStatus(companyDb);
    setTransactions((current) => current.map((item) => item.id === transaction.id
      ? {
          ...item,
          documentAnalysisStatus: result.status,
          // Falha no reprocessamento não apaga o que já havia sido classificado.
          hasFiscalDocument: result.status === "error" ? previous.hasFiscalDocument ?? null : result.hasFiscalDocument,
          documentKinds: result.status === "error" ? previous.documentKinds ?? [] : result.documentKinds,
          documentAnalysisError: result.errorMessage ?? null,
          postingType: result.hasFiscalDocument
            ? "purchase_order"
            : result.status === "completed"
              ? "journal_entry"
              : previous.postingType,
        }
      : item));
    return result;
  }, []);



  /**
   * Consolidated integration: many PagCorp transactions → ONE SAP Purchase Order
   * with one line per transaction, all under the same supplier.
   */
  const integrateConsolidated = useCallback(async (
    transactions: PagCorpTransaction[],
    companyDb: string,
    supplierCode: string,
    supplierName?: string,
    integratedBy?: string,
    lineOverrides?: Record<string, { costCenter?: string | null; project?: string | null; item?: string | null }>,
    nondeductible?: boolean,
    /** Data de emissão da NF (yyyy-mm-dd) — usada como data do documento no SAP. */
    documentDate?: string | null,
  ) => {
    const { sapFunctionFetch } = await import("@/lib/auth-fetch");
    const res = await sapFunctionFetch("pagcorp-to-sap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactions,
        companyDb,
        integrationType: "generic",
        supplierCode,
        supplierName,
        integratedBy,
        lineOverrides: lineOverrides || {},
        nondeductible: !!nondeductible,
        ...(documentDate ? { documentDate } : {}),
      }),
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.success === false) {
      throw new Error(result.error || `Erro ${res.status}`);
    }
    invalidatePagCorpIntegrationStatus(companyDb);
    return result;
  }, []);


  return { transactions, isLoading, error, fetchTransactions, logIntegration, integrateDirect, integrateJournalBatch, integrateConsolidated, classifyDocuments };
}
