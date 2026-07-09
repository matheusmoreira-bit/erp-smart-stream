import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { sapFunctionFetch } from "@/lib/auth-fetch";
import { sapQuery, type SapSession } from "@/lib/sap-client";
import { useSap } from "@/contexts/SapContext";
import { createNotification } from "@/lib/notifications";

/* ───────────────── Item group enrichment ───────────────── */

interface EnrichedItem {
  item_code: string | null;
  items_group_code: number | null;
  items_group_name: string | null;
}

async function enrichItemsWithGroup(
  items: Array<{ item_code?: string | null }>,
  session: SapSession,
): Promise<Record<string, EnrichedItem>> {
  const codes = Array.from(
    new Set(
      items.map((i) => (i.item_code || "").trim()).filter((c) => c.length > 0),
    ),
  );
  const result: Record<string, EnrichedItem> = {};
  if (codes.length === 0) return result;

  // Fetch item -> group code
  const codeToGroup: Record<string, number | null> = {};
  await Promise.all(
    codes.map(async (code) => {
      try {
        const { data } = await sapQuery(
          session,
          `Items('${code.replace(/'/g, "''")}')`,
          { $select: "ItemCode,ItemsGroupCode" },
          true,
        );
        const g = (data as any)?.ItemsGroupCode;
        codeToGroup[code] = typeof g === "number" ? g : null;
      } catch {
        codeToGroup[code] = null;
      }
    }),
  );

  // Fetch unique groups -> name
  const groupCodes = Array.from(
    new Set(Object.values(codeToGroup).filter((g): g is number => g != null)),
  );
  const groupToName: Record<number, string | null> = {};
  await Promise.all(
    groupCodes.map(async (gc) => {
      try {
        const { data } = await sapQuery(
          session,
          `ItemGroups(${gc})`,
          { $select: "Number,GroupName" },
          true,
        );
        groupToName[gc] = (data as any)?.GroupName ?? null;
      } catch {
        groupToName[gc] = null;
      }
    }),
  );

  for (const code of codes) {
    const gc = codeToGroup[code];
    result[code] = {
      item_code: code,
      items_group_code: gc,
      items_group_name: gc != null ? groupToName[gc] ?? null : null,
    };
  }
  return result;
}

function buildItemCtx(
  items: Array<{ item_code?: string | null }>,
  enriched: Record<string, EnrichedItem>,
): { item_codes: string; item_groups: string } {
  // Wrap with spaces so `like '% fol%'` and `like '% folha %'` work.
  const codes = items
    .map((i) => (i.item_code || "").trim().toLowerCase())
    .filter(Boolean);
  const groups = items
    .map((i) => {
      const c = (i.item_code || "").trim();
      return (enriched[c]?.items_group_name || "").trim().toLowerCase();
    })
    .filter(Boolean);
  return {
    item_codes: codes.length ? ` ${codes.join(" ")} ` : "",
    item_groups: groups.length ? ` ${groups.join(" ")} ` : "",
  };
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
  sap_integration_last_attempt_at?: string | null;
  origin?: ExpenseOrigin;
  created_by_email?: string;
  company_db?: string;
  branch_id?: number;
  doc_date?: string;
  due_date?: string;
  rateio_type?: string | null;
  created_at: string;
  updated_at: string;
  items?: ExpenseItem[];
  attachments?: ExpenseAttachment[];
}

export type ExpenseDocType = "purchase" | "sales";

export interface CreateExpenseInput {
  supplier_code?: string;
  supplier_name: string;
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
  rateio_type?: RateioType | null;
  items: Omit<ExpenseItem, "id">[];
  files?: File[];
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

async function invokeExpenseToSap(body: Record<string, unknown>) {
  const res = await sapFunctionFetch("expense-to-sap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Edge function returned ${res.status}`);
  if (data && data.success === false) throw new Error(data.error || "Falha ao integrar no SAP");
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
      const pattern = target.split("").map((ch) => ch === "%" ? ".*" : ch === "_" ? "." : escapeRegex(ch)).join("");
      const re = new RegExp(`^${pattern}$`);
      return re.test(val) || tokens.some((t) => re.test(t));
    }
    default: return false;
  }
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

  const { data: rules } = await q;
  if (!rules || rules.length === 0) return null;

  // Filter by doc_type: rule applies when matching type, "both", or null (legacy)
  const filtered = (rules as any[]).filter((r) => {
    const rdt = r.doc_type;
    return !rdt || rdt === "both" || rdt === docType;
  });
  if (filtered.length === 0) return null;

