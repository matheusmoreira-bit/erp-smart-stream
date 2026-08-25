import { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { sapFunctionFetch } from "@/lib/auth-fetch";
import { uploadExpenseAttachment } from "@/lib/attachment-upload";
import { sapQuery, type SapSession } from "@/lib/sap-client";
import { useSap } from "@/contexts/SapContext";
import { getErpShortLabel } from "@/lib/erp-labels";
import { createNotification } from "@/lib/notifications";
import { expenseRead } from "@/lib/expense-read";
import { pickHierarchicalFallbackRule } from "@/lib/approval-fallback";

/** Aprovadora global quando a matriz não tem regra aplicável (todas as empresas). */
const MATRIX_FALLBACK_APPROVER_NAME = "Matheus Moreira";

import {
  enqueueOutbox,
  isOfflineError,
  registerOutboxSender,
} from "@/lib/offline-outbox";

/* ───────────────── Item group enrichment ───────────────── */

interface EnrichedItem {
  item_code: string | null;
  items_group_code: number | null;
  items_group_name: string | null;
}

async function enrichItemsWithGroup(
  items: Array<{
    item_code?: string | null;
    items_group_code?: number | null;
    items_group_name?: string | null;
  }>,
): Promise<Record<string, EnrichedItem>> {
  const codes = Array.from(
    new Set(
      items.map((i) => (i.item_code || "").trim()).filter((c) => c.length > 0),
    ),
  );
  const result: Record<string, EnrichedItem> = {};
  if (codes.length === 0) return result;

  for (const item of items) {
    const code = (item.item_code || "").trim();
    if (!code) continue;
    result[code] = {
      item_code: code,
      items_group_code: item.items_group_code ?? null,
      items_group_name: item.items_group_name ?? null,
    };
  }

  // Criação de despesa deve ser uma operação interna e rápida. Não consultamos
  // o Service Layer aqui; quando o grupo não vem no payload, reaproveitamos o
  // último grupo persistido para o mesmo item em documentos anteriores.
  const missing = codes.filter((c) => !result[c]?.items_group_name);
  if (missing.length > 0) {
    try {
      const { data: hist } = await supabase
        .from("expense_items")
        .select("item_code, items_group_name, created_at")
        .in("item_code", missing)
        .not("items_group_name", "is", null)
        .order("created_at", { ascending: false })
        .limit(200);
      for (const row of (hist || []) as any[]) {
        const c = String(row.item_code || "").trim();
        if (!c || !result[c] || result[c].items_group_name) continue;
        result[c].items_group_name = row.items_group_name;
      }
    } catch {
      /* histórico indisponível — segue sem fallback */
    }
  }

  return result;
}


function buildItemCtx(
  items: Array<{ item_code?: string | null; description?: string | null }>,
  enriched: Record<string, EnrichedItem>,
): { item_codes: string; item_groups: string; "item.code": string; "item.name": string; "item.any": string } {
  // Wrap with spaces so `like '% fol%'` and `like '% folha %'` work.
  const codeTokens = items
    .map((i) => (i.item_code || "").trim().toLowerCase())
    .filter(Boolean);
  const nameTokens = items
    .map((i) => (i.description || "").trim().toLowerCase())
    .filter(Boolean);
  const anyTokens = [...codeTokens, ...nameTokens];
  const groups = items
    .map((i) => {
      const c = (i.item_code || "").trim();
      return (enriched[c]?.items_group_name || "").trim().toLowerCase();
    })
    .filter(Boolean);
  const wrap = (arr: string[]) => (arr.length ? ` ${arr.join(" ")} ` : "");
  return {
    item_codes: wrap(anyTokens), // legacy: matches code OR description
    item_groups: wrap(groups),
    "item.code": wrap(codeTokens),
    "item.name": wrap(nameTokens),
    "item.any": wrap(anyTokens),
  };
}

/**
 * Consulta atributos adicionais do fornecedor (CNPJ e status) para uso em regras.
 * Retorna valores em minúsculas para compatibilidade com o avaliador. Silencioso
 * em caso de falha — o critério simplesmente não vai bater.
 */
async function fetchSupplierAttributes(
  supplierCode: string | null | undefined,
  session: SapSession,
): Promise<{ cnpj: string; status: string }> {
  const code = (supplierCode || "").trim();
  if (!code) return { cnpj: "", status: "" };
  try {
    const { data } = await sapQuery(
      session,
      `BusinessPartners('${code.replace(/'/g, "''")}')`,
      { $select: "CardCode,LicTradNum,Frozen,Valid" },
      true,
    );
    const cnpj = String((data as any)?.LicTradNum || "").toLowerCase();
    const frozen = String((data as any)?.Frozen || "");
    const valid = String((data as any)?.Valid || "");
    // Traduz para termos usuais que o usuário digitaria na regra.
    const status = frozen === "tYES" ? "inativo" : valid === "tNO" ? "invalido" : "ativo";
    return { cnpj, status };
  } catch {
    return { cnpj: "", status: "" };
  }
}

export type ExpenseStatus =
  | "rascunho"
  | "pendente_aprovacao"
  | "aprovado"
  | "rejeitado"
  | "cancelado"
  | "pc_lancado"
  | "nf_entrada"
  | "pagamento"
  | "finalizado";

export type ExpenseOrigin = "manual" | "pagcorp";

export interface ExpenseItem {
  id?: string;
  item_code?: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  cost_center?: string;
  project?: string;
  items_group_code?: number | null;
  items_group_name?: string | null;
}

export interface ExpenseAttachment {
  id: string;
  file_name: string;
  file_path: string;
  file_size?: number;
  mime_type?: string;
}

export interface Expense {
  id: string;
  doc_type?: ExpenseDocType;
  supplier_code?: string;
  supplier_name: string;
  total_amount: number;
  currency: string;
  cost_center?: string;
  project?: string;
  remarks?: string;
  status: ExpenseStatus;
  requester_name: string;
  requester_email?: string;
  current_approver?: string;
  original_approver?: string | null;
  sap_doc_entry?: number;
  sap_doc_num?: number;
  sap_integration_error?: string | null;
  sap_attachment_status?: string | null;
  sap_attachment_link_status?: string | null;
  sap_purchase_order_status?: string | null;
  revision_number?: number;
  revision_note?: string | null;
  sap_integration_last_attempt_at?: string | null;
  origin?: ExpenseOrigin;
  created_by_email?: string;
  company_db?: string;
  branch_id?: number;
  doc_date?: string;
  due_date?: string;
  payment_terms_code?: string | null;
  payment_terms_name?: string | null;
  rateio_type?: string | null;
  approval_rule_id?: string | null;
  current_level_order?: number | null;
  created_at: string;
  updated_at: string;
  items?: ExpenseItem[];
  attachments?: ExpenseAttachment[];
}

export type ExpenseDocType = "purchase" | "sales";

export interface CreateExpenseInput {
  supplier_code?: string;
  supplier_name: string;
  supplier_tax_id?: string | null;
  supplier_status?: string | null;
  currency?: string;
  cost_center?: string;
  project?: string;
  remarks?: string;
  origin?: ExpenseOrigin;
  initialStatus?: ExpenseStatus;
  skipRules?: boolean;
  branch_id?: number;
  doc_type?: ExpenseDocType;
  doc_date?: string;
  due_date?: string;
  payment_terms_code?: string;
  payment_terms_name?: string;
  rateio_type?: RateioType | null;
  /** Vendas: emitir NFS-e unificada ou uma nota por marca/projeto. */
  nfse_split_mode?: "unified" | "per_brand";
  /** Vendas: código da Utilização (NotaFiscalUsage) exigida pelo SAP. */
  sales_usage?: string;
  items: Omit<ExpenseItem, "id">[];
  files?: File[];
  /**
   * Fila multi-fornecedor (anexos com fornecedores diferentes): quantos
   * grupos ainda serão submetidos depois deste. Usado pelo PagCorp para
   * manter o modal aberto e permitir N pedidos por transação de cartão.
   */
  queue_remaining?: number;
  queue_total?: number;
  queue_supplier_label?: string;
}

export type RateioType = "padrao" | "folha" | "imposto" | "reembolso" | "viagens";

export const RATEIO_TYPE_LABELS: Record<RateioType, string> = {
  padrao: "Não (Padrão)",
  folha: "Folha",
  imposto: "Imposto",
  reembolso: "Reembolso",
  viagens: "Viagens",
};

const STATUS_LABELS: Record<ExpenseStatus, string> = {
  rascunho: "Rascunho",
  pendente_aprovacao: "Pendente Aprovação",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  cancelado: "Cancelado",
  pc_lancado: "PC Lançado no SAP",
  nf_entrada: "NF de Entrada",
  pagamento: "Pagamento",
  finalizado: "Finalizado",
};

const STATUS_COLORS: Record<ExpenseStatus, string> = {
  rascunho: "bg-muted text-muted-foreground",
  pendente_aprovacao: "bg-warning/15 text-warning",
  aprovado: "bg-success/15 text-success",
  rejeitado: "bg-destructive/15 text-destructive",
  cancelado: "bg-muted text-muted-foreground line-through",
  pc_lancado: "bg-primary/15 text-primary",
  nf_entrada: "bg-primary/15 text-primary",
  pagamento: "bg-primary/15 text-primary",
  finalizado: "bg-success/15 text-success",
};

export { STATUS_LABELS, STATUS_COLORS };

/**
 * Rótulo de status sensível ao tipo de documento.
 * Compras usam "PC" (Pedido de Compra); vendas usam "PV" (Pedido de Venda).
 */
export function getStatusLabel(
  status: string,
  isSales = false,
  erpType?: string | null,
): string {
  if (status === "pc_lancado") {
    const documentLabel = isSales ? "PV" : "PC";
    const erpLabel = !erpType || erpType === "sap" ? "SAP" : getErpShortLabel(erpType);
    return `${documentLabel} Lançado no ${erpLabel}`;
  }
  const label = STATUS_LABELS[status as ExpenseStatus] ?? status;
  return isSales ? label.replace(/\bPC\b/g, "PV") : label;
}

/** Retorna um formatador de status já ciente da rota (vendas x compras). */
export function useStatusLabel() {
  const { pathname } = useLocation();
  const { session } = useSap();
  const isSales = pathname.startsWith("/vendas");
  return useCallback(
    (status: string) => getStatusLabel(status, isSales, session?.erpType),
    [isSales, session?.erpType],
  );
}


async function invokeExpenseToSap(body: Record<string, unknown>) {
  const res = await sapFunctionFetch("expense-to-sap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Edge function returned ${res.status}`);
  if (data && data.success === false) throw new Error(data.error || "Falha ao integrar no ERP");
  return data;
}

/**
 * Wrapper for all write operations that used to run as anon updates against
 * public.expenses / expense_items / expense_attachments / expense_approval_log.
 * The RLS on those tables is now closed (no anon INSERT/UPDATE/DELETE), so all
 * mutations MUST go through `expense-mutation` which authorizes the caller
 * against the SAP session (or Cloud admin JWT) and executes with service role.
 */
async function invokeExpenseMutation<T = any>(payload: Record<string, unknown>): Promise<T> {
  const res = await sapFunctionFetch("expense-mutation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || (data && data.ok === false)) {
    throw new Error(data?.error || `expense-mutation returned ${res.status}`);
  }
  return data as T;
}


/* ───────────────── Rule Evaluation ───────────────── */

interface RuleCriterion {
  field: string;
  operator: string;
  value: string;
  value2?: string;
}

interface RuleRow {
  id: string;
  name: string;
  is_active: boolean;
  priority: number;
  criteria: RuleCriterion[];
}

interface RuleLevelRow {
  rule_id: string;
  level_order: number;
  approver_name: string;
  approver_email: string | null;
}

function evaluateCriterion(c: RuleCriterion, ctx: Record<string, any>): boolean {
  const raw = ctx[c.field];
  if (raw === undefined || raw === null) return false;
  const val = String(raw).toLowerCase();
  const target = String(c.value ?? "").toLowerCase();
  const tokens = val.split(/\s+/).filter(Boolean);
  const matchesExact = val === target || tokens.includes(target);
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  switch (c.operator) {
    case "greater_than": return Number(raw) > Number(c.value);
    case "less_than": return Number(raw) < Number(c.value);
    case "between": return Number(raw) >= Number(c.value) && Number(raw) <= Number(c.value2 ?? c.value);
    case "equal": return matchesExact;
    case "not_equal": return !matchesExact;
    case "contains": return val.includes(target);
    case "not_contains": return !val.includes(target);
    case "like": {
      const cleanPattern = target.trim().replace(/^%\s+/, "%").replace(/\s+%$/, "%");
      const pattern = cleanPattern.split("").map((ch) => ch === "%" ? ".*" : ch === "_" ? "." : escapeRegex(ch)).join("");
      const re = new RegExp(`^${pattern}$`);
      return re.test(val) || tokens.some((t) => re.test(t));
    }
    default: return false;
  }
}

function evaluateCriteriaList(criteria: RuleCriterion[], ctx: Record<string, any>): boolean {
  if (!criteria || criteria.length === 0) return false;
  const groupOrder: number[] = [];
  const buckets = new Map<number, RuleCriterion[]>();
  for (const c of criteria) {
    const g = typeof (c as any).group === "number" ? (c as any).group : 0;
    if (!buckets.has(g)) { buckets.set(g, []); groupOrder.push(g); }
    buckets.get(g)!.push(c);
  }
  let idx = 0;
  let overall = false;
  for (const g of groupOrder) {
    const bucket = buckets.get(g)!;
    let acc = evaluateCriterion(bucket[0], ctx);
    for (let i = 1; i < bucket.length; i++) {
      const passed = evaluateCriterion(bucket[i], ctx);
      const logic = (bucket[i] as any).logic === "or" ? "or" : "and";
      acc = logic === "or" ? (acc || passed) : (acc && passed);
    }
    if (idx === 0) overall = acc;
    else {
      const gLogic = (bucket[0] as any).groupLogic === "or" ? "or" : "and"; // fallback → AND
      overall = gLogic === "and" ? (overall && acc) : (overall || acc);
    }
    idx++;
  }
  return overall;
}

async function findMatchingRule(
  ctx: Record<string, any>,
  companyDb: string | null,
  docType: ExpenseDocType,
): Promise<{ rule: RuleRow; firstApprover?: { name: string; email: string | null } } | null> {
  let q = supabase
    .from("approval_rules")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: false });

  // Strict segregation: only match rules of the active company. Sem empresa => sem regra.
  if (!companyDb) return null;
  q = q.eq("company_db", companyDb);

  const { data: rules, error: rulesErr } = await q;
  // Se a matriz não pôde ser lida (sessão expirada / RLS negando), NÃO trate
  // como "sem regra" — isso mandava o documento para um admin qualquer via
  // fallback. Melhor abortar a criação com erro claro.
  if (rulesErr) {
    throw new Error(
      "Não foi possível ler a matriz de aprovação (sessão expirada). Recarregue a página e faça login novamente antes de criar o documento.",
    );
  }
  if (!rules || rules.length === 0) {
    throw new Error(
      "Matriz de aprovação indisponível para esta empresa (nenhuma regra retornada). Recarregue a página e tente novamente.",
    );
  }


  // Filter by doc_type: rule applies when matching type, "both", or null (legacy)
  const filtered = (rules as any[]).filter((r) => {
    const rdt = r.doc_type;
    return !rdt || rdt === "both" || rdt === docType;
  });
  if (filtered.length === 0) return null;

  for (const r of filtered) {
    const criteria: RuleCriterion[] = Array.isArray(r.criteria) ? r.criteria : [];
    if (criteria.length === 0) continue;
    const allMatch = evaluateCriteriaList(criteria, ctx);
    if (allMatch) {
      const { data: levels } = await supabase
        .from("approval_rule_levels")
        .select("*")
        .eq("rule_id", r.id)
        .order("level_order", { ascending: true })
        .limit(1);
      const first = levels && levels.length > 0 ? levels[0] as RuleLevelRow : null;
      return {
        rule: r as RuleRow,
        firstApprover: first ? { name: first.approver_name, email: first.approver_email } : undefined,
      };
    }
  }
  return null;
}

