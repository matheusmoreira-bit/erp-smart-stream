import type { ErpType } from "@/contexts/SapContext";

/**
 * Short, user-friendly label for each ERP type. Used to label the origin
 * of documents that come from an external ERP (as opposed to ERP Flow itself).
 */
const ERP_SHORT_LABELS: Record<string, string> = {
  sap: "SAP B1",
  omie: "Omie",
  s4hana_cloud: "S/4HANA Cloud",
  s4hana_cloud_private: "S/4HANA Private",
  s4hana_onprem: "S/4HANA",
  totvs_protheus: "Protheus",
  totvs_rm: "TOTVS RM",
  totvs_datasul: "Datasul",
  netsuite: "NetSuite",
};

export function getErpShortLabel(erpType?: ErpType | string | null): string {
  if (!erpType) return "ERP";
  return ERP_SHORT_LABELS[erpType] || "ERP";
}
