import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sapAction, sapQuery, type SapSession } from "@/lib/sap-client";

export interface Supplier {
  id: string;
  company_db: string | null;
  card_code: string | null;
  card_name: string;
  card_type: string;
  federal_tax_id: string | null;
  u_fgr_taxid0: string | null;
  email: string | null;
  phone1: string | null;
  phone2: string | null;
  currency: string;
  bill_to_street: string | null;
  bill_to_zip: string | null;
  bill_to_city: string | null;
  bill_to_state: string | null;
  bill_to_country: string | null;
  bill_to_block: string | null;
  bill_to_building: string | null;
  is_active: boolean;
  sap_sync_status: string;
  sap_sync_error: string | null;
  sap_last_synced_at: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export type SupplierInput = Omit<
  Supplier,
  "id" | "created_at" | "updated_at" | "sap_sync_status" | "sap_sync_error" | "sap_last_synced_at"
>;

const TABLE = "suppliers" as const;

export function useSuppliers(companyDb?: string) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!companyDb) return;
    setIsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from(TABLE)
        .select("*")
        .eq("company_db", companyDb)
        .order("card_name", { ascending: true });
      if (error) throw error;
      setSuppliers((data || []) as Supplier[]);
    } finally {
      setIsLoading(false);
    }
  }, [companyDb]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  return { suppliers, isLoading, refresh: fetchAll };
}

/**
 * Returns the next CardCode based on the highest existing one in SAP.
 * Convention: numeric suffix incremented by 1, prefix preserved (e.g. F001234 -> F001235).
 * Falls back to F + zero-padded 6-digit if nothing found.
 */
export async function getNextCardCode(session: SapSession): Promise<string> {
  const { data } = await sapQuery(
    session,
    "BusinessPartners",
    {
      $filter: "CardType eq 'cSupplier'",
      $select: "CardCode",
      $orderby: "CardCode desc",
      $top: 1,
    },
    false,
  );
  const rows = (data as any)?.value || [];
  const last = rows[0]?.CardCode as string | undefined;
  if (!last) return "F000001";

  // Split letters from digits
  const match = last.match(/^([A-Za-z]*)(\d+)$/);
  if (!match) return `${last}1`;
  const prefix = match[1] || "";
  const digits = match[2];
  const next = String(BigInt(digits) + BigInt(1)).padStart(digits.length, "0");
  return `${prefix}${next}`;
}

function buildSapPayload(s: SupplierInput) {
  const payload: Record<string, unknown> = {
    CardCode: s.card_code,
    CardName: s.card_name,
    CardType: s.card_type || "cSupplier",
    Currency: s.currency || "BRL",
    UnifiedFederalTaxID: s.federal_tax_id || undefined,
    U_FGR_TAXID0: s.u_fgr_taxid0 || s.federal_tax_id || undefined,
    EmailAddress: s.email || undefined,
    Phone1: s.phone1 || undefined,
    Phone2: s.phone2 || undefined,
    Frozen: s.is_active ? "tNO" : "tYES",
  };

  // Map cSupplier <-> S short flag (SAP accepts both depending on field)
  if (s.card_type === "S") payload.CardType = "cSupplier";

  // Same address for billing and shipping
  if (s.bill_to_street || s.bill_to_zip || s.bill_to_city) {
    const address = {
      AddressName: "COBRANCA",
      Street: s.bill_to_street || undefined,
      ZipCode: s.bill_to_zip || undefined,
      City: s.bill_to_city || undefined,
      State: s.bill_to_state || undefined,
      Country: s.bill_to_country || "BR",
      Block: s.bill_to_block || undefined,
      Building: s.bill_to_building || undefined,
      AddressType: "bo_BillTo",
    };
    const ship = { ...address, AddressName: "ENTREGA", AddressType: "bo_ShipTo" };
    payload.BPAddresses = [address, ship];
  }
  return payload;
}

export async function createSupplier(
  input: SupplierInput,
  session: SapSession | null,
): Promise<Supplier> {
  let cardCode = input.card_code;
  let sapStatus = "skipped";
  let sapError: string | null = null;
  let syncedAt: string | null = null;

  if (session) {
    try {
      if (!cardCode) cardCode = await getNextCardCode(session);
      const payload = buildSapPayload({ ...input, card_code: cardCode });
      await sapAction(session, "BusinessPartners", "POST", payload);
      sapStatus = "synced";
      syncedAt = new Date().toISOString();
    } catch (e) {
      sapStatus = "error";
      sapError = e instanceof Error ? e.message : "Erro ao criar no SAP";
    }
  }

  const { data, error } = await (supabase as any)
    .from(TABLE)
    .insert({
      ...input,
      card_code: cardCode,
      sap_sync_status: sapStatus,
      sap_sync_error: sapError,
      sap_last_synced_at: syncedAt,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Supplier;
}

export async function updateSupplier(
  id: string,
  input: Partial<SupplierInput>,
  session: SapSession | null,
  cardCode?: string | null,
): Promise<Supplier> {
  let sapStatus: string | undefined;
  let sapError: string | null = null;
  let syncedAt: string | null = null;

  if (session && cardCode) {
    try {
      const payload = buildSapPayload({ ...(input as SupplierInput), card_code: cardCode });
      // Remove CardCode from PATCH payload (immutable)
      delete (payload as any).CardCode;
      await sapAction(session, `BusinessPartners('${cardCode}')`, "PATCH", payload);
      sapStatus = "synced";
      syncedAt = new Date().toISOString();
    } catch (e) {
      sapStatus = "error";
      sapError = e instanceof Error ? e.message : "Erro ao atualizar no SAP";
    }
  }

  const updatePayload: Record<string, unknown> = { ...input };
  if (sapStatus) {
    updatePayload.sap_sync_status = sapStatus;
    updatePayload.sap_sync_error = sapError;
    updatePayload.sap_last_synced_at = syncedAt;
  }

  const { data, error } = await (supabase as any)
    .from(TABLE)
    .update(updatePayload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Supplier;
}

export async function toggleSupplierActive(
  supplier: Supplier,
  session: SapSession | null,
): Promise<Supplier> {
  const newActive = !supplier.is_active;
  let sapStatus = supplier.sap_sync_status;
  let sapError: string | null = null;
  let syncedAt: string | null = supplier.sap_last_synced_at;

  if (session && supplier.card_code) {
    try {
      await sapAction(session, `BusinessPartners('${supplier.card_code}')`, "PATCH", {
        Frozen: newActive ? "tNO" : "tYES",
      });
      sapStatus = "synced";
      syncedAt = new Date().toISOString();
    } catch (e) {
      sapStatus = "error";
      sapError = e instanceof Error ? e.message : "Erro ao alterar status no SAP";
    }
  }

  const { data, error } = await (supabase as any)
    .from(TABLE)
    .update({
      is_active: newActive,
      sap_sync_status: sapStatus,
      sap_sync_error: sapError,
      sap_last_synced_at: syncedAt,
    })
    .eq("id", supplier.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Supplier;
}

export async function findSupplierByTaxId(
  taxId: string,
  companyDb: string,
): Promise<Supplier | null> {
  const cleaned = taxId.replace(/\D/g, "");
  if (!cleaned) return null;
  const { data } = await (supabase as any)
    .from(TABLE)
    .select("*")
    .eq("company_db", companyDb)
    .or(`federal_tax_id.eq.${cleaned},federal_tax_id.eq.${taxId}`)
    .limit(1)
    .maybeSingle();
  return (data as Supplier) || null;
}
