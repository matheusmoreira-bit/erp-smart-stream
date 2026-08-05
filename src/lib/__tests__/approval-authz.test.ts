import { describe, it, expect } from "vitest";
import {
  isDesignatedApprover,
  resolveDesignatedApprovers,
  canCallerApproveInternal,
  type InternalExpense,
} from "@/lib/approval-authz";

const baseExpense = (over: Partial<InternalExpense> = {}): InternalExpense => ({
  id: "doc-1",
  status: "pendente_aprovacao",
  current_level_order: 1,
  current_approver: null,
  original_approver: null,
  requester_email: "solicitante@empresa.com.br",
  requester_name: "Solicitante Teste",
  rule_levels: [
    { level_order: 1, approver_name: "João Mourão", approver_email: "joao.mourao@empresa.com.br" },
    { level_order: 2, approver_name: "Felipe Coelho", approver_email: "felipe.coelho@empresa.com.br" },
  ],
  ...over,
});

describe("isDesignatedApprover — acentos e caracteres especiais", () => {
  it("casa e-mail exato e com caixa/acento diferentes", () => {
    expect(isDesignatedApprover("JOAO.MOURAO@empresa.com.br", "João Mourão", "joao.mourao@empresa.com.br")).toBe(true);
    expect(isDesignatedApprover("joão.mourão@empresa.com.br", null, "joao.mourao@empresa.com.br")).toBe(true);
  });

  it("casa UserCode do SAP (sem domínio) com o e-mail do aprovador", () => {
    expect(isDesignatedApprover("joao.mourao", "João Mourão", "joao.mourao@empresa.com.br")).toBe(true);
  });

  it("casa por nome acentuado quando não há e-mail cadastrado", () => {
    expect(isDesignatedApprover("Joao Mourao", "João Mourão", null)).toBe(true);
    expect(isDesignatedApprover("joão mourão", "Joao Mourao", null)).toBe(true);
  });

  it("não casa pessoas diferentes com sobrenome em comum", () => {
    expect(isDesignatedApprover("maria.mourao@empresa.com.br", "João Mourão", "joao.mourao@empresa.com.br")).toBe(false);
  });

  it("caller vazio nunca é aprovador", () => {
    expect(isDesignatedApprover("", "João Mourão", "joao.mourao@empresa.com.br")).toBe(false);
  });
});

describe("resolveDesignatedApprovers — níveis paralelos e delegação", () => {
  it("retorna todos os aprovadores do nível atual (paralelos)", () => {
    const exp = baseExpense({
      rule_levels: [
        { level_order: 1, approver_name: "João Mourão", approver_email: "joao.mourao@e.com" },
        { level_order: 1, approver_name: "Ana Gonçalves", approver_email: "ana.goncalves@e.com" },
        { level_order: 2, approver_name: "Felipe Coelho", approver_email: "felipe@e.com" },
      ],
    });
    expect(resolveDesignatedApprovers(exp)).toHaveLength(2);
    expect(canCallerApproveInternal("ANA.GONCALVES@e.com", exp)).toBe(true);
    expect(canCallerApproveInternal("joão.mourão@e.com", exp)).toBe(true);
    expect(canCallerApproveInternal("felipe@e.com", exp)).toBe(false);
  });

  it("delegação em current_approver substitui a regra (e o titular perde a vez)", () => {
    const exp = baseExpense({ current_approver: "ketlhenn.monteiro@empresa.com.br" });
    expect(resolveDesignatedApprovers(exp)).toEqual([
      { name: null, email: "ketlhenn.monteiro@empresa.com.br" },
    ]);
    expect(canCallerApproveInternal("ketlhenn.monteiro", exp)).toBe(true);
    expect(canCallerApproveInternal("joao.mourao@empresa.com.br", exp)).toBe(false);
  });

  it("delegação por nome acentuado também é aceita", () => {
    const exp = baseExpense({ current_approver: "Ketlhenn Monteiro Gonçalves" });
    expect(canCallerApproveInternal("ketlhenn monteiro goncalves", exp)).toBe(true);
  });

  it("documento não some: sem regra no nível, ninguém aprova indevidamente", () => {
    const exp = baseExpense({ current_level_order: 9 });
    expect(resolveDesignatedApprovers(exp)).toEqual([{ name: null, email: null }]);
    expect(canCallerApproveInternal("joao.mourao@empresa.com.br", exp)).toBe(false);
  });

  it("documento já decidido não aceita nova aprovação", () => {
    const exp = baseExpense({ status: "aprovado" });
    expect(canCallerApproveInternal("joao.mourao@empresa.com.br", exp)).toBe(false);
  });
});
