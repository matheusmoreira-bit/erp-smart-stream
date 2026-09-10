/**
 * Cores institucionais do segmento de origem dos selos de documento.
 * SAP = azul SAP, Omie = azul claro Omie, Flow = verde.
 */
export function originSegmentClasses(originText: string | null, fallback: string): string {
  if (!originText) return fallback;
  const key = originText.trim().toUpperCase();
  if (key === "FLOW") return "bg-success text-success-foreground border-success/30";
  if (key.includes("OMIE")) return "bg-erp-omie text-erp-omie-foreground border-erp-omie/40";
  if (key.includes("SAP") || key.includes("HANA") || key.includes("B1")) {
    return "bg-erp-sap text-erp-sap-foreground border-erp-sap/40";
  }
  return fallback;
}
