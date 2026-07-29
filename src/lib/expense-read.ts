// Leitura de despesas via edge function escopada (`expense-read`).
//
// Substitui `supabase.from("expenses"|"expense_items"|"expense_attachments")`
// no frontend: as políticas de RLS dessas tabelas não permitem mais SELECT
// pelo cliente. A API abaixo imita o builder do supabase-js para que os pontos
// de chamada mudem o mínimo possível.
//
//   const { data, error } = await expenseRead("expenses")
//     .select("id, supplier_name")
//     .eq("company_db", db)
//     .order("created_at", { ascending: false })
//     .limit(100);

import { sapFunctionFetch } from "@/lib/auth-fetch";

export type ExpenseReadTable = "expenses" | "expense_items" | "expense_attachments";

type Filter = { op: string; column: string; value?: unknown };

interface Spec {
  table: ExpenseReadTable;
  select: string;
  filters: Filter[];
  or?: string;
  order?: { column: string; ascending: boolean; nullsFirst: boolean };
  limit?: number;
  range?: [number, number];
  scope?: "auto" | "all";
}

export interface ExpenseReadResult<T = any> {
  data: T[] | null;
  error: { message: string } | null;
  scoped?: boolean;
  privileged?: boolean;
}

class ExpenseReadBuilder<T = any> implements PromiseLike<ExpenseReadResult<T>> {
  private spec: Spec;

  constructor(table: ExpenseReadTable) {
    this.spec = { table, select: "*", filters: [] };
  }

  select(cols: string) { this.spec.select = cols; return this; }
  eq(column: string, value: unknown) { return this.push("eq", column, value); }
  neq(column: string, value: unknown) { return this.push("neq", column, value); }
  gt(column: string, value: unknown) { return this.push("gt", column, value); }
  gte(column: string, value: unknown) { return this.push("gte", column, value); }
  lt(column: string, value: unknown) { return this.push("lt", column, value); }
  lte(column: string, value: unknown) { return this.push("lte", column, value); }
  like(column: string, value: unknown) { return this.push("like", column, value); }
  ilike(column: string, value: unknown) { return this.push("ilike", column, value); }
  in(column: string, values: unknown[]) { return this.push("in", column, values); }
  is(column: string, value: unknown) { return this.push("is", column, value); }
  not(column: string, op: string, value: unknown) {
    if (op !== "is") throw new Error(`expense-read: not(${op}) não suportado`);
    return this.push("not_is", column, value);
  }
  or(clause: string) { this.spec.or = clause; return this; }
  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.spec.order = {
      column,
      ascending: opts?.ascending !== false,
      nullsFirst: Boolean(opts?.nullsFirst),
    };
    return this;
  }
  limit(n: number) { this.spec.limit = n; return this; }
  range(from: number, to: number) { this.spec.range = [from, to]; return this; }
  /** Solicita a visão global — só é honrada pelo servidor para privilegiados. */
  viewAll(enabled = true) { this.spec.scope = enabled ? "all" : "auto"; return this; }

  private push(op: string, column: string, value: unknown) {
    this.spec.filters.push({ op, column, value });
    return this;
  }

  async run(): Promise<ExpenseReadResult<T>> {
    try {
      const res = await sapFunctionFetch("expense-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.spec),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        return { data: null, error: { message: body?.error || `expense-read ${res.status}` } };
      }
      return {
        data: (body?.data ?? []) as T[],
        error: null,
        scoped: body?.scoped,
        privileged: body?.privileged,
      };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  }

  /** Retorna a primeira linha (equivalente a `.maybeSingle()`). */
  async maybeSingle(): Promise<{ data: T | null; error: { message: string } | null }> {
    const r = await this.limit(1).run();
    return { data: (r.data && r.data[0]) || null, error: r.error };
  }

  then<TResult1 = ExpenseReadResult<T>, TResult2 = never>(
    onfulfilled?: ((value: ExpenseReadResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

export function expenseRead<T = any>(table: ExpenseReadTable) {
  return new ExpenseReadBuilder<T>(table);
}
