import { describe, expect, it } from "vitest";
import { buildCreateFingerprintPayload } from "../../supabase/functions/_shared/expense-create-fingerprint";

const HASH_NF1 = "a".repeat(64);
const HASH_NF2 = "b".repeat(64);
const base = {
  company_db: "SBO_ANAGAMING",
  supplier_code: "F0001",
  doc_date: "2026-10-19",
  due_date: "2026-10-30",
  items: [{ item_code: "S1", quantity: 1, unit_price: 275, line_total: 275, cost_center: "1.2", project: "P" }],
};

describe("identificação de criação repetida de pedido", () => {
  it("mesmo valor, fornecedor e itens com NFs diferentes geram pedidos distintos", () => {
    const a = buildCreateFingerprintPayload("artur", "SBO_ANAGAMING", { ...base, attachment_hashes: [HASH_NF1] });
    const b = buildCreateFingerprintPayload("artur", "SBO_ANAGAMING", { ...base, attachment_hashes: [HASH_NF2] });
    expect(a).not.toBe(b);
  });

  it("a mesma tentativa repetida (duplo clique) continua reconhecida como igual", () => {
    const a = buildCreateFingerprintPayload("artur", "SBO_ANAGAMING", { ...base, attachment_hashes: [HASH_NF1, HASH_NF2] });
    const b = buildCreateFingerprintPayload("artur", "SBO_ANAGAMING", { ...base, attachment_hashes: [HASH_NF2, HASH_NF1] });
    expect(a).toBe(b);
  });

  it("boletos diferentes distinguem pedidos sem hash de anexo", () => {
    const a = buildCreateFingerprintPayload("artur", "X", { ...base, payment_boleto_digitable_line: "34191.09008 1" });
    const b = buildCreateFingerprintPayload("artur", "X", { ...base, payment_boleto_digitable_line: "34191.09008 2" });
    expect(a).not.toBe(b);
  });
});