/* ───────────────── Approval log helper ───────────────── */

type ExpenseLogDecision =
  | "created"
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled"
  | "integrated"
  | "integration_failed";

async function logExpenseDecision(
  expenseId: string,
  decision: ExpenseLogDecision,
  opts: {
    approverName?: string | null;
    approverEmail?: string | null;
    levelOrder?: number | null;
    remarks?: string | null;
  } = {},
) {
  try {
    await invokeExpenseMutation({
      action: "log_decision",
      expense_id: expenseId,
      decision,
      levelOrder: opts.levelOrder ?? null,
      remarks: opts.remarks ?? null,
    });
  } catch (e) {
    // Log-only path — never block the main flow if the audit write fails.
    console.warn("Falha ao registrar log de aprovação:", e);
  }
}


/* ───────────────── Hook ───────────────── */

/** Filtro server-side aceito pela edge `expense-read`. */
export interface ServerFilter {
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "in" | "is" | "not_is";
  column: string;
  value?: unknown;
}

/**
 * Consulta paginada no servidor. Quando informada, o hook busca apenas a
 * página pedida (em vez de toda a lista da empresa) e aplica os filtros
 * diretamente no banco.
 */
export interface ServerQuery {
  page: number;
  pageSize: number;
  order?: { column: string; ascending: boolean };
  filters?: ServerFilter[];
  /** Cláusula `or` PostgREST (busca textual em várias colunas). */
  or?: string;
  viewAll?: boolean;
  /** Traz as chaves ERP de todo o conjunto filtrado (dedup com a lista do ERP). */
  withKeys?: boolean;
}

