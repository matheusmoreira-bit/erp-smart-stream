import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sapFunctionFetch } from "@/lib/auth-fetch";

export interface ApprovalHistoryRow {
  id: string;
  external_id: string;
  company_db: string;
  decision: string | null;
  decision_date: string | null;
  approver_code: string | null;
  approver_name: string | null;
  approver_email: string | null;
  requester_code: string | null;
  requester_name: string | null;
  doc_object_type: string | null;
  doc_type_name: string | null;
  doc_entry: number | null;
  doc_num: number | null;
  doc_total: number | null;
  currency: string | null;
  card_code: string | null;
  card_name: string | null;
  remarks: string | null;
  stage_name: string | null;
  step: number | null;
  synced_at: string;
  /** Fonte da decisão: 'sap' = SAP Approval Hub, 'erp_flow' = fluxo interno, 'audit_log' = ação já registrada no histórico */
  source?: "sap" | "erp_flow" | "audit_log";
  /** Preenchido apenas para rows internos (permite abrir o mapa de relações) */
  expense_id?: string | null;
  /** Rastreabilidade: quando a decisão foi tomada por um substituto autorizado */
  substituted_for_email?: string | null;
  substituted_for_name?: string | null;
  substitution_id?: string | null;
}

export interface ApprovalHistorySyncState {
  last_sync_at: string | null;
  last_status: string | null;
  last_message: string | null;
  last_count: number | null;
}

export interface ApprovalHistoryFilters {
  /** "all" | "Y" (aprovado) | "N" (rejeitado) */
  decision?: "all" | "Y" | "N";
  /**
   * Multi-seleção de substituto:
   * - []           → sem filtro
   * - ["__any__"]  → apenas decisões executadas por substituto
   * - ["__none__"] → apenas decisões executadas pelo próprio aprovador
   * - keys         → substituídos específicos (email lowercased ou nome lowercased)
   */
  substituteFilter?: string[];
  /**
   * Busca livre por partial match em `substituted_for_name`/`substituted_for_email`.
   * Se preenchida, sobrepõe `substituteFilter` (implica "há substituição" com
   * match parcial case-insensitive em nome ou email).
   */
  substituteSearch?: string;
  /** Página atual (1-based). */
  page?: number;
  /** Tamanho da página. Default 50. */
  pageSize?: number;
}

const SUBSTITUTE_RE =
  /SUBSTITUTO\s*\(([^)]+)\)\s*em nome de\s+([^—<]+?)(?:\s*<([^>]+)>)?\s*(?:—|\.|$)/i;

// Escapa caracteres com significado especial no filtro `or()` do PostgREST.
function escapePgrstList(v: string): string {
  return v.replace(/([,()])/g, "\\$1");
}

