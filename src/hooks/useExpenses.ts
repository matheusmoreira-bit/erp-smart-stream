import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";

export type ExpenseStatus =
  | "rascunho"
  | "pendente_aprovacao"
  | "aprovado"
  | "rejeitado"
  | "pc_lancado"
  | "nf_entrada"
  | "pagamento"
  | "finalizado";

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
  created_at: string;
  updated_at: string;
  items?: ExpenseItem[];
  attachments?: ExpenseAttachment[];
}

export interface CreateExpenseInput {
  supplier_code?: string;
  supplier_name: string;
  currency?: string;
  cost_center?: string;
  project?: string;
  remarks?: string;
  items: Omit<ExpenseItem, "id">[];
}

const STATUS_LABELS: Record<ExpenseStatus, string> = {
  rascunho: "Rascunho",
  pendente_aprovacao: "Pendente Aprovação",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
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
  pc_lancado: "bg-primary/15 text-primary",
  nf_entrada: "bg-primary/15 text-primary",
  pagamento: "bg-primary/15 text-primary",
  finalizado: "bg-success/15 text-success",
};

export { STATUS_LABELS, STATUS_COLORS };

export function useExpenses() {
  const { session } = useSap();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchExpenses = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("expenses")
        .select("*")
        .order("created_at", { ascending: false });

      if (err) throw err;

      // Fetch items for all expenses
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
  }, []);

  const createExpense = useCallback(
    async (input: CreateExpenseInput) => {
      if (!session) throw new Error("Sessão SAP não encontrada");

      const totalAmount = input.items.reduce((sum, item) => sum + item.line_total, 0);

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
          status: "rascunho" as any,
          requester_name: session.userName,
          requester_email: null,
        })
        .select()
        .single();

      if (err) throw err;

      // Insert items
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

      await fetchExpenses();
      return expense;
    },
    [session, fetchExpenses]
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

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  return {
    expenses,
    isLoading,
    error,
    refresh: fetchExpenses,
    createExpense,
    submitForApproval,
  };
}
