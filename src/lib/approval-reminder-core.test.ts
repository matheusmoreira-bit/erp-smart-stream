import { describe, expect, it } from "vitest";
import { buildRecipients, dedupeAcrossSources, isBusinessDaySaoPaulo, type Person, type ReminderDoc } from "../../supabase/functions/approval-daily-digest/reminder-core";

const doc = (o: Partial<ReminderDoc>): ReminderDoc => ({
  key: "k", source: "flow", company_db: "SBO_CACTUS", company_name: "Cactus", supplier: "X", amount: 1, currency: "BRL",
  days_open: 1, label: "L", link: "l", cost_centers: [], approver_keys: ["fernanda.faria@anagaming.com.br"], ...o,
});
const people: Record<string, Person> = {
  "fernanda.faria@anagaming.com.br": { key: "fernanda.faria@anagaming.com.br", email: "fernanda.faria@anagaming.com.br", name: "Fernanda Faria", codes: ["fernanda.faria@anagaming.com.br", "fernanda.faria"] },
  "marco.ferreira@cactusgaming.net": { key: "marco.ferreira@cactusgaming.net", email: "marco.ferreira@cactusgaming.net", name: "Marco Ferreira", codes: ["marco.ferreira@cactusgaming.net"] },
};
const resolve = (k: string) => people[k] || null;
const sub = { company_db: null, official_email: "fernanda.faria@anagaming.com.br", official_name: "Fernanda Faria", substitute_email: "marco.ferreira@cactusgaming.net", substitute_name: "Marco Ferreira", cost_center_prefixes: null };

describe("lembrete diário de aprovações", () => {
  it("não envia sábado nem domingo (horário de São Paulo)", () => {
    expect(isBusinessDaySaoPaulo(new Date("2026-10-31T11:00:00Z"))).toBe(false); // sábado
    expect(isBusinessDaySaoPaulo(new Date("2026-11-01T11:00:00Z"))).toBe(false); // domingo
    expect(isBusinessDaySaoPaulo(new Date("2026-11-02T11:00:00Z"))).toBe(true); // segunda
  });
  it("substituição ativa manda ao substituto em nome do titular e titular não recebe", () => {
    const { recipients, redirected } = buildRecipients([doc({})], resolve, [sub]);
    expect(recipients.map((r) => r.person.name)).toEqual(["Marco Ferreira"]);
    expect(recipients[0].docs[0].on_behalf_of).toBe("Fernanda Faria");
    expect(redirected).toBe(1);
  });
  it("substituição de outra empresa ou outro centro de custo não redireciona", () => {
    const a = buildRecipients([doc({})], resolve, [{ ...sub, company_db: "SBO_ANAGAMING" }]);
    const b = buildRecipients([doc({ cost_centers: ["1.2.4"] })], resolve, [{ ...sub, cost_center_prefixes: ["1.80"] }]);
    expect(a.recipients[0].person.name).toBe("Fernanda Faria");
    expect(b.recipients[0].person.name).toBe("Fernanda Faria");
  });
  it("mesmo esboço no Flow e no SAP conta uma vez só", () => {
    const out = dedupeAcrossSources([doc({ key: "flow::1", sap_draft_entry: 8682 })], [doc({ key: "sap::X::9", source: "sap", sap_draft_entry: 8682 })]);
    expect(out).toHaveLength(1);
  });
});
