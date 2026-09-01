import { describe, expect, it } from "vitest";
import {
  shapeScopedExpense,
  type ExpenseTrackingExpense,
} from "../../supabase/functions/_shared/expense-tracking";

const expense: ExpenseTrackingExpense = {
  id: "b89dd7e0-ce39-40bd-a892-518eedf337c5",
  company_db: "SBO_TEST",
  supplier_code: "F0001",
  supplier_name: "Fornecedor Teste",
  sap_doc_entry: 90,
  sap_doc_num: 123,
  doc_date: "2026-08-20",
  created_at: "2026-08-21T10:00:00.000Z",
  due_date: "2026-09-20",
  total_amount: 300,
  currency: "BRL",
  cost_center: null,
  project: null,
  remarks: "Observação do pedido",
  current_approver: null,
  current_level_order: 0,
  status: "approved",
};

describe("shapeScopedExpense", () => {
  it("soma e expõe apenas as linhas dos projetos autorizados", () => {
    const result = shapeScopedExpense(expense, [
      { expense_id: expense.id, line_total: 100, description: "Serviço A", cost_center: "CC-1", project: "PROJETO-A" },
      { expense_id: expense.id, line_total: 50.25, description: "Serviço A", cost_center: "CC-2", project: "projeto-a" },
      { expense_id: expense.id, line_total: 149.75, description: "Serviço secreto", cost_center: "CC-SECRETO", project: "PROJETO-B" },
    ], ["Projeto-A"], "12345678000199");

    expect(result).toMatchObject({
      totalAmount: 150.25,
      costCenters: ["CC-1", "CC-2"],
      projects: ["PROJETO-A"],
      description: "Serviço A",
      observation: "Observação do pedido",
      supplierTaxId: "12345678000199",
      sapDocumentId: 123,
    });
    expect(result?.costCenters).not.toContain("CC-SECRETO");
  });

  it("não retorna o pedido quando nenhuma linha pertence ao escopo", () => {
    const result = shapeScopedExpense(expense, [
      { expense_id: expense.id, line_total: 300, description: "Serviço B", cost_center: "CC-2", project: "PROJETO-B" },
    ], ["PROJETO-A"]);

    expect(result).toBeNull();
  });

  it("usa projeto e valor do cabeçalho para despesas legadas sem itens", () => {
    const result = shapeScopedExpense({
      ...expense,
      project: "PROJETO-A",
      cost_center: "CC-LEGADO",
    }, [], ["PROJETO-A"]);

    expect(result).toMatchObject({
      totalAmount: 300,
      costCenters: ["CC-LEGADO"],
      projects: ["PROJETO-A"],
    });
  });

  it("usa o projeto do cabeçalho quando a linha não possui projeto próprio", () => {
    const result = shapeScopedExpense({ ...expense, project: "PROJETO-A" }, [
      { expense_id: expense.id, line_total: 80, description: "Serviço legado", cost_center: "CC-1", project: null },
    ], ["PROJETO-A"]);

    expect(result?.totalAmount).toBe(80);
    expect(result?.projects).toEqual(["PROJETO-A"]);
  });

  it("expõe somente os aprovadores pendentes dos projetos autorizados", () => {
    const pendingExpense = {
      ...expense,
      status: "pendente_aprovacao",
      current_approver: "Aprovadores em paralelo",
      current_level_order: 2,
    };
    const result = shapeScopedExpense(pendingExpense, [
      { expense_id: expense.id, line_total: 100, description: "Linha A", cost_center: "CC-A", project: "PROJETO-A" },
      { expense_id: expense.id, line_total: 200, description: "Linha B", cost_center: "CC-B", project: "PROJETO-B" },
    ], ["PROJETO-A"], null, [
      {
        expense_id: expense.id,
        cost_center: "CC-A",
        project: "PROJETO-A",
        current_approver: "Ana Aprovadora",
        current_approver_email: "ana@example.com",
        current_level: 2,
        status: "pendente",
      },
      {
        expense_id: expense.id,
        cost_center: "CC-B",
        project: "PROJETO-B",
        current_approver: "Bruno Restrito",
        current_approver_email: "bruno@example.com",
        current_level: 1,
        status: "pendente",
      },
    ]);

    expect(result).toMatchObject({
      status: "pendente_aprovacao",
      totalAmount: 100,
      pendingApprovers: [{
        name: "Ana Aprovadora",
        email: "ana@example.com",
        level: 2,
        costCenter: "CC-A",
        project: "PROJETO-A",
      }],
    });
    expect(result?.pendingApprovers).not.toContainEqual(expect.objectContaining({ name: "Bruno Restrito" }));
  });

  it("não expõe aprovador pendente para uma despesa já aprovada", () => {
    const result = shapeScopedExpense({
      ...expense,
      project: "PROJETO-A",
      current_approver: "Dado antigo",
    }, [], ["PROJETO-A"]);

    expect(result?.pendingApprovers).toEqual([]);
  });

  it("informa o aprovador do cabeçalho em uma aprovação sem rateio", () => {
    const result = shapeScopedExpense({
      ...expense,
      project: "PROJETO-A",
      cost_center: "CC-A",
      status: "pendente_aprovacao",
      current_approver: "Carla Gestora",
      current_level_order: 1,
    }, [], ["PROJETO-A"]);

    expect(result?.pendingApprovers).toEqual([{
      name: "Carla Gestora",
      email: null,
      level: 1,
      costCenter: "CC-A",
      project: "PROJETO-A",
    }]);
  });
});
