// Registro central de adapters de ERP para o cruzamento fiscal.
// Novo ERP = novo arquivo + nova entrada aqui. Nenhum outro lugar precisa mudar.

import { OmieAdapter } from "./omie.ts";
import { SapB1Adapter } from "./sap_b1.ts";
import type { ErpAdapter } from "./types.ts";

export const ERP_ADAPTERS: Record<string, ErpAdapter> = {
  omie: OmieAdapter,
  sap_b1: SapB1Adapter,
  sap: SapB1Adapter, // alias — companies.erp_type usa 'sap' hoje
};

export function getAdapter(erpType: string | null | undefined): ErpAdapter | null {
  if (!erpType) return null;
  return ERP_ADAPTERS[erpType.toLowerCase()] ?? null;
}

export type { ErpAdapter } from "./types.ts";
export type { ContaPagaERP, AdapterContext } from "./types.ts";
