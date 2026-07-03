import { useState, useEffect, useCallback } from "react";
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
  items: Omit<ExpenseItem, "id">[];
  files?: File[];
}

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

  switch (c.operator) {
    case "greater_than": return Number(raw) > Number(c.value);
    case "less_than": return Number(raw) < Number(c.value);
    case "between": return Number(raw) >= Number(c.value) && Number(raw) <= Number(c.value2 ?? c.value);
    case "equal": return val === target;
    case "not_equal": return val !== target;
    case "contains": return val.includes(target);
    case "not_contains": return !val.includes(target);
    case "like": {
      const pattern = target.replace(/%/g, ".*").replace(/_/g, ".");
      return new RegExp(`^${pattern}$`).test(val);
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
    await supabase.from("expense_approval_log").insert({
      expense_id: expenseId,
      decision,
      approver_name: opts.approverName ?? null,
      approver_email: opts.approverEmail ?? null,
      level_order: opts.levelOrder ?? null,
      remarks: opts.remarks ?? null,
    } as any);
  } catch (e) {
    // Não bloqueia o fluxo principal se o log falhar (ex.: RLS), só registra.
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
      let status: ExpenseStatus = input.initialStatus || "rascunho";
      let currentApprover: string | null = null;
      let matchedRuleId: string | null = null;

      // Enrich items with SAP item group (used both for rule context and for persistence)
      const enriched = await enrichItemsWithGroup(input.items, session);
      const itemCtx = buildItemCtx(input.items, enriched);

      // Evaluate approval rules for manual expenses (PagCorp skips rules)
      if (!input.skipRules && origin === "manual") {
        // CC do cabeçalho pode estar vazio — usar o(s) CC(s) dos itens como fallback
        // para evitar bypass quando o rateio fica somente nas linhas.
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
            supplier_name: input.supplier_name,
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

      const userIdentifier = session.userName.includes("@") ? session.userName : `${session.userName}`;

      const { data: expense, error: err } = await supabase
        .from("expenses")
        .insert({
          supplier_code: input.supplier_code || null,
          supplier_name: input.supplier_name,
          total_amount: totalAmount,
          currency: input.currency || "BRL",
          cost_center: input.cost_center || null,
          project: input.project || null,
          remarks: input.remarks || null,
          status: status as any,
          requester_name: session.userName,
          requester_email: userIdentifier,
          created_by_email: userIdentifier,
          current_approver: currentApprover,
          approval_rule_id: matchedRuleId,
          origin,
          company_db: session.companyDB,
          branch_id: input.branch_id ?? 1,
          doc_type: input.doc_type || docType,
          doc_date: input.doc_date || null,
          due_date: input.due_date || null,
        } as any)
        .select()
        .single();

      if (err) throw err;

      const createdId = (expense as any).id as string;
      // Log de criação + envio para aprovação (quando aplicável)
      await logExpenseDecision(createdId, "created", {
        approverName: session.userName,
        approverEmail: userIdentifier,
        remarks: input.remarks || null,
      });
      if (status === "pendente_aprovacao") {
        await logExpenseDecision(createdId, "submitted", {
          approverName: session.userName,
          approverEmail: userIdentifier,
          levelOrder: 1,
        });
        if (currentApprover && currentApprover !== "Administrador") {
          await createNotification({
            user_identifier: currentApprover,
            title: "Nova aprovação pendente",
            body: `${session.userName} enviou "${input.supplier_name}" (${input.currency || "BRL"} ${totalAmount.toFixed(2)}) para sua aprovação.`,
            category: "approval",
            company_db: session.companyDB,
            link: `/approvals`,
            metadata: { expense_id: createdId },
          });
        }
      }

      if (input.items.length > 0) {
        const { error: itemsErr } = await supabase.from("expense_items").insert(
          input.items.map((item) => {
            const code = (item.item_code || "").trim();
            const e = code ? enriched[code] : undefined;
            return {
              expense_id: (expense as any).id,
              item_code: item.item_code || null,
              description: item.description,
              quantity: item.quantity,
              unit_price: item.unit_price,
              line_total: item.line_total,
              cost_center: item.cost_center || input.cost_center || null,
              project: item.project || input.project || null,
              items_group_code: e?.items_group_code ?? null,
              items_group_name: e?.items_group_name ?? null,
            };
          })
        );
        if (itemsErr) throw itemsErr;
      }

      // Upload attachments to storage and persist references so the SAP
      // integration can later upload them to SAP B1 Attachments2.
      if (input.files && input.files.length > 0) {
        const expenseId = (expense as any).id;
        const attachmentRows: {
          expense_id: string;
          file_path: string;
          file_name: string;
          file_size: number;
          mime_type: string;
        }[] = [];
        const failedUploads: string[] = [];

        for (const file of input.files) {
          const safeName = file.name.replace(/[^\w.\-]+/g, "_");
          const path = `${expenseId}/${Date.now()}_${safeName}`;
          const { error: upErr } = await supabase.storage
            .from("expense-attachments")
            .upload(path, file, {
              contentType: file.type || "application/octet-stream",
              upsert: false,
            });
          if (upErr) {
            console.error("Falha ao subir anexo", file.name, upErr);
            failedUploads.push(`${file.name}: ${upErr.message}`);
            continue;
          }
          attachmentRows.push({
            expense_id: expenseId,
            file_path: path,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type || "application/octet-stream",
          });
        }

        if (attachmentRows.length > 0) {
          const { error: attErr } = await supabase
            .from("expense_attachments")
            .insert(attachmentRows);
          if (attErr) {
            console.error("Falha ao registrar anexos:", attErr);
            throw new Error(`Falha ao registrar anexos no banco: ${attErr.message}`);
          }
        }

        if (failedUploads.length > 0) {
          // Surface failures so the user knows the SAP integration won't have attachments.
          throw new Error(
            `Falha ao enviar ${failedUploads.length} anexo(s): ${failedUploads.join("; ")}`,
          );
        }
      }

      await fetchExpenses();
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
        items?: Omit<ExpenseItem, "id">[];
      }
    ) => {
      if (!session) throw new Error("Sessão SAP não encontrada");

      // Load current expense to validate status
      const { data: current, error: getErr } = await supabase
        .from("expenses")
        .select("*")
        .eq("id", expenseId)
        .single();
      if (getErr) throw getErr;
      const status = (current as any).status as ExpenseStatus;
      const hasSapError = !!(current as any).sap_integration_error;
      const alreadyInSap = !!((current as any).sap_doc_entry || (current as any).sap_doc_num);
      const editableForFix = status === "aprovado" && hasSapError && !alreadyInSap;
      if (status !== "rascunho" && status !== "pendente_aprovacao" && !editableForFix) {
        throw new Error("Somente pedidos em rascunho, pendentes de aprovação ou aprovados com erro de integração podem ser alterados.");
      }

      const updates: any = {};
      if (input.supplier_name !== undefined) updates.supplier_name = input.supplier_name;
      if (input.supplier_code !== undefined) updates.supplier_code = input.supplier_code;
      if (input.remarks !== undefined) updates.remarks = input.remarks;

      if (input.items && input.items.length > 0) {
        const totalAmount = input.items.reduce((s, i) => s + i.line_total, 0);
        updates.total_amount = totalAmount;
      }

      // Quando o usuário edita após erro de integração, limpe o erro para
      // permitir nova tentativa limpa.
      if (editableForFix) {
        updates.sap_integration_error = null;
      }

      if (Object.keys(updates).length > 0) {
        const { error: upErr } = await supabase
          .from("expenses")
          .update(updates)
          .eq("id", expenseId);
        if (upErr) throw upErr;
      }

      if (input.items) {
        const { error: delErr } = await supabase
          .from("expense_items")
          .delete()
          .eq("expense_id", expenseId);
        if (delErr) throw delErr;

        const enrichedUpd = await enrichItemsWithGroup(input.items, session);

        const { error: insErr } = await supabase.from("expense_items").insert(
          input.items.map((item) => {
            const code = (item.item_code || "").trim();
            const e = code ? enrichedUpd[code] : undefined;
            return {
              expense_id: expenseId,
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
          })
        );
        if (insErr) throw insErr;
      }

      const actorEmail = session.userName.includes("@") ? session.userName : session.userName;
      await supabase.rpc("insert_audit_log", {
        p_action: "update_expense",
        p_entity_type: "expense",
        p_entity_id: expenseId,
        p_actor_email: actorEmail,
        p_company_db: session.companyDB || null,
        p_details: {
          doc_type: (current as any).doc_type || docType,
          previous_total: (current as any).total_amount,
          new_total: updates.total_amount ?? (current as any).total_amount,
          updated_fields: Object.keys(updates),
          items_count: input.items?.length,
        } as any,
      });

      await fetchExpenses();
    },
    [session, fetchExpenses, docType]
  );

  const submitForApproval = useCallback(
    async (expenseId: string) => {
      // Pre-validate: ensure at least one approval rule applies
      try {
        const { data: exp } = await supabase
          .from("expenses")
          .select("total_amount, cost_center, company_db")
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
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("Nenhuma regra")) throw e;
        // RPC failure should not block submission silently
        console.warn("check_applicable_approval_rules failed:", e);
      }

      const { error: err } = await supabase
        .from("expenses")
        .update({ status: "pendente_aprovacao" as any })
        .eq("id", expenseId);
      if (err) throw err;
      const actor = session?.userName || "";
      await logExpenseDecision(expenseId, "submitted", {
        approverName: actor,
        approverEmail: actor.includes("@") ? actor : null,
      });
      // Notify current approver ASAP
      try {
        const { data: exp2 } = await supabase
          .from("expenses")
          .select("current_approver, supplier_name, total_amount, currency, company_db")
          .eq("id", expenseId)
          .maybeSingle();
        const approver = (exp2 as any)?.current_approver as string | null;
        if (approver && approver !== "Administrador") {
          await createNotification({
            user_identifier: approver,
            title: "Nova aprovação pendente",
            body: `${actor} enviou "${(exp2 as any).supplier_name}" (${(exp2 as any).currency || "BRL"} ${Number((exp2 as any).total_amount || 0).toFixed(2)}) para sua aprovação.`,
            category: "approval",
            company_db: (exp2 as any).company_db || undefined,
            link: `/approvals`,
            metadata: { expense_id: expenseId },
          });
        }
      } catch { /* silent */ }
      await fetchExpenses();
    },
    [fetchExpenses, session]
  );

  const cancelExpense = useCallback(
    async (expenseId: string) => {
      const { error: err } = await supabase
        .from("expenses")
        .update({ status: "cancelado" as any })
        .eq("id", expenseId);
      if (err) throw err;
      const actor = session?.userName || "";
      await logExpenseDecision(expenseId, "cancelled", {
        approverName: actor,
        approverEmail: actor.includes("@") ? actor : null,
      });
      await fetchExpenses();
    },
    [fetchExpenses, session]
  );

  const approveExpense = useCallback(
    async (expenseId: string, remarks?: string) => {
      const actor = session?.userName || "";

      // Server-side authorization: the edge function verifies that the caller
      // (SAP session or Cloud admin) is the designated approver for the
      // CURRENT level before flipping the status. This is the security
      // boundary — do NOT bypass it with a direct supabase.from("expenses")
      // update, or any signed-in user could approve someone else's document.
      const resp = await sapFunctionFetch("expense-approval-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expense_id: expenseId, action: "approve", remarks: remarks || undefined }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || !payload?.ok) {
        throw new Error(payload?.error || `Falha ao aprovar (HTTP ${resp.status})`);
      }

      const finalized: boolean = !!payload.finalized;
      const nextApproverName: string | null = payload.nextApproverName || null;
      const exp3 = payload.expense || {};

      if (!finalized) {
        // Notify next approver ASAP (unchanged UX)
        if (nextApproverName && nextApproverName !== "Administrador") {
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
        return;
      }

      // Final level → notify requester and trigger SAP integration
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
        try {
          await invokeExpenseToSap({
            expense_id: expenseId,
            sap_session_id: session.sessionId,
            sap_route_id: session.routeId,
            sap_company_db: session.companyDB,
            sap_session_expires_at: session.expiresAt,
          });
          await logExpenseDecision(expenseId, "integrated", { approverName: actor });
        } catch (sapErr) {
          const msg = sapErr instanceof Error ? sapErr.message : "Erro desconhecido";
          await logExpenseDecision(expenseId, "integration_failed", { remarks: msg });
          await fetchExpenses();
          throw new Error(`Despesa aprovada, mas falhou ao integrar no SAP: ${msg}`);
        }
      }

      await fetchExpenses();
    },
    [fetchExpenses, session]
  );

  const retrySapIntegration = useCallback(
    async (expenseId: string) => {
      if (!session || session.erpType !== "sap") throw new Error("Faça login no SAP pela tela antes de integrar.");
      try {
        const data = await invokeExpenseToSap({
          expense_id: expenseId,
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
    async (expenseId: string, remarks?: string) => {
      // Same server-side authorization as approveExpense — never flip the
      // status directly from the client.
      const resp = await sapFunctionFetch("expense-approval-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expense_id: expenseId, action: "reject", remarks: remarks || undefined }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || !payload?.ok) {
        throw new Error(payload?.error || `Falha ao rejeitar (HTTP ${resp.status})`);
      }
      await fetchExpenses();
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
  };
}
