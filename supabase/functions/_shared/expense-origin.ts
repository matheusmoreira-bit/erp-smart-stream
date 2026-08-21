const NATIVE_ERP_ORIGINS = new Set(["sap", "erp", "sap_erp"]);

/** True only when the document already existed in the external ERP. */
export function isNativeErpExpenseOrigin(origin: unknown): boolean {
  return NATIVE_ERP_ORIGINS.has(String(origin ?? "").trim().toLowerCase());
}
