import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";

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

  // Match rules of the active company OR legacy rules without a company (treated as global).
  if (companyDb) {
    q = q.or(`company_db.eq.${companyDb},company_db.is.null`);
  } else {
    q = q.is("company_db", null);
  }

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
      if (expenseIds.length > 0) {
        const { data: items } = await supabase
          .from("expense_items")
          .select("*")
          .in("expense_id", expenseIds);
        if (items) {
          for (const item of items as any[]) {
            if (!itemsMap[item.expense_id]) itemsMap[item.expense_id] = [];
            itemsMap[item.expense_id].push(item);
          }
        }
      }

      setExpenses(
        (data || []).map((e: any) => ({
          ...e,
          items: itemsMap[e.id] || [],
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

      // Evaluate approval rules for manual expenses (PagCorp skips rules)
      if (!input.skipRules && origin === "manual") {
        const ctx = {
          total_amount: totalAmount,
          cost_center: input.cost_center || "",
          project: input.project || "",
          requester_name: session.userName,
          supplier_name: input.supplier_name,
          currency: input.currency || "BRL",
          doc_type: docType,
        };
        const match = await findMatchingRule(ctx, session.companyDB || null, docType);
        if (match) {
          status = "pendente_aprovacao";
          currentApprover = match.firstApprover?.name || null;
        } else {
          status = "aprovado";
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
          origin,
          company_db: session.companyDB,
          branch_id: input.branch_id ?? 1,
          doc_type: input.doc_type || docType,
        } as any)
        .select()
        .single();

      if (err) throw err;

      if (input.items.length > 0) {
        const { error: itemsErr } = await supabase.from("expense_items").insert(
          input.items.map((item) => ({
            expense_id: (expense as any).id,
            item_code: item.item_code || null,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            line_total: item.line_total,
            cost_center: item.cost_center || input.cost_center || null,
            project: item.project || input.project || null,
          }))
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
      if (status !== "rascunho" && status !== "pendente_aprovacao") {
        throw new Error("Somente pedidos em rascunho ou pendentes de aprovação podem ser alterados.");
      }

      const updates: any = {};
      if (input.supplier_name !== undefined) updates.supplier_name = input.supplier_name;
      if (input.supplier_code !== undefined) updates.supplier_code = input.supplier_code;
      if (input.remarks !== undefined) updates.remarks = input.remarks;

      if (input.items && input.items.length > 0) {
        const totalAmount = input.items.reduce((s, i) => s + i.line_total, 0);
        updates.total_amount = totalAmount;
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

        const { error: insErr } = await supabase.from("expense_items").insert(
          input.items.map((item) => ({
            expense_id: expenseId,
            item_code: item.item_code || null,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            line_total: item.line_total,
            cost_center: item.cost_center || null,
            project: item.project || null,
          }))
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
      const { error: err } = await supabase
        .from("expenses")
        .update({ status: "pendente_aprovacao" as any })
        .eq("id", expenseId);
      if (err) throw err;
      await fetchExpenses();
    },
    [fetchExpenses]
  );

  const cancelExpense = useCallback(
    async (expenseId: string) => {
      const { error: err } = await supabase
        .from("expenses")
        .update({ status: "cancelado" as any })
        .eq("id", expenseId);
      if (err) throw err;
      await fetchExpenses();
    },
    [fetchExpenses]
  );

  const approveExpense = useCallback(
    async (expenseId: string, remarks?: string) => {
      const updates: any = { status: "aprovado" };
      if (remarks) updates.remarks = remarks;
      const { error: err } = await supabase
        .from("expenses")
        .update(updates)
        .eq("id", expenseId);
      if (err) throw err;

      // Trigger SAP integration immediately (only for SAP companies)
      if (session?.erpType === "sap") {
        try {
          const { data, error: fnErr } = await supabase.functions.invoke("expense-to-sap", {
            body: { expense_id: expenseId },
          });
          if (fnErr) throw fnErr;
          if (data && data.success === false) throw new Error(data.error || "Falha ao integrar no SAP");
        } catch (sapErr) {
          await fetchExpenses();
          throw new Error(
            `Despesa aprovada, mas falhou ao integrar no SAP: ${sapErr instanceof Error ? sapErr.message : "Erro desconhecido"}`,
          );
        }
      }

      await fetchExpenses();
    },
    [fetchExpenses, session]
  );

  const retrySapIntegration = useCallback(
    async (expenseId: string) => {
      const { data, error: fnErr } = await supabase.functions.invoke("expense-to-sap", {
        body: { expense_id: expenseId },
      });
      if (fnErr) throw fnErr;
      if (data && data.success === false) throw new Error(data.error || "Falha ao integrar no SAP");
      await fetchExpenses();
      return data;
    },
    [fetchExpenses]
  );

  const rejectExpense = useCallback(
    async (expenseId: string, remarks?: string) => {
      const updates: any = { status: "rejeitado" };
      if (remarks) updates.remarks = remarks;
      const { error: err } = await supabase
        .from("expenses")
        .update(updates)
        .eq("id", expenseId);
      if (err) throw err;
      await fetchExpenses();
    },
    [fetchExpenses]
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
