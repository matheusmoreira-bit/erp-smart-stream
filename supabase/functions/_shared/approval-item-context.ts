export interface ApprovalContextItem {
  item_code?: string | null;
  description?: string | null;
  items_group_name?: string | null;
  cost_center?: string | null;
  project?: string | null;
}

/** Same token format as the client matrix, including legacy code/name aliases. */
export function buildApprovalItemContext(items: ApprovalContextItem[]) {
  const tokens = (key: keyof ApprovalContextItem) => items
    .map((item) => String(item[key] || "").trim().toLowerCase()).filter(Boolean);
  const wrap = (values: string[]) => values.length ? ` ${values.join(" ")} ` : "";
  const codes = tokens("item_code");
  const names = tokens("description");
  return {
    item_codes: wrap([...codes, ...names]),
    item_groups: wrap(tokens("items_group_name")),
    "item.code": wrap(codes),
    "item.name": wrap(names),
    "item.any": wrap([...codes, ...names]),
  };
}