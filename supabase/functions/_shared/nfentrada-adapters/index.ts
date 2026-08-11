// Registro central de adapters de ERP do módulo de NF de Entrada.
// Novo ERP = novo arquivo + nova entrada aqui. Nenhum outro lugar muda.

import { SapB1NfEntradaAdapter } from "./sap_b1.ts";
import type { NfEntradaErpAdapter } from "./types.ts";

export const NF_ENTRADA_ADAPTERS: Record<string, NfEntradaErpAdapter> = {
  sap_b1: SapB1NfEntradaAdapter,
  sap: SapB1NfEntradaAdapter, // alias — companies.erp_type usa 'sap' hoje
};

export function getNfEntradaAdapter(erpType: string | null | undefined): NfEntradaErpAdapter | null {
  if (!erpType) return null;
  return NF_ENTRADA_ADAPTERS[erpType.toLowerCase()] ?? null;
}

/** Descobre o ERP da empresa (company_db) e devolve o adapter correspondente. */
export async function resolveAdapterForCompany(
  supabase: any,
  companyDb: string,
): Promise<{ adapter: NfEntradaErpAdapter; erp_type: string }> {
  const { data } = await supabase
    .from("companies")
    .select("erp_type")
    .eq("company_db", companyDb)
    .maybeSingle();
  const erpType = (data?.erp_type as string | null) || "sap_b1";
  const adapter = getNfEntradaAdapter(erpType);
  if (!adapter) throw new Error(`ERP '${erpType}' não possui adapter de NF de Entrada`);
  return { adapter, erp_type: adapter.erp_type };
}

export * from "./types.ts";
