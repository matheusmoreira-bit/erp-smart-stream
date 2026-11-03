import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("drizzle/migrations/0074_attachment_backup_admin_read.sql", "utf8");

describe("contrato da política de leitura aprovada", () => {
  it("cria exatamente uma política somente SELECT para authenticated", () => {
    expect(sql.match(/CREATE POLICY/g)).toHaveLength(1);
    expect(sql).toMatch(/FOR SELECT\s+TO authenticated/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALL|ALTER|DROP|GRANT)\b/i);
  });
  it("restringe a política aos dois buckets explicitamente autorizados", () => {
    expect(sql).toMatch(/bucket_id IN \('expense-attachments', 'nfse-xmls'\)/);
    expect(sql).not.toMatch(/sap-archive|nfse-pdfs|nf-entrada-files|registration-attachments/);
  });
  it("usa o verificador de admin da própria sessão que exige MFA no banco", () => {
    expect(sql).toContain("AND public.has_role(auth.uid(), 'admin'::public.app_role)");
    expect(sql).not.toMatch(/USING\s*\(\s*true\s*\)/i);
  });
});