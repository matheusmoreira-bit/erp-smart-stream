import { describe, expect, it } from "vitest";
import { buildRecipients, dedupeAcrossSources, isBusinessDaySaoPaulo, type Person, type ReminderDoc, type Substitution } from "../../supabase/functions/approval-daily-digest/reminder-core";

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
  const leonardo: Person = { key: "leonardo.rossini", email: null, name: "Leonardo Rossini", codes: ["leonardo.rossini"] };
  const santiago: Person = { key: "santiago.macedo", email: null, name: "Santiago Macedo", codes: ["santiago.macedo"] };
  const mutualResolve = (k: string) => [leonardo, santiago].find((p) => p.codes.includes(k)) || null;
  const forward: Substitution = { company_db: null, official_email: leonardo.key, official_name: leonardo.name, substitute_email: santiago.key, substitute_name: santiago.name, cost_center_prefixes: null };
  const reverse: Substitution = { ...forward, official_email: santiago.key, official_name: santiago.name, substitute_email: leonardo.key, substitute_name: leonardo.name };
  const mutualDocs = [doc({ key: "L", approver_keys: [leonardo.key] }), doc({ key: "S", source: "sap", approver_keys: [santiago.key] })];

  it("Leonardo e Santiago recíprocos recebem uma própria e uma em nome do outro", () => {
    const { recipients } = buildRecipients(mutualDocs, mutualResolve, [forward, reverse]);
    expect(recipients).toHaveLength(2);
    for (const person of [leonardo, santiago]) {
      const received = recipients.find((r) => r.person.key === person.key)?.docs || [];
      expect(received.filter((d) => d.on_behalf_of === null)).toHaveLength(1);
      expect(received.filter((d) => d.on_behalf_of === (person === leonardo ? santiago.name : leonardo.name))).toHaveLength(1);
    }
  });
  it("substituto aprovador presente preserva o titular mesmo sem reciprocidade", () => {
    const { recipients } = buildRecipients(mutualDocs, mutualResolve, [forward]);
    expect(recipients.find((r) => r.person.key === leonardo.key)?.docs.map((d) => d.key)).toEqual(["L"]);
    expect(recipients.find((r) => r.person.key === santiago.key)?.docs).toHaveLength(2);
  });
  it("férias Fernanda→Marco e Tagiane→Juliana continuam redirecionando mesmo com pendências próprias do substituto", () => {
    for (const [official, substitute] of [["Fernanda Faria", "Marco Ferreira"], ["Tagiane Gomide", "Juliana Gavineli"]]) {
      const a: Person = { key: official, email: null, name: official, codes: [official.toLowerCase()] };
      const b: Person = { key: substitute, email: null, name: substitute, codes: [substitute.toLowerCase()] };
      const resolver = (k: string) => [a, b].find((p) => p.codes.includes(k)) || null;
      const { recipients } = buildRecipients([
        doc({ key: "official", approver_keys: a.codes }), doc({ key: "substitute", approver_keys: b.codes }),
      ], resolver, [{ ...sub, official_email: a.codes[0], official_name: a.name, substitute_email: b.codes[0], substitute_name: b.name, reason: "Férias" }]);
      expect(recipients.map((r) => r.person.name)).toEqual([substitute]);
      expect(recipients[0].docs.filter((d) => d.on_behalf_of === official)).toHaveLength(1);
      expect(recipients[0].docs.filter((d) => d.on_behalf_of === null)).toHaveLength(1);
    }
  });
  it("deduplica o documento próprio e substituído, com própria prevalecendo em qualquer ordem", () => {
    for (const keys of [[leonardo.key, santiago.key], [santiago.key, leonardo.key]]) {
      const { recipients } = buildRecipients([doc({ approver_keys: keys })], mutualResolve, [forward, reverse]);
      expect(recipients).toHaveLength(2);
      for (const r of recipients) {
        expect(r.docs).toHaveLength(1);
        expect(r.docs[0].on_behalf_of).toBeNull();
      }
    }
  });
  it("reciprocidade não ignora empresa e centro de custo nem confunde substituto ausente com presente", () => {
    const absent = { ...reverse, reason: "Ausência" };
    for (const scopedReverse of [{ ...absent, company_db: "SBO_ANAGAMING" }, { ...absent, cost_center_prefixes: ["1.80"] }]) {
      // Sem pendência própria de Santiago: só a reciprocidade válida preservaria Leonardo.
      const { recipients } = buildRecipients([mutualDocs[0]], mutualResolve, [forward, scopedReverse]);
      expect(recipients.map((r) => r.person.name)).toEqual([santiago.name]);
    }
    const { recipients } = buildRecipients(mutualDocs, mutualResolve, [forward, { ...absent, substitute_email: "outro" }]);
    expect(recipients.some((r) => r.person.key === leonardo.key)).toBe(false);
  });
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
