export type MappingSource = "card_supplier" | "card" | "fallback";

export interface CardMappingRowLike {
  card_identifier: string | null;
  is_fallback: boolean;
  cost_center: string | null;
  project: string | null;
  item_code: string | null;
}

export interface CardSupplierRuleLike {
  card_identifier: string;
  supplier_code: string;
  cost_center: string | null;
  project: string | null;
  item_code: string | null;
  account_code: string | null;
  is_active: boolean;
}

export interface ResolvedMapping {
  costCenter: string | null;
  project: string | null;
  itemCode: string | null;
  accountCode: string | null;
  /** Origem principal (a mais específica que contribuiu). */
  source: MappingSource | null;
  fieldSources: Partial<Record<"costCenter" | "project" | "itemCode" | "accountCode", MappingSource>>;
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

export function cardKeyMatches(ruleKey: string | null, txKeys: string[]): boolean {
  if (!ruleKey) return false;
  const rk = norm(ruleKey);
  const rd = digits(ruleKey);
  return txKeys.some((k) => norm(k) === rk || (rd.length >= 4 && digits(k) === rd));
}

/** Merge campo a campo: Cartão+Fornecedor > Cartão > Fallback. */
export function resolveCardMapping(
  txKeys: string[],
  supplierCode: string | null | undefined,
  rows: CardMappingRowLike[],
  rules: CardSupplierRuleLike[],
): ResolvedMapping {
  const out: ResolvedMapping = { costCenter: null, project: null, itemCode: null, accountCode: null, source: null, fieldSources: {} };
  const layers: Array<{ src: MappingSource; v: Partial<Record<"costCenter" | "project" | "itemCode" | "accountCode", string | null>> }> = [];
  const sup = String(supplierCode ?? "").trim();
  if (sup) {
    const r = rules.find((x) => x.is_active && x.supplier_code.trim() === sup && cardKeyMatches(x.card_identifier, txKeys));
    if (r) layers.push({ src: "card_supplier", v: { costCenter: r.cost_center, project: r.project, itemCode: r.item_code, accountCode: r.account_code } });
  }
  const specific = rows.find((r) => !r.is_fallback && cardKeyMatches(r.card_identifier, txKeys));
  if (specific) layers.push({ src: "card", v: { costCenter: specific.cost_center, project: specific.project, itemCode: specific.item_code } });
  const fb = rows.find((r) => r.is_fallback);
  if (fb) layers.push({ src: "fallback", v: { costCenter: fb.cost_center, project: fb.project, itemCode: fb.item_code } });

  for (const f of ["costCenter", "project", "itemCode", "accountCode"] as const) {
    for (const l of layers) {
      const val = l.v[f];
      if (val) {
        out[f] = val;
        out.fieldSources[f] = l.src;
        if (!out.source) out.source = l.src;
        break;
      }
    }
  }
  return out;
}