export function useApprovalHistory(
  companyDb?: string | null,
  filters: ApprovalHistoryFilters = {},
) {
  const {
    decision = "all",
    substituteFilter = [],
    substituteSearch = "",
    page = 1,
    pageSize = 50,
  } = filters;
  const trimmedSubSearch = substituteSearch.trim();

  const [rows, setRows] = useState<ApprovalHistoryRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [syncState, setSyncState] = useState<ApprovalHistorySyncState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estabiliza o array de chaves para o dependency array
  const substituteKey = useMemo(() => substituteFilter.join("|"), [substituteFilter]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Busca livre por substituído sobrepõe qualquer modo do multi-select.
      const searchActive = trimmedSubSearch.length > 0;
      const mode: "all" | "any" | "none" | "specific" | "search" =
        searchActive
          ? "search"
          : substituteFilter.includes("__any__")
            ? "any"
            : substituteFilter.includes("__none__")
              ? "none"
              : substituteFilter.length > 0
                ? "specific"
                : "all";
      const specificKeys = substituteFilter.filter(
        (k) => k !== "__any__" && k !== "__none__",
      );

      // Janela de busca em cada fonte: cobre até a página atual (com margem
      // para tolerar dedupe + rows sem data). Buscamos +1 para detectar hasMore.
      const window = page * pageSize;
      const fetchCap = window + 1;

      // ============================================================
      // 1) SAP (approval_history) — substituição fica em `remarks`.
      // ============================================================
      let sapRows: ApprovalHistoryRow[] = [];
      let backendSyncState: ApprovalHistorySyncState | null = null;
      if (companyDb) {
        const res = await sapFunctionFetch("approval-history-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list", companyDb, decision, limit: fetchCap }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.success === false) {
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        sapRows = (body?.rows || []) as ApprovalHistoryRow[];
        backendSyncState = (body?.syncState || null) as ApprovalHistorySyncState | null;
      }

      if (mode === "any" || mode === "specific") {
        sapRows = sapRows.filter((r) => (r.remarks || "").toUpperCase().includes("SUBSTITUTO"));
      } else if (mode === "none") {
        sapRows = sapRows.filter((r) => !(r.remarks || "").toUpperCase().includes("SUBSTITUTO"));
      } else if (mode === "search") {
        const needle = trimmedSubSearch.toLowerCase();
        sapRows = sapRows.filter((r) => (r.remarks || "").toLowerCase().includes("substituto") && (r.remarks || "").toLowerCase().includes(needle));
      }

      // ============================================================
      // 2) Interno (expense_approval_log) — colunas dedicadas.
      // ============================================================
      let logQ = supabase
        .from("expense_approval_log")
        .select("*")
        .in(
          "decision",
          decision === "Y" ? ["approved"] : decision === "N" ? ["rejected"] : ["approved", "rejected"],
        )
        .order("decided_at", { ascending: false, nullsFirst: false })
        .limit(fetchCap);
      if (mode === "any") {
        logQ = logQ.or(
          "substituted_for_email.not.is.null,substituted_for_name.not.is.null",
        );
      } else if (mode === "none") {
        logQ = logQ
          .is("substituted_for_email", null)
          .is("substituted_for_name", null);
      } else if (mode === "specific" && specificKeys.length > 0) {
        const orParts: string[] = [];
        for (const raw of specificKeys) {
          const k = escapePgrstList(raw);
          orParts.push(`substituted_for_email.ilike.${k}`);
          orParts.push(`substituted_for_name.ilike.${k}`);
        }
        logQ = logQ.or(orParts.join(","));
      } else if (mode === "search") {
        const k = escapePgrstList(trimmedSubSearch);
        logQ = logQ.or(
          `substituted_for_email.ilike.%${k}%,substituted_for_name.ilike.%${k}%`,
        );
      }
      const { data: logRows } = await logQ;

      // Enriquecimento: puxa somente os expenses referenciados por essa página.
      const expenseIds = Array.from(
        new Set(((logRows || []) as any[]).map((l) => l.expense_id).filter(Boolean)),
      );
      let expensesById = new Map<string, any>();
      if (expenseIds.length > 0) {
        let expensesQ = supabase
          .from("expenses")
          .select(
            "id, supplier_code, supplier_name, total_amount, currency, sap_doc_entry, sap_doc_num, doc_type, requester_name, requester_email, company_db, created_at",
          )
          .in("id", expenseIds);
        if (companyDb) expensesQ = expensesQ.eq("company_db", companyDb);
        const { data: expenses } = await expensesQ;
        expensesById = new Map<string, any>((expenses || []).map((e: any) => [e.id, e]));
      }

      const internalRows: ApprovalHistoryRow[] = ((logRows || []) as any[])
        .map((l) => {
          const e = expensesById.get(l.expense_id);
          if (!e) return null; // expense fora da company atual
          return {
            id: `log-${l.id}`,
            external_id: `erp-flow:${l.expense_id}:${l.level_order ?? 0}`,
            company_db: e.company_db,
            decision: l.decision === "approved" ? "Y" : "N",
            decision_date: l.decided_at || l.created_at,
            approver_code: l.approver_email || l.approver_name || null,
            approver_name: l.approver_name || null,
            approver_email: l.approver_email || null,
            requester_code: e.requester_email || null,
            requester_name: e.requester_name || null,
            doc_object_type: null,
            doc_type_name:
              e.doc_type === "sales"
                ? "Pedido de Venda (ERP Flow)"
                : "Pedido de Compra (ERP Flow)",
            doc_entry: typeof e.sap_doc_entry === "number" ? e.sap_doc_entry : null,
            doc_num: typeof e.sap_doc_num === "number" ? e.sap_doc_num : null,
            doc_total: Number(e.total_amount || 0),
            currency: e.currency || "BRL",
            card_code: e.supplier_code || null,
            card_name: e.supplier_name || null,
            remarks: l.remarks || null,
            stage_name: l.level_order ? `Nível ${l.level_order}` : null,
            step: l.level_order || null,
            synced_at: l.decided_at || l.created_at,
            source: "erp_flow" as const,
            expense_id: l.expense_id,
            substituted_for_email: l.substituted_for_email || null,
            substituted_for_name: l.substituted_for_name || null,
            substitution_id: l.substitution_id || null,
          } as ApprovalHistoryRow;
        })
        .filter(Boolean) as ApprovalHistoryRow[];

      // ============================================================
      // 3) Histórico de ações (audit_log) — decisões SAP feitas no app.
      // ============================================================
      let auditQ = supabase
        .from("audit_log")
        .select("id, action, entity_id, actor_email, created_at, details, company_db")
        .eq("entity_type", "approval_request")
        .in("action", decision === "Y" ? ["approve"] : decision === "N" ? ["reject"] : ["approve", "reject"])
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(fetchCap);
      if (companyDb) auditQ = auditQ.eq("company_db", companyDb);
      const { data: auditRows } = await auditQ;

      const auditHistoryRows: ApprovalHistoryRow[] = ((auditRows || []) as any[])
        .map((a) => {
          const details = (a.details || {}) as Record<string, any>;
          const actedAsSubstitute = !!details.actedAsSubstitute || details.actingRole === "substitute";
          const substitutedForEmail = details.substitutedForEmail || null;
          const substitutedForName = details.substitutedForName || null;
          const actor = (a.actor_email || "").toString().toLowerCase();
          return {
            id: `audit-${a.id}`,
            external_id: `${a.entity_id || "unknown"}::${actor}`,
            company_db: a.company_db,
            decision: a.action === "approve" ? "Y" : "N",
            decision_date: a.created_at,
            approver_code: actor || details.approver || null,
            approver_name: details.approver || actor || null,
            approver_email: actor || null,
            requester_code: null,
            requester_name: null,
            doc_object_type: null,
            doc_type_name: details.docType || "Pedido de Compra",
            doc_entry: null,
            doc_num: typeof details.docNum === "number" ? details.docNum : Number(details.docNum) || null,
            doc_total: typeof details.docTotal === "number" ? details.docTotal : Number(details.docTotal) || null,
            currency: details.currency || "BRL",
            card_code: null,
            card_name: details.cardName || null,
            remarks: details.remarks || null,
            stage_name: details.actingRole === "delegation" ? "Delegação" : actedAsSubstitute ? "Substituição" : null,
            step: null,
            synced_at: a.created_at,
            source: "audit_log" as const,
            substituted_for_email: substitutedForEmail,
            substituted_for_name: substitutedForName,
          } as ApprovalHistoryRow;
        });

      // Dedupe SAP × interno pelo par (company_db, doc_entry, decision, step).
      const sapKey = new Set(
        ((sapRows || []) as ApprovalHistoryRow[])
          .filter((r) => r.doc_entry != null)
          .map((r) => `${r.company_db}|${r.doc_entry}|${r.decision}|${r.step ?? 0}`),
      );
      const filteredInternal = internalRows.filter((r) => {
        if (r.doc_entry == null) return true;
        return !sapKey.has(`${r.company_db}|${r.doc_entry}|${r.decision}|${r.step ?? 0}`);
      });

      const sapExternalKeys = new Set(
        ((sapRows || []) as ApprovalHistoryRow[]).map((r) => `${r.company_db}|${r.external_id}`),
      );
      const filteredAuditRows = auditHistoryRows.filter((r) => {
        if (sapExternalKeys.has(`${r.company_db}|${r.external_id}`)) return false;
        const hasSubstitution = !!(r.substituted_for_email || r.substituted_for_name);
        if (mode === "any") return hasSubstitution;
        if (mode === "none") return !hasSubstitution;
        return true;
      });

      // Extrai substituição do texto para rows SAP (não têm colunas dedicadas).
      const parseSubstitution = (r: ApprovalHistoryRow): ApprovalHistoryRow => {
        if (r.substituted_for_email || r.substituted_for_name) return r;
        const m = r.remarks?.match(SUBSTITUTE_RE);
        if (!m) return r;
        return {
          ...r,
          substituted_for_name: (m[2] || "").trim() || null,
          substituted_for_email: (m[3] || "").trim() || null,
        };
      };

      let merged = [
        ...((sapRows || []) as ApprovalHistoryRow[]).map((r) =>
          parseSubstitution({ ...r, source: (r as any).raw?.source === "audit_log" ? "audit_log" as const : "sap" as const }),
        ),
        ...filteredInternal.map(parseSubstitution),
        ...filteredAuditRows.map(parseSubstitution),
      ].sort((a, b) => {
        const da = a.decision_date ? new Date(a.decision_date).getTime() : 0;
        const db = b.decision_date ? new Date(b.decision_date).getTime() : 0;
        return db - da;
      });

      // Filtro final por chaves específicas (aplica ao SAP após parse).
      if (mode === "specific" && specificKeys.length > 0) {
        const keySet = new Set(specificKeys);
        merged = merged.filter((r) => {
          const email = (r.substituted_for_email || "").toLowerCase();
          const name = (r.substituted_for_name || "").toLowerCase();
          return (email && keySet.has(email)) || (name && keySet.has(name));
        });
      }

      // Busca livre por substituído (partial match em nome/email pós-parse).
      if (mode === "search") {
        const needle = trimmedSubSearch.toLowerCase();
        merged = merged.filter((r) => {
          const email = (r.substituted_for_email || "").toLowerCase();
          const name = (r.substituted_for_name || "").toLowerCase();
          return email.includes(needle) || name.includes(needle);
        });
      }

      const pageRows = merged.slice(0, window);
      setRows(pageRows);
      setHasMore(merged.length > window);

      setSyncState(backendSyncState);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar histórico");
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyDb, decision, substituteKey, trimmedSubSearch, page, pageSize]);

  const sync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const res = await sapFunctionFetch("approval-history-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyDb }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      await load();
      return body as { received: number; upserted: number };
    } finally {
      setIsSyncing(false);
    }
  }, [companyDb, load]);

  useEffect(() => {
    load();
  }, [load]);

  return { rows, hasMore, syncState, isLoading, isSyncing, error, refresh: load, sync };
}