  for (const r of filtered) {
    const criteria: RuleCriterion[] = Array.isArray(r.criteria) ? r.criteria : [];
    if (criteria.length === 0) continue;
    const allMatch = criteria.every((c) => evaluateCriterion(c, ctx));
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

export function useExpenses(docType: ExpenseDocType = "purchase") {
  const { session } = useSap();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchExpenses = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const activeCompanyDb = session?.companyDB;
      if (!activeCompanyDb) {
        setExpenses([]);
        return;
      }

      const { data, error: err } = await (supabase
        .from("expenses") as any)
        .select("*")
        .eq("company_db", activeCompanyDb)
        .eq("doc_type", docType)
        .order("created_at", { ascending: false });

      if (err) throw err;

      const expenseIds = (data || []).map((e: any) => e.id);
      let itemsMap: Record<string, ExpenseItem[]> = {};
      let attachmentsMap: Record<string, ExpenseAttachment[]> = {};
      if (expenseIds.length > 0) {
        const [{ data: items }, { data: atts }] = await Promise.all([
          supabase.from("expense_items").select("*").in("expense_id", expenseIds),
          supabase.from("expense_attachments").select("*").in("expense_id", expenseIds),
        ]);
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
    } catch (e) {
      console.error("Error fetching expenses:", e);
      setError(e instanceof Error ? e.message : "Erro ao buscar despesas");
    } finally {
      setIsLoading(false);
    }
  }, [session?.companyDB, docType]);

  const createExpense = useCallback(
    async (input: CreateExpenseInput) => {
      if (!session) throw new Error("Sessão SAP não encontrada");

      const totalAmount = input.items.reduce((sum, item) => sum + item.line_total, 0);
      const origin: ExpenseOrigin = input.origin || "manual";

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

      // Enrich items with SAP item group (used both for rule context and for persistence)
      const enriched = await enrichItemsWithGroup(input.items, session);
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

          let match: Awaited<ReturnType<typeof findMatchingRule>> = null;
          for (const cc of (candidateCcs.length > 0 ? candidateCcs : [""])) {
            const ctx = {
              total_amount: totalAmount,
              cost_center: cc,
              project: input.project || "",
              requester_name: session.userName,
              supplier_name: `${input.supplier_name || ""} ${input.supplier_code || ""}`.trim(),
              currency: input.currency || "BRL",
              doc_type: docType,
              item_codes: itemCtx.item_codes,
              item_groups: itemCtx.item_groups,
            };
            match = await findMatchingRule(ctx, session.companyDB || null, docType);
            if (match) break;
          }

          if (match) {
            status = "pendente_aprovacao";
            currentApprover = match.firstApprover?.name || null;
            matchedRuleId = match.rule.id;
          } else {
            // Sem regra correspondente: NUNCA auto-aprovar. Vai para aprovação
            // administrativa — busca um admin padrão para exibir como aprovador.
            status = "pendente_aprovacao";
            matchedRuleId = null;
            try {
              const { data: fallback } = await (supabase as any).rpc(
                "get_default_expense_approver",
                { _company_db: session.companyDB || null },
              );
              currentApprover = (typeof fallback === "string" && fallback.trim()) || "Administrador";
            } catch {
              currentApprover = "Administrador";
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
          doc_type: input.doc_type || docType,
          doc_date: input.doc_date || null,
          due_date: input.due_date || null,
          rateio_type: input.rateio_type || null,
          items: enrichedItems,
        },
      });
      const expense = createResp.expense;
      const createdId = expense.id as string;

      // ─── Fast path ────────────────────────────────────────────────────
      // A despesa já foi PERSISTIDA no servidor. Retornamos imediatamente
      // para o chamador (modal) fechar e o usuário ver o feedback. As
      // etapas restantes (notificar aprovador, enviar anexos, refresh da
      // lista) rodam em segundo plano com toasts próprios em caso de
      // falha — assim o tempo percebido de lançamento cai drasticamente.
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


        // 2) Upload de anexos em PARALELO (era serial → gargalo principal)
        if (input.files && input.files.length > 0) {
          const results = await Promise.allSettled(
            input.files.map(async (file) => {
              const fd = new FormData();
              fd.append("expense_id", createdId);
              fd.append("file", file, file.name);
              const res = await sapFunctionFetch("expense-attachment-storage", {
                method: "POST",
                body: fd,
              });
              const data = await res.json().catch(() => null);
              if (!res.ok || !data?.ok) {
                throw new Error(data?.error || `upload retornou ${res.status}`);
              }
              return {
                file_path: data.file_path as string,
                file_name: data.file_name as string,
                file_size: data.file_size as number,
                mime_type: data.mime_type as string,
              };
            }),
          );

          const uploaded = results
            .map((r, i) => ({ r, name: input.files![i].name }))
            .filter((x) => x.r.status === "fulfilled")
            .map((x) => (x.r as PromiseFulfilledResult<{ file_path: string; file_name: string; file_size: number; mime_type: string }>).value);
          const failed = results
            .map((r, i) => ({ r, name: input.files![i].name }))
            .filter((x) => x.r.status === "rejected")
            .map((x) => `${x.name}: ${((x.r as PromiseRejectedResult).reason instanceof Error ? ((x.r as PromiseRejectedResult).reason as Error).message : String((x.r as PromiseRejectedResult).reason))}`);

          if (uploaded.length > 0) {
            try {
              await invokeExpenseMutation({
                action: "attachments_add",
                expense_id: createdId,
                attachments: uploaded,
              });
            } catch (attErr) {
              console.error("Falha ao registrar anexos:", attErr);
              toast.error(
                `Despesa criada, mas falhou ao registrar ${uploaded.length} anexo(s) no servidor: ${attErr instanceof Error ? attErr.message : String(attErr)}. Reabra a despesa e reanexe os arquivos.`,
                { duration: 10000 },
              );
            }
          }
          if (failed.length > 0) {
            // Um toast por arquivo (até 3), depois consolida o restante,
            // sempre nomeando o arquivo para o usuário poder reanexar.
            const shown = failed.slice(0, 3);
            for (const f of shown) {
              toast.error(`Falha ao enviar anexo "${f}". Reabra a despesa criada e reanexe o arquivo.`, {
                duration: 9000,
              });
            }
            if (failed.length > shown.length) {
              toast.error(
                `+ ${failed.length - shown.length} outro(s) anexo(s) falharam ao enviar. Reabra a despesa para reanexá-los.`,
                { duration: 9000 },
              );
            }
          }
        }

        // 3) Refresh final para a lista refletir o novo item
        fetchExpenses().catch((err) => console.warn("refresh pós-criação falhou:", err));
      };

