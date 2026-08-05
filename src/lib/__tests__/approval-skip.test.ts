import { describe, it, expect } from "vitest";
import {
  requesterMatchesApprover,
  pickApproverSkippingRequester,
  type ApprovalLevel,
} from "../../../supabase/functions/_shared/approval-skip.ts";

const levels: ApprovalLevel[] = [
  { level_order: 1, approver_name: "João Mourão", approver_email: "joao.mourao@e.com" },
  { level_order: 2, approver_name: "Ana Gonçalves", approver_email: "ana.goncalves@e.com" },
  { level_order: 3, approver_name: "Felipe Coelho", approver_email: "felipe.coelho@e.com" },
];

describe("requesterMatchesApprover — acentos e sufixos", () => {
  it("identifica a mesma pessoa apesar de acento/caixa", () => {
    expect(requesterMatchesApprover("João Mourão", "JOAO.MOURAO@E.COM", "Joao Mourao", "joao.mourao@e.com")).toBe(true);
  });
  it("casa UserCode do SAP contra e-mail do aprovador", () => {
    expect(requesterMatchesApprover(null, "joao.mourao", "João Mourão", "joao.mourao@e.com")).toBe(true);
  });
  it("não confunde homônimos parciais", () => {
    expect(requesterMatchesApprover("Maria Mourão", "maria.mourao@e.com", "João Mourão", "joao.mourao@e.com")).toBe(false);
  });
});

describe("pickApproverSkippingRequester — delegação/auto-aprovação", () => {
  it("pula o nível quando o solicitante é o próprio aprovador (com acento)", () => {
    const r = pickApproverSkippingRequester(levels, "João Mourão", "joao.mourao@e.com");
    expect(r.level_order).toBe(2);
    expect(r.approver_email).toBe("ana.goncalves@e.com");
    expect(r.fallback_used).toBe(false);
  });

  it("mantém o nível 1 para outro solicitante", () => {
    const r = pickApproverSkippingRequester(levels, "Solicitante Teste", "solicitante@e.com");
    expect(r.level_order).toBe(1);
    expect(r.approver_email).toBe("joao.mourao@e.com");
  });

  it("respeita startFrom (reprocessamento a partir de um nível)", () => {
    const r = pickApproverSkippingRequester(levels, "Outro", "outro@e.com", 3);
    expect(r.level_order).toBe(3);
    expect(r.approver_email).toBe("felipe.coelho@e.com");
  });

  it("com aprovadores paralelos, usa o par que não é o solicitante", () => {
    const parallel: ApprovalLevel[] = [
      { level_order: 1, approver_name: "João Mourão", approver_email: "joao.mourao@e.com" },
      { level_order: 1, approver_name: "Ana Gonçalves", approver_email: "ana.goncalves@e.com" },
    ];
    const r = pickApproverSkippingRequester(parallel, "João Mourão", "joao.mourao@e.com");
    expect(r.level_order).toBe(1);
    expect(r.approver_email).toBe("ana.goncalves@e.com");
    expect(r.fallback_used).toBe(false);
  });

  it("cai no validador global quando todos os níveis são o solicitante (doc não some)", () => {
    const own: ApprovalLevel[] = [
      { level_order: 1, approver_name: "João Mourão", approver_email: "joao.mourao@e.com" },
      { level_order: 2, approver_name: "Joao Mourao", approver_email: "joao.mourao@e.com" },
    ];
    const r = pickApproverSkippingRequester(own, "João Mourão", "joao.mourao@e.com");
    expect(r.fallback_used).toBe(true);
    expect(r.approver_email).toContain("juliana.gavineli");
    expect(r.approver_name).toBeTruthy();
  });

  it("matriz vazia ainda devolve um aprovador de contingência", () => {
    const r = pickApproverSkippingRequester([], "Alguém", "alguem@e.com");
    expect(r.fallback_used).toBe(true);
    expect(r.approver_email).toContain("juliana.gavineli");
  });
});
