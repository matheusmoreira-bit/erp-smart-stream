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
import { isFakeAuthEnabled } from "@/lib/fake-auth";

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
  /** Solicita a contagem total do conjunto filtrado (paginação server-side). */
  count?: boolean;
  /** Retorna as chaves ERP (DocEntry/DocNum) de todo o conjunto filtrado. */
  keys?: boolean;
  /** Tabelas filhas retornadas na mesma resposta (evita round-trips). */
  include?: Array<"items" | "attachments">;
}

export interface ExpenseReadResult<T = any> {
  data: T[] | null;
  error: { message: string } | null;
  scoped?: boolean;
  privileged?: boolean;
  items?: any[];
  attachments?: any[];
  /** Total de linhas do conjunto filtrado (null quando não pôde ser apurado). */
  count?: number | null;
  /** Há mais linhas além da janela retornada. */
  hasMore?: boolean;
  /** A varredura foi interrompida pelo teto de linhas — total é aproximado. */
  truncated?: boolean;
  keys?: Array<{ company_db: string | null; sap_doc_entry: number | null; sap_doc_num: number | null }>;
}

function isAuthSessionError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("sessão sap não encontrada") ||
    normalized.includes("sessao sap nao encontrada") ||
    normalized.includes("não autenticado") ||
    normalized.includes("nao autenticado") ||
    normalized.includes("auth session missing")
  );
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
  in(column: string, values: readonly unknown[]) { return this.push("in", column, values); }
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
  /** Traz itens/anexos das despesas na mesma resposta. */
  include(...tables: Array<"items" | "attachments">) { this.spec.include = tables; return this; }
  /** Pede a contagem total do conjunto filtrado. */
  withCount(enabled = true) { this.spec.count = enabled; return this; }
  /** Pede as chaves ERP de todo o conjunto filtrado (dedup com a lista do ERP). */
  withKeys(enabled = true) { this.spec.keys = enabled; return this; }
  /** Página 1-based traduzida para `range`. */
  page(page: number, pageSize: number) {
    const p = Math.max(1, Math.floor(page));
    const size = Math.max(1, Math.floor(pageSize));
    this.spec.range = [(p - 1) * size, p * size - 1];
    return this;
  }
  /** Solicita a visão global — só é honrada pelo servidor para privilegiados. */
  viewAll(enabled = true) { this.spec.scope = enabled ? "all" : "auto"; return this; }

  private push(op: string, column: string, value: unknown) {
    this.spec.filters.push({ op, column, value });
    return this;
  }

  private standaloneEmptyResult(): ExpenseReadResult<T> {
    return {
      data: [],
      error: null,
      scoped: true,
      privileged: true,
      items: [],
      attachments: [],
      count: this.spec.count ? 0 : null,
      hasMore: false,
      truncated: false,
      keys: this.spec.keys ? [] : undefined,
    };
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
        const message = body?.error || `expense-read ${res.status}`;
        if (isFakeAuthEnabled() && res.status === 401 && isAuthSessionError(message)) {
          return this.standaloneEmptyResult();
        }
        return { data: null, error: { message } };
      }
      return {
        data: (body?.data ?? []) as T[],
        error: null,
        scoped: body?.scoped,
        privileged: body?.privileged,
        items: body?.items,
        attachments: body?.attachments,
        count: body?.count ?? null,
        hasMore: Boolean(body?.hasMore),
        truncated: Boolean(body?.truncated),
        keys: body?.keys,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (isFakeAuthEnabled() && isAuthSessionError(message)) {
        return this.standaloneEmptyResult();
      }
      return { data: null, error: { message } };
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
