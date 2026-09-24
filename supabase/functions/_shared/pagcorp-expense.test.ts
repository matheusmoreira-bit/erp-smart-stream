import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isPagCorpExpense } from "./pagcorp-expense.ts";

Deno.test("F04: despesa manual com 'PagCorp' na observação NÃO é cartão", () => {
  assertEquals(isPagCorpExpense("manual"), false);
  // @ts-expect-error — parâmetro de observação não existe mais
  assertEquals(isPagCorpExpense("manual", "Pagamento PagCorp"), false);
  assertEquals(isPagCorpExpense(undefined), false);
  assertEquals(isPagCorpExpense(""), false);
});

Deno.test("F04: somente origin=pagcorp (definido pelo servidor) é cartão", () => {
  assertEquals(isPagCorpExpense("pagcorp"), true);
  assertEquals(isPagCorpExpense(" PagCorp "), true);
});
