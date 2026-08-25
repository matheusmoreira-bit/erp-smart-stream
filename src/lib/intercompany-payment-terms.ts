export interface PaymentTermCompanyResult {
  company_db: string;
  display_name: string;
  ok: boolean;
  data?: Array<{
    GroupNumber: number;
    PaymentTermsGroupName: string;
  }>;
}

export interface ConsolidatedPaymentTermRow {
  code: string;
  names: Set<string>;
  presence: Map<string, { name: string; active: boolean; sourceCode?: string }>;
}

export function consolidatePaymentTerms(results: PaymentTermCompanyResult[]): {
  rows: ConsolidatedPaymentTermRow[];
  companies: { db: string; name: string }[];
} {
  const companies = results
    .filter((result) => result.ok && result.data)
    .map((result) => ({ db: result.company_db, name: result.display_name }));
  const map = new Map<string, ConsolidatedPaymentTermRow>();

  for (const result of results) {
    if (!result.ok || !result.data) continue;
    for (const paymentTerm of result.data) {
      const name = String(paymentTerm.PaymentTermsGroupName || "").trim();
      const groupNumber = Number(paymentTerm.GroupNumber);
      if (!name || !Number.isInteger(groupNumber)) continue;

      const identity = name.toLocaleLowerCase("pt-BR");
      let row = map.get(identity);
      if (!row) {
        row = { code: name, names: new Set(), presence: new Map() };
        map.set(identity, row);
      }
      row.names.add(name);
      row.presence.set(result.company_db, {
        name,
        active: true,
        sourceCode: String(groupNumber),
      });
    }
  }

  const rows = Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code, "pt-BR"));
  return { rows, companies };
}
