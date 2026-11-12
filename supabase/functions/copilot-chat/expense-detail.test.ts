import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { readExpenseDetail } from "./expense-detail.ts";

const ID = "00000000-0000-4000-8000-000000000001";
const rows: Record<string, Record<string, unknown>[]> = {
  expenses: [{ id: ID, company_db: "TEST" }],
  expense_items: [{ id: "item-1", expense_id: ID, description: "Item sintético", created_at: "2026-11-12T10:00:00Z" }],
  expense_approval_log: [{ id: "history-1", expense_id: ID }],
  expense_attachments: [{ id: "attachment-1", file_name: "nota-teste.pdf", file_size: 512, mime_type: "application/pdf", created_at: "2026-11-12T10:00:00Z" }],
};

function fixture(failedTable?: string, empty = false) {
  const requests: URL[] = [];
  const sb = createClient("https://example.invalid", "synthetic-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input) => {
        const url = new URL(String(input));
        requests.push(url);
        const table = url.pathname.split("/").pop() || "";
        const columns = url.searchParams.get("select") || "";
        // Reproduce the actual database failures before the correction.
        const invalid = /\b(filename|size_bytes)\b/.test(columns) || url.searchParams.get("order")?.includes("line_num");
        if (invalid || table === failedTable) {
          return Promise.resolve(new Response(JSON.stringify({ code: "42703", message: "column does not exist" }), { status: 400, headers: { "Content-Type": "application/json" } }));
        }
        return Promise.resolve(new Response(JSON.stringify(empty ? [] : rows[table]), { status: 200, headers: { "Content-Type": "application/json" } }));
      },
    },
  });
  return { sb, requests };
}

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("expense detail reads the real item and attachment columns", async () => {
  const { sb, requests } = fixture();
  const result = await readExpenseDetail(sb, ID);
  equal(result, { expense: rows.expenses[0], items: rows.expense_items, history: rows.expense_approval_log, attachments: rows.expense_attachments });
  equal(requests.find((url) => url.pathname.endsWith("expense_items"))?.searchParams.get("order"), "created_at.asc");
  equal(requests.find((url) => url.pathname.endsWith("expense_attachments"))?.searchParams.get("select"), "id,file_name,file_size,mime_type,created_at");
});

Deno.test("expense detail keeps every query scoped to the supplied expense ID", async () => {
  const { sb, requests } = fixture();
  await readExpenseDetail(sb, ID);
  equal(requests.length, 4);
  for (const url of requests) {
    const key = url.pathname.endsWith("/expenses") ? "id" : "expense_id";
    equal(url.searchParams.get(key), `eq.${ID}`);
  }
});

Deno.test("successful empty detail is distinct from a failed lookup", async () => {
  const { sb } = fixture(undefined, true);
  equal(await readExpenseDetail(sb, ID), { expense: null, items: [], history: [], attachments: [] });
});

for (const [table, source] of Object.entries({ expenses: "pedido", expense_items: "itens", expense_approval_log: "histórico de aprovação", expense_attachments: "anexos" })) {
  Deno.test(`expense detail propagates ${table} failures instead of returning incomplete information`, async () => {
    const { sb } = fixture(table);
    let message: string | undefined;
    try {
      await readExpenseDetail(sb, ID);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    equal(message, `Falha ao consultar ${source} do pedido (42703).`);
  });
}