      // Fire-and-forget: não bloqueia a resposta ao chamador.
      void finalize();

      return { expense, status, origin };
    },
    [session, fetchExpenses, docType]
  );


  const updateExpense = useCallback(
    async (
      expenseId: string,
      input: {
        supplier_name?: string;
        supplier_code?: string | null;
        remarks?: string | null;
        doc_date?: string | null;
        due_date?: string | null;
        items?: Omit<ExpenseItem, "id">[];
      }
    ) => {
      if (!session) throw new Error("Sessão SAP não encontrada");

      let enrichedItems: any[] | undefined;
      if (input.items) {
        const enrichedUpd = await enrichItemsWithGroup(input.items, session);
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
        const { data: exp } = await supabase
          .from("expenses")
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
   */
  const addAttachments = useCallback(
    async (expenseId: string, files: File[]) => {
      if (!files.length) return;
      const rows: Array<{ file_path: string; file_name: string; file_size: number; mime_type: string }> = [];
      const failed: string[] = [];
      for (const file of files) {
        try {
          const fd = new FormData();
          fd.append("expense_id", expenseId);
          fd.append("file", file, file.name);
          const res = await sapFunctionFetch("expense-attachment-storage", { method: "POST", body: fd });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.ok) throw new Error(data?.error || `upload retornou ${res.status}`);
          rows.push({
            file_path: data.file_path,
            file_name: data.file_name,
            file_size: data.file_size,
            mime_type: data.mime_type,
          });
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
      await fetchExpenses();
      if (failed.length > 0) {
        throw new Error(`Falha ao enviar ${failed.length} anexo(s): ${failed.join("; ")}`);
      }
      return { inserted: rows.length };
    },
    [fetchExpenses]
  );



  const approveExpense = useCallback(
    async (expenseId: string, remarks?: string, idempotencyKey?: string) => {
      const actor = session?.userName || "";

      // Server-side authorization: the edge function verifies that the caller
      // (SAP session or Cloud admin) is the designated approver for the
      // CURRENT level before flipping the status. This is the security
      // boundary — do NOT bypass it with a direct supabase.from("expenses")
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

      if (!finalized) {
        // Notify next approver ASAP (unchanged UX) — skip on replay to
        // avoid double-notifying the next approver.
        if (!replayed && nextApproverName && nextApproverName !== "Administrador") {
          await createNotification({
            user_identifier: nextApproverName,
            title: "Nova aprovação pendente",
            body: `${exp3.requester_name || "Solicitante"} · ${exp3.supplier_name || ""} (${exp3.currency || "BRL"} ${Number(exp3.total_amount || 0).toFixed(2)}) aguarda sua aprovação (nível ${payload.currentLevel || ""}).`,
            category: "approval",
            company_db: exp3.company_db || undefined,
            link: `/approvals`,
            metadata: { expense_id: expenseId, level: payload.currentLevel },
          });
        }
        await fetchExpenses();
        return { replayed };
      }

      // Final level → notify requester and trigger SAP integration.
      // Em caso de replay (retry idempotente), pulamos a notificação para
      // não duplicá-la, mas ainda garantimos o refresh da lista.
      if (!replayed) {
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

        if (session?.erpType === "sap") {
          // Defesa contra race: mesmo que o servidor tenha respondido
          // finalized=true, revalidamos o status ANTES de invocar o SAP.
          // Se ainda não estiver "aprovado" (propagação/leitura em réplica),
          // tentamos por até ~1.5s antes de desistir — evita chamar
          // expense-to-sap com status ainda "pendente_aprovacao".
          let confirmedApproved = false;
          let alreadyInErp = false;
          let originFromErp = false;
          for (let attempt = 0; attempt < 5; attempt++) {
            const { data: fresh } = await supabase
              .from("expenses")
              .select("status,sap_doc_entry,origin")
              .eq("id", expenseId)
              .maybeSingle();
            const freshAny = fresh as any;
            if (freshAny?.status === "aprovado") {
              confirmedApproved = true;
              alreadyInErp = !!freshAny?.sap_doc_entry;
              originFromErp = ["sap", "erp", "sap_erp", "erp_flow"].includes(
                String(freshAny?.origin || "").toLowerCase(),
              );
              break;
            }
            await new Promise((r) => setTimeout(r, 300));
          }
          if (!confirmedApproved) {
            await logExpenseDecision(expenseId, "integration_failed", {
              remarks: "Aprovação registrada, mas status não propagou para 'aprovado' a tempo — integração SAP não disparada automaticamente.",
            });
            await fetchExpenses();
            return { replayed };
          }

          // Se o documento veio do ERP (origem ERP OU já existe no SAP com
          // sap_doc_entry), NÃO tentamos criar um novo pedido de compra. A
          // decisão de aprovação já foi registrada; qualquer criação no SAP
          // duplicaria o pedido original. Apenas registramos e paramos aqui.
          if (originFromErp || alreadyInErp) {
            await logExpenseDecision(expenseId, "integrated", {
              approverName: actor,
              remarks: alreadyInErp
                ? "Documento já existente no ERP — nenhum novo pedido de compra criado."
                : "Documento originado no ERP — apenas a decisão de aprovação foi registrada.",
            });
            await fetchExpenses();
            return { replayed };
          }


          // Integração ao SAP é DESACOPLADA da aprovação: a aprovação já
          // foi persistida com sucesso pelo servidor. Se a integração
          // falhar, apenas registramos no audit log — o aprovador NÃO
          // deve ver essa falha como erro dele. Um super-usuário pode
          // reintegrar manualmente depois via "Reintegrar ao SAP".
          try {
            await invokeExpenseToSap({
              expense_id: expenseId,
              // Integração automática após o último nível de aprovação usa
              // sempre o Apiuser configurado nas credenciais da empresa —
              // não depende do aprovador estar logado no SAP.
              use_service_account: true,
            });
            await logExpenseDecision(expenseId, "integrated", { approverName: actor });
          } catch (sapErr) {
            const msg = sapErr instanceof Error ? sapErr.message : "Erro desconhecido";
            console.warn("[approval] Integração SAP falhou (aprovação preservada):", msg);
            await logExpenseDecision(expenseId, "integration_failed", { remarks: msg });
            // NÃO relançamos: aprovação está registrada e o documento
            // seguirá para reintegração assíncrona / manual.
          }
        }
      }

      await fetchExpenses();
      return { replayed };
    },
    [fetchExpenses, session]
  );

  const retrySapIntegration = useCallback(
    async (expenseId: string) => {
      if (!session || session.erpType !== "sap") throw new Error("Faça login no SAP pela tela antes de integrar.");
      if (!session.isSuperUser) {
        throw new Error("Apenas super-usuários podem reintegrar manualmente ao SAP.");
      }
      try {
        const data = await invokeExpenseToSap({
          expense_id: expenseId,
          // "Reintegrar ao SAP" (manual, super-user) reusa a sessão SAP do
          // usuário logado — evita depender do Apiuser em cenários de auditoria.
          use_service_account: false,
          sap_session_id: session.sessionId,
          sap_route_id: session.routeId,
          sap_company_db: session.companyDB,
          sap_session_expires_at: session.expiresAt,
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
    async (expenseId: string, remarks?: string, idempotencyKey?: string) => {
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
      await fetchExpenses();
      return { replayed: !!payload.replayed };
    },
    [fetchExpenses, session]
  );


  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  return {
    expenses,
    isLoading,
    error,
    refresh: fetchExpenses,
    createExpense,
    updateExpense,
    submitForApproval,
    cancelExpense,
    approveExpense,
    rejectExpense,
    retrySapIntegration,
    addAttachments,
  };
}
