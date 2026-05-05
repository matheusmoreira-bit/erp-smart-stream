import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sapAction, sapQuery, type SapSession } from "@/lib/sap-client";
import { useSapCachedList } from "@/hooks/useSapCachedList";

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

/**
 * Loads supplier list combining SAP cache (source of truth) with local table
 * (which holds is_active toggle, sync status and locally-created records).
 * SAP data is cached in sap_cache for 1 week via useSapCachedList.
 */
export function useSuppliers(companyDb?: string) {
  const [localRows, setLocalRows] = useState<Supplier[]>([]);
  const [isLoadingLocal, setIsLoadingLocal] = useState(false);

  const fetchLocal = useCallback(async () => {
    if (!companyDb) return;
    setIsLoadingLocal(true);
    try {
      const { data, error } = await (supabase as any)
        .from(TABLE)
        .select("*")
        .eq("company_db", companyDb);
      if (error) throw error;
      setLocalRows((data || []) as Supplier[]);
    } finally {
      setIsLoadingLocal(false);
    }
  }, [companyDb]);

  useEffect(() => {
    void fetchLocal();
  }, [fetchLocal]);

  // Pull suppliers from SAP (cached 1 week in sap_cache)
  const cacheKey = companyDb ? `suppliers:${companyDb}` : "suppliers:none";
  const { options: sapOptions, isLoading: isLoadingSap, reload: reloadSap } = useSapCachedList({
    cacheKey,
    endpoint: "BusinessPartners",
    params: {
      $filter: "CardType eq 'cSupplier'",
      $select: "CardCode,CardName,FederalTaxID,UnifiedFederalTaxID,EmailAddress,Phone1,Phone2,Currency,Frozen",
      $orderby: "CardName",
    },
    mapRow: (row: any) =>
      ({
        code: row.CardCode,
        name: row.CardName,
        extra: row.UnifiedFederalTaxID || row.FederalTaxID || "",
        _raw: row,
      } as any),
    enabled: !!companyDb,
  });

  // Merge SAP rows + local table. Local data overrides per CardCode; orphans appended.
  const suppliers = useMemo<Supplier[]>(() => {
    const localByCode = new Map<string, Supplier>();
    const orphans: Supplier[] = [];
    for (const r of localRows) {
      if (r.card_code) localByCode.set(r.card_code, r);
      else orphans.push(r);
    }

    const merged: Supplier[] = sapOptions.map((opt: any) => {
      const raw = opt._raw || {};
      const local = localByCode.get(opt.code);
      localByCode.delete(opt.code);
      const frozen = raw.Frozen === "tYES";
      return {
        id: local?.id || `sap:${opt.code}`,
        company_db: companyDb || null,
        card_code: opt.code,
        card_name: raw.CardName || opt.name || opt.code || "(sem nome)",
        card_type: "S",
        federal_tax_id: local?.federal_tax_id ?? (raw.UnifiedFederalTaxID || raw.FederalTaxID || null),
        u_fgr_taxid0: local?.u_fgr_taxid0 ?? null,
        email: local?.email ?? (raw.EmailAddress || null),
        phone1: local?.phone1 ?? (raw.Phone1 || null),
        phone2: local?.phone2 ?? (raw.Phone2 || null),
        currency: local?.currency ?? (raw.Currency || "BRL"),
        bill_to_street: local?.bill_to_street ?? null,
        bill_to_zip: local?.bill_to_zip ?? null,
        bill_to_city: local?.bill_to_city ?? null,
        bill_to_state: local?.bill_to_state ?? null,
        bill_to_country: local?.bill_to_country ?? "BR",
        bill_to_block: local?.bill_to_block ?? null,
        bill_to_building: local?.bill_to_building ?? null,
        is_active: local ? local.is_active : !frozen,
        sap_sync_status: local?.sap_sync_status || "synced",
        sap_sync_error: local?.sap_sync_error || null,
        sap_last_synced_at: local?.sap_last_synced_at || null,
        source: local?.source || "sap",
        created_at: local?.created_at || new Date(0).toISOString(),
        updated_at: local?.updated_at || new Date(0).toISOString(),
      };
    });

    for (const r of localByCode.values()) merged.push(r);
    for (const r of orphans) merged.push(r);

    merged.sort((a, b) => (a.card_name || "").localeCompare(b.card_name || ""));
    return merged;
  }, [sapOptions, localRows, companyDb]);

  const refresh = useCallback(async () => {
    reloadSap();
    await fetchLocal();
  }, [reloadSap, fetchLocal]);

  return {
    suppliers,
    isLoading: isLoadingLocal || isLoadingSap,
    refresh,
  };
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

// Map ISO currency codes (used in our app/UI) to SAP B1 internal codes (OCRD.Currency).
const CURRENCY_ISO_TO_SAP: Record<string, string> = {
  BRL: "R$",
  USD: "USD",
  EUR: "EUR",
  GBP: "GBP",
  CAD: "CAN",
};

function toSapCurrency(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  return CURRENCY_ISO_TO_SAP[iso.toUpperCase()] || iso;
}

function buildSapPayload(s: SupplierInput) {
  const payload: Record<string, unknown> = {
    CardCode: s.card_code,
    CardName: s.card_name,
    CardType: s.card_type || "cSupplier",
    Currency: toSapCurrency(s.currency),
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
      BuildingFloorRoom: s.bill_to_building || undefined,
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
  let sapStatus = supplier.sap_sync_status || "synced";
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

  // If id starts with "sap:" the row only exists in SAP cache — insert local mirror.
  const isSapOnly = supplier.id.startsWith("sap:");

  if (isSapOnly) {
    const { data, error } = await (supabase as any)
      .from(TABLE)
      .insert({
        company_db: supplier.company_db,
        card_code: supplier.card_code,
        card_name: supplier.card_name,
        card_type: supplier.card_type || "S",
        federal_tax_id: supplier.federal_tax_id,
        u_fgr_taxid0: supplier.u_fgr_taxid0,
        email: supplier.email,
        phone1: supplier.phone1,
        phone2: supplier.phone2,
        currency: supplier.currency || "BRL",
        bill_to_street: supplier.bill_to_street,
        bill_to_zip: supplier.bill_to_zip,
        bill_to_city: supplier.bill_to_city,
        bill_to_state: supplier.bill_to_state,
        bill_to_country: supplier.bill_to_country || "BR",
        bill_to_block: supplier.bill_to_block,
        bill_to_building: supplier.bill_to_building,
        is_active: newActive,
        sap_sync_status: sapStatus,
        sap_sync_error: sapError,
        sap_last_synced_at: syncedAt,
        source: "sap",
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as Supplier;
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

/**
 * Fetches a single supplier from SAP with full details (including addresses).
 * Used to hydrate the edit modal since the list query only fetches summary fields.
 */
export async function fetchSupplierFromSap(
  cardCode: string,
  session: SapSession,
): Promise<Partial<Supplier> | null> {
  try {
    const { data } = await sapQuery(
      session,
      `BusinessPartners('${cardCode}')`,
      {
        $select:
          "CardCode,CardName,CardType,FederalTaxID,UnifiedFederalTaxID,U_FGR_TAXID0,EmailAddress,Phone1,Phone2,Currency,Frozen,BPAddresses",
      },
      false,
    );
    const raw = data as any;
    if (!raw) return null;

    // Pick BillTo address (preferred) or first available
    const addresses: any[] = Array.isArray(raw.BPAddresses) ? raw.BPAddresses : [];
    const billTo =
      addresses.find((a) => a.AddressType === "bo_BillTo") ||
      addresses.find((a) => (a.AddressName || "").toUpperCase().includes("COBRAN")) ||
      addresses[0] ||
      {};

    // Reverse map SAP currency -> ISO
    const sapToIso: Record<string, string> = { "R$": "BRL", CAN: "CAD" };
    const currencyRaw: string = raw.Currency || "";
    const currency = sapToIso[currencyRaw] || currencyRaw || "BRL";

    return {
      card_code: raw.CardCode || cardCode,
      card_name: raw.CardName || "",
      card_type: "S",
      federal_tax_id: raw.UnifiedFederalTaxID || raw.FederalTaxID || null,
      u_fgr_taxid0: raw.U_FGR_TAXID0 || null,
      email: raw.EmailAddress || null,
      phone1: raw.Phone1 || null,
      phone2: raw.Phone2 || null,
      currency,
      bill_to_street: billTo.Street || null,
      bill_to_zip: billTo.ZipCode || null,
      bill_to_city: billTo.City || null,
      bill_to_state: billTo.State || null,
      bill_to_country: billTo.Country || "BR",
      bill_to_block: billTo.Block || null,
      bill_to_building: billTo.Building || null,
    };
  } catch {
    return null;
  }
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