export interface SapKey {
  company_db: string | null;
  sap_doc_entry: number | null;
  sap_doc_num: number | null;
}

export function useExpenses(
  docType: ExpenseDocType = "purchase",
  options?: { statuses?: string[]; server?: ServerQuery | null; waitForServer?: boolean; enabled?: boolean },
) {
  const { session } = useSap();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [sapKeys, setSapKeys] = useState<SapKey[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Serializa a consulta server-side para manter `fetchExpenses` estável.
  const serverKey = options?.server ? JSON.stringify(options.server) : "";
  // Telas paginadas montam a consulta em um efeito: sem ela, não busca nada
  // (evita um primeiro fetch da lista inteira antes dos filtros existirem).
  // `enabled: false`: o hook é usado apenas pelas mutações (aprovar/rejeitar/
  // criar) e a listagem vem de outra fonte — não dispara nenhuma leitura.
  const fetchEnabled = options?.enabled !== false;
  const waitForServer = (Boolean(options?.waitForServer) && !serverKey) || !fetchEnabled;
  // Escopo opcional por status — telas que só precisam de um subconjunto
  // (ex.: Aprovações, que usa apenas "pendente_aprovacao") evitam trazer todo
  // o histórico da empresa com itens e anexos.
  const statusScope = options?.statuses?.length ? [...options.statuses].sort().join(",") : "";

  const fetchExpenses = useCallback(async () => {
    if (waitForServer) { setIsLoading(false); return; }
    setIsLoading(true);
    setError(null);
    try {
      const activeCompanyDb = session?.companyDB;
      if (!activeCompanyDb) {
        setExpenses([]);
        return;
      }

      const server: ServerQuery | null = serverKey ? JSON.parse(serverKey) : null;

      const readExpenses = () => {
        let q = expenseRead("expenses")
          .select("*")
          .eq("company_db", activeCompanyDb)
          .eq("doc_type", docType);
        if (statusScope) q = q.in("status", statusScope.split(","));
        if (server) {
          for (const f of server.filters || []) {
            switch (f.op) {
              case "in": q = q.in(f.column, (f.value as unknown[]) || []); break;
              case "is": q = q.is(f.column, f.value ?? null); break;
              case "not_is": q = q.not(f.column, "is", f.value ?? null); break;
              default: q = (q as any)[f.op](f.column, f.value);
            }
          }
          if (server.or) q = q.or(server.or);
          if (server.viewAll) q = q.viewAll();
          if (server.withKeys) q = q.withKeys();
          const ord = server.order || { column: "created_at", ascending: false };
          return q
            .include("items", "attachments")
            .order(ord.column, { ascending: ord.ascending })
            .withCount()
            .page(server.page, server.pageSize);
        }
        return q
          .include("items", "attachments")
          .order("created_at", { ascending: false });
      };

      let res = await readExpenses();
      if (res.error) {
        // Uma nova tentativa cobre falhas transitórias (sessão renovada,
        // cold start da função, rede instável) antes de mostrar erro na tela.
        await new Promise((r) => setTimeout(r, 1200));
        res = await readExpenses();
      }
      const { data, error: err, items: childItems, attachments: childAttachments } = res;

      if (err) {
        const msg = (err as { message?: string })?.message || String(err);
        throw new Error(`Erro ao buscar despesas: ${msg}`);
      }


      const itemsMap: Record<string, ExpenseItem[]> = {};
      const attachmentsMap: Record<string, ExpenseAttachment[]> = {};
      {
        // Itens e anexos vêm na mesma resposta (`include`) — antes eram duas
        // chamadas extras à edge function por tipo de documento.
        const items = childItems;
        const atts = childAttachments;
        if (items) {
          for (const item of items as any[]) {
            if (!itemsMap[item.expense_id]) itemsMap[item.expense_id] = [];
            itemsMap[item.expense_id].push(item);
          }
        }
        if (atts) {
          for (const a of atts as any[]) {
            if (!attachmentsMap[a.expense_id]) attachmentsMap[a.expense_id] = [];
            attachmentsMap[a.expense_id].push(a);
          }
        }
      }

      setExpenses(
        (data || []).map((e: any) => ({
          ...e,
          items: itemsMap[e.id] || [],
          attachments: attachmentsMap[e.id] || [],
        }))
      );
      setTotal(res.count ?? null);
      setHasMore(Boolean(res.hasMore));
      setSapKeys(res.keys ?? null);
    } catch (e) {
      console.error("Error fetching expenses:", e);
      setError(e instanceof Error ? e.message : "Erro ao buscar despesas");
    } finally {
      setIsLoading(false);
    }
  }, [session?.companyDB, docType, statusScope, serverKey, waitForServer]);

  const createExpenseCore = useCallback(
    async (input: CreateExpenseInput) => {
      if (!session) throw new Error("Sessão ERP não encontrada");

      const totalAmount = input.items.reduce((sum, item) => sum + item.line_total, 0);
      const origin: ExpenseOrigin = input.origin || "manual";
      const effectiveDocType = input.doc_type || docType;
      if (!input.files || input.files.length === 0) {
        throw new Error("Anexo obrigatório: documentos devem ser criados com ao menos 1 anexo.");
      }

      // Determine initial status
      // Regra de negócio: despesas com origem PagCorp (gastos de cartão) NÃO
      // passam por processo de aprovação — vão direto para integração no ERP.
      // Se o chamador não informar `initialStatus`, forçamos "aprovado" para
      // que o fluxo pós-criação já dispare a integração SAP.
      const pagcorpDefaultStatus: ExpenseStatus | undefined =
        origin === "pagcorp" ? "aprovado" : undefined;
      let status: ExpenseStatus =
        input.initialStatus || pagcorpDefaultStatus || "rascunho";
      let currentApprover: string | null = null;
      let matchedRuleId: string | null = null;

      // Enrich items with local/history item group data (used both for rule context and persistence).
      // Keep create fast: no live SAP calls before the internal document exists.
      const isSapSession = String(session.erpType || "").toLowerCase() === "sap";
      const enriched = await enrichItemsWithGroup(input.items);
      const itemCtx = buildItemCtx(input.items, enriched);

      // Evaluate approval rules for manual expenses only.
      // PagCorp (cartão) sempre pula aprovação — regra fixa do negócio.
      if (!input.skipRules && origin === "manual") {
        // Tipo de rateio no cabeçalho força uma regra específica (override)
        const rt = input.rateio_type && input.rateio_type !== "padrao" ? input.rateio_type : null;
        if (rt) {
          const namePrefix =
            rt === "folha" ? "Folha"
            : rt === "imposto" ? "Impostos"
            : "Reembolso"; // reembolso e viagens caem no mesmo fluxo
          const { data: forced } = await (supabase as any)
            .from("approval_rules")
            .select("id")
            .eq("is_active", true)
            .eq("priority", 9999)
            .eq("company_db", session.companyDB || "")
            .ilike("name", `${namePrefix}%`)
            .order("name")
            .limit(1);
          const forcedRule = Array.isArray(forced) && forced.length > 0 ? forced[0] : null;
          if (forcedRule) {
            const { data: lvls } = await supabase
              .from("approval_rule_levels")
              .select("*")
              .eq("rule_id", forcedRule.id)
              .order("level_order", { ascending: true })
              .limit(1);
            const first = lvls && lvls.length > 0 ? lvls[0] as any : null;
            status = "pendente_aprovacao";
            currentApprover = first?.approver_name || null;
            matchedRuleId = forcedRule.id;
          }
        }

        // Sem override, roda a matriz normal
        if (!matchedRuleId) {
          const itemCostCenters = Array.from(
            new Set(
              (input.items || [])
                .map((it) => (it.cost_center || "").trim())
                .filter((cc) => cc.length > 0),
            ),
          );
          const headerCc = (input.cost_center || "").trim();
          const candidateCcs = headerCc ? [headerCc] : itemCostCenters;

          // Enriquece atributos do fornecedor (CNPJ / status) para regras baseadas em Fornecedor.
          const supplierTaxId = String(input.supplier_tax_id || "").toLowerCase();
          const supplierStatus = String(input.supplier_status || "").toLowerCase();
          const supplierAttrs = supplierTaxId || supplierStatus
            ? { cnpj: supplierTaxId, status: supplierStatus || "ativo" }
            : isSapSession
              ? await fetchSupplierAttributes(input.supplier_code, session)
              : { cnpj: "", status: "ativo" };

          let match: Awaited<ReturnType<typeof findMatchingRule>> = null;
          for (const cc of (candidateCcs.length > 0 ? candidateCcs : [""])) {
            const ctx = {
              total_amount: totalAmount,
              cost_center: cc,
              project: input.project || "",
              requester_name: session.userName,
              // Legado: mantém supplier_name como "Nome Código" para regras existentes.
              supplier_name: `${input.supplier_name || ""} ${input.supplier_code || ""}`.trim(),
              // Novo modelo entidade.atributo:
              "supplier.name": (input.supplier_name || "").toLowerCase(),
              "supplier.code": (input.supplier_code || "").toLowerCase(),
              "supplier.cnpj": supplierAttrs.cnpj,
              "supplier.status": supplierAttrs.status,
              currency: input.currency || "BRL",
              doc_type: docType,
              rateio_type: (input.rateio_type || "padrao").toLowerCase(),
              item_codes: itemCtx.item_codes,
              item_groups: itemCtx.item_groups,
              "item.code": itemCtx["item.code"],
              "item.name": itemCtx["item.name"],
              "item.any": itemCtx["item.any"],
            };
            match = await findMatchingRule(ctx, session.companyDB || null, docType);
            if (match) break;
          }

          if (match && !match.firstApprover?.name && !match.firstApprover?.email) {
            // Regra de bloqueio: centro de custo sem alçada definida na matriz.
            throw new Error(
              `Centro de custo bloqueado para lançamento (regra "${match.rule.name}"). Não há aprovador definido na matriz de alçadas — procure o time Financeiro para liberar.`,
            );
          }

          if (match) {
            status = "pendente_aprovacao";
            currentApprover = match.firstApprover?.name || null;
            matchedRuleId = match.rule.id;
          } else {

            // Sem regra exata para o CC. Antes de mandar para um admin qualquer,
            // procuramos a alçada do RAMO do centro de custo (1.80.1.x → 1.80.x):
            // é o aprovador natural daquele grupo de CCs.
            status = "pendente_aprovacao";
            matchedRuleId = null;
            let resolved = false;
            try {
              const { data: allRules } = await supabase
                .from("approval_rules")
                .select("*")
                .eq("company_db", session.companyDB || "")
                .eq("is_active", true);
              const ccForFallback = headerCc || itemCostCenters[0] || "";
              const hier = pickHierarchicalFallbackRule(
                (allRules || []) as any,
                {
                  total_amount: totalAmount,
                  cost_center: ccForFallback,
                  project: input.project || "",
                  currency: input.currency || "BRL",
                  doc_type: docType,
                },
                docType,
              );
              if (hier) {
                const { data: levels } = await supabase
                  .from("approval_rule_levels")
                  .select("*")
                  .eq("rule_id", hier.rule.id)
                  .order("level_order", { ascending: true })
                  .limit(1);
                const first = levels && levels.length > 0 ? (levels[0] as RuleLevelRow) : null;
                if (first?.approver_name || first?.approver_email) {
                  currentApprover = first.approver_name || first.approver_email;
                  matchedRuleId = hier.rule.id;
                  resolved = true;
                }
              }
            } catch { /* segue para o fallback global */ }

            if (!resolved) {
              // Lacuna na matriz (todas as empresas): aprovadora global.
              currentApprover = MATRIX_FALLBACK_APPROVER_NAME;
            }
          }

        }
      }

      const userIdentifier = session.userName.includes("@") ? session.userName : `${session.userName}`;

      // Enrich items with items_group data client-side (server just persists
      // whatever we send). SAP session is required to hit Service Layer.
      const enrichedItems = input.items.map((item) => {
        const code = (item.item_code || "").trim();
        const meta = code ? enriched[code] : undefined;
        return {
          item_code: item.item_code || null,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          line_total: item.line_total,
          cost_center: item.cost_center || input.cost_center || null,
          project: item.project || input.project || null,
          items_group_code: meta?.items_group_code ?? null,
          items_group_name: meta?.items_group_name ?? null,
        };
      });

      // Server-side create (RLS on expenses is closed; anon can no longer
      // INSERT). The edge function overrides requester identity with the
      // authenticated SAP user, so client cannot forge who owns the doc.
      const createResp = await invokeExpenseMutation<{ ok: true; expense: any }>({
        action: "create",
        input: {
          supplier_code: input.supplier_code || null,
          supplier_name: input.supplier_name,
          currency: input.currency || "BRL",
          cost_center: input.cost_center || null,
          project: input.project || null,
          remarks: input.remarks || null,
          status,
          current_approver: currentApprover,
          approval_rule_id: matchedRuleId,
          origin,
          company_db: session.companyDB,
          branch_id: input.branch_id ?? 1,
          doc_type: effectiveDocType,
          doc_date: input.doc_date || null,
          due_date: input.due_date || null,
          payment_terms_code: input.payment_terms_code || null,
          payment_terms_name: input.payment_terms_name || null,
          rateio_type: input.rateio_type || null,
          nfse_split_mode: input.nfse_split_mode || "unified",
          sales_usage: input.sales_usage || null,
          attachment_count: input.files?.length || 0,
          items: enrichedItems,
        },
      });
      const expense = createResp.expense;
      const createdId = expense.id as string;

      const files = input.files || [];
      const results = await Promise.allSettled(
        files.map((file) => uploadExpenseAttachment({ expenseId: createdId }, file)),
      );

      const uploaded = results
        .map((r, i) => ({ r, name: files[i].name }))
        .filter((x) => x.r.status === "fulfilled")
        .map((x) => (x.r as PromiseFulfilledResult<{ file_path: string; file_name: string; file_size: number; mime_type: string }>).value);
      const failed = results
        .map((r, i) => ({ r, name: files[i].name }))
        .filter((x) => x.r.status === "rejected")
        .map((x) => `${x.name}: ${((x.r as PromiseRejectedResult).reason instanceof Error ? ((x.r as PromiseRejectedResult).reason as Error).message : String((x.r as PromiseRejectedResult).reason))}`);

      if (failed.length > 0 || uploaded.length !== files.length) {
        throw new Error(`Despesa criada, mas o upload de anexo falhou. Reabra a despesa e reanexe antes de aprovar/integrar. ${failed.join("; ")}`);
      }

      try {
        await invokeExpenseMutation({
          action: "attachments_add",
          expense_id: createdId,
          attachments: uploaded,
        });
      } catch (attErr) {
        throw new Error(
          `Despesa criada, mas falhou ao registrar anexo(s) no servidor: ${attErr instanceof Error ? attErr.message : String(attErr)}. Reabra a despesa e reanexe antes de aprovar/integrar.`,
        );
      }

      // A despesa e os anexos obrigatórios já foram persistidos. As etapas
      // restantes (notificar aprovador e atualizar lista) rodam em segundo plano.
      const finalize = async () => {
        // 1) Notificar TODOS os aprovadores do nível 1 (paralelo: primeiro que decidir encerra)
        if (status === "pendente_aprovacao" && matchedRuleId) {
          try {
            const { data: firstLevelRows } = await supabase
              .from("approval_rule_levels")
              .select("approver_name, approver_email, level_order")
              .eq("rule_id", matchedRuleId)
              .order("level_order", { ascending: true });
            const rows = (firstLevelRows || []) as Array<{ approver_name: string; approver_email: string | null; level_order: number }>;
            const minLevel = rows.length > 0 ? Math.min(...rows.map((r) => r.level_order)) : 1;
            const targets = rows
              .filter((r) => r.level_order === minLevel)
              .map((r) => (r.approver_email || r.approver_name || "").trim())
              .filter(Boolean);
            const uniqTargets = Array.from(new Set(targets));
            const parallelNote = uniqTargets.length > 1 ? " (aprovação em paralelo — o primeiro que decidir encerra)" : "";
            for (const t of uniqTargets) {
              createNotification({
                user_identifier: t,
                title: "Nova aprovação pendente",
                body: `${session.userName} enviou "${input.supplier_name}" (${input.currency || "BRL"} ${totalAmount.toFixed(2)}) para sua aprovação${parallelNote}.`,
                category: "approval",
                company_db: session.companyDB,
                link: `/approvals`,
                metadata: { expense_id: createdId },
              }).catch((err) => console.warn("Notificação ao aprovador falhou:", err));
            }
          } catch (err) {
            console.warn("Falha ao listar aprovadores paralelos, fallback para currentApprover:", err);
          }
        } else if (
          status === "pendente_aprovacao" &&
          currentApprover &&
          currentApprover !== "Administrador"
        ) {
          // Sem regra casada (fallback administrativo) — notifica só o currentApprover
          createNotification({
            user_identifier: currentApprover,
            title: "Nova aprovação pendente",
            body: `${session.userName} enviou "${input.supplier_name}" (${input.currency || "BRL"} ${totalAmount.toFixed(2)}) para sua aprovação.`,
            category: "approval",
            company_db: session.companyDB,
            link: `/approvals`,
            metadata: { expense_id: createdId },
          }).catch((err) => console.warn("Notificação ao aprovador falhou:", err));
        }

        // 2) Refresh final para a lista refletir o novo item
        fetchExpenses().catch((err) => console.warn("refresh pós-criação falhou:", err));
      };

      // Fire-and-forget: não bloqueia a resposta ao chamador.
      void finalize();

      return { expense, status, origin };
    },
    [session, fetchExpenses, docType]
  );

  /* ─────────────── Modo offline: fila de envio ───────────────
   * Se a base do ERP estiver fora do ar (circuit breaker aberto) ou o
   * navegador sem rede, o lançamento é guardado localmente e reenviado
   * automaticamente quando o circuito fechar. */
  const enqueueOffline = useCallback(
    async (input: CreateExpenseInput, reason?: string) => {
      const total = (input.items || []).reduce((s, i) => s + (i.line_total || 0), 0);
      await enqueueOutbox({
        kind: "expense",
        companyDB: session?.companyDB || null,
        docType: input.doc_type || docType,
        lastError: reason,
        summary: {
          supplier_name: input.supplier_name || "",
          total,
          itemCount: (input.items || []).length,
          attachmentCount: (input.files || []).length,
        },
        payload: input as unknown as Record<string, unknown>,
      });
      return { queued: true as const, status: "queued" as const, expense: null, origin: input.origin || "manual" };
    },
    [session?.companyDB, docType],
  );

  const createExpense = useCallback(
    async (input: CreateExpenseInput) => {
      if (!session) throw new Error("Sessão ERP não encontrada");

      // Queda apenas do SAP não impede a criação no ERP Flow: enriquecimentos
      // usam cache/fallback e a integração será retomada no servidor. A outbox
      // do navegador fica reservada para falta de internet/Supabase.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        const queued = await enqueueOffline(input, "Base do ERP indisponível no momento do lançamento");
        toast.warning(
          "Base do ERP indisponível. O lançamento entrou na fila offline e será enviado automaticamente quando a base voltar.",
          { duration: 8000 },
        );
        return queued;
      }

      try {
        return await createExpenseCore(input);
      } catch (e) {
        if (!isOfflineError(e)) throw e;
        const queued = await enqueueOffline(input, e instanceof Error ? e.message : String(e));
        toast.warning(
          "Não foi possível falar com o ERP agora. O lançamento ficou na fila offline e será reenviado automaticamente.",
          { duration: 8000 },
        );
        return queued;
      }
    },
    [session, createExpenseCore, enqueueOffline],
  );

  // Registra quem sabe reenviar os itens da fila offline.
  useEffect(() => {
    if (!session) return;
    return registerOutboxSender("expense", async (entry) => {
      if (entry.companyDB && session.companyDB && entry.companyDB !== session.companyDB) {
        throw new Error("Aguardando login na base de origem do lançamento");
      }
      await createExpenseCore(entry.payload as unknown as CreateExpenseInput);
    });
  }, [session, createExpenseCore]);




  const updateExpense = useCallback(
    async (
      expenseId: string,
      input: {
        supplier_name?: string;
        supplier_code?: string | null;
        remarks?: string | null;
        doc_date?: string | null;
        due_date?: string | null;
        rateio_type?: RateioType | null;
        items?: Omit<ExpenseItem, "id">[];
        new_attachment_files?: File[];
        remove_attachment_ids?: string[];
      }
    ) => {
      if (!session) throw new Error("Sessão SAP não encontrada");

      let enrichedItems: any[] | undefined;
      if (input.items) {
        const enrichedUpd = await enrichItemsWithGroup(input.items);
        enrichedItems = input.items.map((item) => {
          const code = (item.item_code || "").trim();
          const e = code ? enrichedUpd[code] : undefined;
          return {
            item_code: item.item_code || null,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            line_total: item.line_total,
            cost_center: item.cost_center || null,
            project: item.project || null,
            items_group_code: e?.items_group_code ?? null,
            items_group_name: e?.items_group_name ?? null,
          };
        });
      }

      // Se o tipo de rateio mudou, precisamos recomputar a regra de aprovação
      // (o override "Folha/Imposto/Reembolso/Viagens" muda o caminho da aprovação).
      // Buscamos o rateio_type atual da despesa e comparamos.
      let forcedRuleId: string | null | undefined;
      let forcedApprover: string | null | undefined;
      let rateioChanged = false;
      if (input.rateio_type !== undefined) {
        const { data: cur } = await expenseRead("expenses")
          .select("rateio_type")
          .eq("id", expenseId)
          .maybeSingle();
        const currentRt = ((cur as { rateio_type?: string | null } | null)?.rateio_type || "padrao") as string;
        const newRt = (input.rateio_type || "padrao") as string;
        rateioChanged = currentRt !== newRt;

        if (rateioChanged) {
          const rt = newRt !== "padrao" ? newRt : null;
          if (rt) {
            const namePrefix =
              rt === "folha" ? "Folha"
              : rt === "imposto" ? "Impostos"
              : "Reembolso"; // reembolso e viagens caem no mesmo fluxo
            const { data: forced } = await (supabase as any)
              .from("approval_rules")
              .select("id")
              .eq("is_active", true)
              .eq("priority", 9999)
              .eq("company_db", session.companyDB || "")
              .ilike("name", `${namePrefix}%`)
              .order("name")
              .limit(1);
            const forcedRule = Array.isArray(forced) && forced.length > 0 ? forced[0] : null;
            if (forcedRule) {
              forcedRuleId = forcedRule.id as string;
              const { data: lvls } = await supabase
                .from("approval_rule_levels")
                .select("approver_name")
                .eq("rule_id", forcedRule.id)
                .order("level_order", { ascending: true })
                .limit(1);
              forcedApprover = (Array.isArray(lvls) && lvls[0]?.approver_name) || null;
            } else {
              // rateio_type sem regra correspondente — deixa o servidor decidir
              forcedRuleId = null;
              forcedApprover = null;
            }
          } else {
            // Voltou para "padrão" — limpa override; servidor rerruteará.
            forcedRuleId = null;
            forcedApprover = null;
          }
        }
      }

      // Upload de novos anexos (se houver) antes da chamada de mutação, para
      // que o servidor persista storage + expense_attachments numa única
      // transação lógica (e reinicie o fluxo de aprovação).
      const uploadedAttachments: Array<{ file_path: string; file_name: string; file_size: number; mime_type: string }> = [];
      const newFiles = input.new_attachment_files || [];
      const uploadFailures: string[] = [];
      for (const file of newFiles) {
        try {
          uploadedAttachments.push(await uploadExpenseAttachment({ expenseId }, file));
        } catch (err) {
          uploadFailures.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (uploadFailures.length > 0) {
        throw new Error(`Falha ao enviar ${uploadFailures.length} anexo(s): ${uploadFailures.join("; ")}`);
      }

      // Ownership + status guards live in the edge function (RLS is closed).
      await invokeExpenseMutation({
        action: "update",
        expense_id: expenseId,
        input: {
          supplier_name: input.supplier_name,
          supplier_code: input.supplier_code,
          remarks: input.remarks,
          doc_date: input.doc_date,
          due_date: input.due_date,
          items: enrichedItems,
          rateio_type: input.rateio_type,
          rateio_changed: rateioChanged,
          new_approval_rule_id: forcedRuleId,
          new_current_approver: forcedApprover,
          add_attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
          remove_attachment_ids: (input.remove_attachment_ids && input.remove_attachment_ids.length > 0)
            ? input.remove_attachment_ids
            : undefined,
        },
      });

      await fetchExpenses();
    },
    [session, fetchExpenses]
  );

  const submitForApproval = useCallback(
    async (expenseId: string) => {
      // Pre-validate: ensure at least one approval rule applies. This is a
      // best-effort client check — the edge function still performs the
      // real state transition (and its own ownership check).
      let approverToNotify: string | null = null;
      let notifyPayload: any = null;
      try {
        const { data: exp } = await expenseRead("expenses")
          .select("total_amount, cost_center, company_db, current_approver, supplier_name, currency")
          .eq("id", expenseId)
          .maybeSingle();
        if (exp) {
          const { data: ruleCheck } = await supabase.rpc(
            "check_applicable_approval_rules",
            {
              _company_db: (exp as any).company_db || session?.companyDB || "",
              _total_amount: Number((exp as any).total_amount || 0),
              _cost_center: (exp as any).cost_center || null,
            }
          );
          const row = Array.isArray(ruleCheck) ? ruleCheck[0] : ruleCheck;
          if (row && row.has_rule === false) {
            throw new Error(
              "Nenhuma regra de aprovação aplicável encontrada para esta despesa. Verifique valor, centro de custo e regras ativas antes de submeter."
            );
          }
          approverToNotify = (exp as any).current_approver || null;
          notifyPayload = exp;
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("Nenhuma regra")) throw e;
        console.warn("check_applicable_approval_rules failed:", e);
      }

      await invokeExpenseMutation({ action: "submit", expense_id: expenseId });

      if (approverToNotify && approverToNotify !== "Administrador" && notifyPayload) {
        try {
          await createNotification({
            user_identifier: approverToNotify,
            title: "Nova aprovação pendente",
            body: `${session?.userName || ""} enviou "${notifyPayload.supplier_name}" (${notifyPayload.currency || "BRL"} ${Number(notifyPayload.total_amount || 0).toFixed(2)}) para sua aprovação.`,
            category: "approval",
            company_db: notifyPayload.company_db || undefined,
            link: `/approvals`,
            metadata: { expense_id: expenseId },
          });
        } catch { /* silent */ }
      }
      await fetchExpenses();
    },
    [fetchExpenses, session]
  );

  /** Reativa um documento cancelado (volta para rascunho). Autor ou admin. */
  const reactivateExpense = useCallback(
    async (expenseId: string) => {
      await invokeExpenseMutation({ action: "reactivate", expense_id: expenseId });
      await fetchExpenses();
    },
    [fetchExpenses]
  );

  const cancelExpense = useCallback(
    async (expenseId: string) => {
      await invokeExpenseMutation({ action: "cancel", expense_id: expenseId });
      await fetchExpenses();
    },
    [fetchExpenses]
  );

  /**
   * Anexa novos arquivos a uma despesa já criada (útil para pedidos em
   * fluxo de aprovação). Autorização (owner / admin / super) é validada
   * no edge function; aqui apenas orquestramos upload + registro.
   *
   * Quando o pedido já está integrado ao ERP (mas ainda sem NF de entrada),
   * o anexo é também enviado ao SAP (backfill) — nenhum outro campo muda.
   */
  const addAttachments = useCallback(
    async (expenseId: string, files: File[]) => {
      if (!files.length) return;
      const rows: Array<{ file_path: string; file_name: string; file_size: number; mime_type: string }> = [];
      const failed: string[] = [];
      for (const file of files) {
        try {
          rows.push(await uploadExpenseAttachment({ expenseId }, file));
        } catch (err) {
          failed.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (rows.length > 0) {
        await invokeExpenseMutation({
          action: "attachments_add",
          expense_id: expenseId,
          attachments: rows,
        });
      }

      // Backfill no ERP para documentos já integrados.
      let sapWarning: string | null = null;
      const target = expenses.find((e) => e.id === expenseId);
      if (rows.length > 0 && (target?.sap_doc_entry || target?.sap_doc_num)) {
        try {
          const resp = await sapFunctionFetch("expense-attachment-sap-backfill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expense_id: expenseId }),
          });
          const payload = await resp.json().catch(() => ({}));
          if (!resp.ok || payload?.error) {
            sapWarning = payload?.error || `Falha ao enviar anexo ao ERP (HTTP ${resp.status})`;
          }
        } catch (err) {
          sapWarning = err instanceof Error ? err.message : String(err);
        }
      }

      await fetchExpenses();
      if (failed.length > 0) {
        throw new Error(`Falha ao enviar ${failed.length} anexo(s): ${failed.join("; ")}`);
      }
      if (sapWarning) {
        throw new Error(`Anexo salvo, mas o envio ao ERP falhou: ${sapWarning}`);
      }
      return { inserted: rows.length };
    },
    [fetchExpenses, expenses]
  );




  const approveExpense = useCallback(
    async (expenseId: string, remarks?: string, idempotencyKey?: string, opts?: { skipRefresh?: boolean }) => {
      // Server-side authorization: the edge function verifies that the caller
      // (SAP session or Cloud admin) is the designated approver for the
      // CURRENT level before flipping the status. This is the security
      // boundary — do NOT bypass it with a direct supabase read
      // update, or any signed-in user could approve someone else's document.
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      const resp = await sapFunctionFetch("expense-approval-action", {
        method: "POST",
        headers,
        body: JSON.stringify({ expense_id: expenseId, action: "approve", remarks: remarks || undefined }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || !payload?.ok) {
        const stage = payload?.stage ? ` [etapa: ${payload.stage}]` : "";
        const rid = payload?.requestId ? ` (req ${String(payload.requestId).slice(0, 8)})` : "";
        const base = payload?.error || `Falha ao aprovar (HTTP ${resp.status})`;
        throw new Error(`${base}${stage}${rid}`);
      }

      const replayed: boolean = !!payload.replayed;
      const finalized: boolean = !!payload.finalized;
      const nextApproverName: string | null = payload.nextApproverName || null;
      const exp3 = payload.expense || {};
      const refreshIfNeeded = async () => {
        if (!opts?.skipRefresh) await fetchExpenses();
      };

      if (!finalized) {
        // Notify next approver ASAP (unchanged UX) — skip on replay to
        // avoid double-notifying the next approver.
        if (!replayed && nextApproverName && nextApproverName !== "Administrador") {
          void createNotification({
            user_identifier: nextApproverName,
            title: "Nova aprovação pendente",
            body: `${exp3.requester_name || "Solicitante"} · ${exp3.supplier_name || ""} (${exp3.currency || "BRL"} ${Number(exp3.total_amount || 0).toFixed(2)}) aguarda sua aprovação (nível ${payload.currentLevel || ""}).`,
            category: "approval",
            company_db: exp3.company_db || undefined,
            link: `/approvals`,
            metadata: { expense_id: expenseId, level: payload.currentLevel },
          }).catch(() => {});
        }
        await refreshIfNeeded();
        return { replayed };
      }

      // Final level → notify requester. ERP integration is dispatched by
      // expense-approval-action so it survives tab/session closure.
      // Em caso de replay (retry idempotente), pulamos a notificação para
      // não duplicá-la, mas ainda garantimos o refresh da lista.
      if (!replayed) {
        void (async () => {
          try {
          const reqId = exp3.requester_email || exp3.requester_name;
          if (reqId) {
            await createNotification({
              user_identifier: reqId,
              title: "Pedido aprovado",
              body: `Seu pedido "${exp3.supplier_name || ""}" (${exp3.currency || "BRL"} ${Number(exp3.total_amount || 0).toFixed(2)}) foi aprovado em todos os níveis.`,
              category: "approval",
              company_db: exp3.company_db || undefined,
              link: `/my-requests`,
              metadata: { expense_id: expenseId },
            });
          }
          } catch { /* silent */ }

        })().catch((e) => console.warn("[approval] Pós-aprovação em background falhou:", e));
      }

      await refreshIfNeeded();
      return { replayed };
    },
    [fetchExpenses]
  );

  const retrySapIntegration = useCallback(
    async (expenseId: string) => {
      if (!session || !["sap", "omie"].includes(String(session.erpType || "").toLowerCase())) {
        throw new Error("Selecione uma empresa com integração ERP antes de integrar.");
      }
      const isSap = String(session.erpType).toLowerCase() === "sap";
      if (isSap && !session.isSuperUser) {
        throw new Error("Apenas super-usuários podem reintegrar manualmente ao ERP.");
      }
      try {
        const data = await invokeExpenseToSap({
          expense_id: expenseId,
          // "Reintegrar ao SAP" (manual, super-user) reusa a sessão SAP do
          // usuário logado — evita depender do Apiuser em cenários de auditoria.
          use_service_account: !isSap,
          ...(isSap ? {
            sap_session_id: session.sessionId,
            sap_route_id: session.routeId,
            sap_company_db: session.companyDB,
            sap_session_expires_at: session.expiresAt,
          } : {}),
        });
        await logExpenseDecision(expenseId, "integrated", { approverName: session.userName });
        await fetchExpenses();
        return data;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro desconhecido";
        await logExpenseDecision(expenseId, "integration_failed", { remarks: msg });
        throw e;
      }
    },
    [fetchExpenses, session]
  );

  const rejectExpense = useCallback(
    async (expenseId: string, remarks?: string, idempotencyKey?: string, opts?: { skipRefresh?: boolean }) => {
      // Same server-side authorization as approveExpense — never flip the
      // status directly from the client.
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      const resp = await sapFunctionFetch("expense-approval-action", {
        method: "POST",
        headers,
        body: JSON.stringify({ expense_id: expenseId, action: "reject", remarks: remarks || undefined }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || !payload?.ok) {
        const stage = payload?.stage ? ` [etapa: ${payload.stage}]` : "";
        const rid = payload?.requestId ? ` (req ${String(payload.requestId).slice(0, 8)})` : "";
        const base = payload?.error || `Falha ao rejeitar (HTTP ${resp.status})`;
        throw new Error(`${base}${stage}${rid}`);
      }
      if (!opts?.skipRefresh) await fetchExpenses();
      return { replayed: !!payload.replayed };
    },
    [fetchExpenses]
  );


  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  // Optimistic removal — remove um documento localmente sem esperar refresh
  // do backend. Usado após aprovar/rejeitar para atualizar a UI na hora.
  const removeLocal = useCallback((expenseId: string) => {
    setExpenses((prev) => prev.filter((e) => e.id !== expenseId));
  }, []);

  return {
    expenses,
    total,
    hasMore,
    sapKeys,
    isLoading,
    error,

    refresh: fetchExpenses,
    removeLocal,
    createExpense,
    updateExpense,
    submitForApproval,
    cancelExpense,
    reactivateExpense,
    approveExpense,
    rejectExpense,
    retrySapIntegration,
    addAttachments,
  };
}
