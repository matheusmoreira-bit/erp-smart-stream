import { useCallback, useMemo, useState } from "react";
import { sapAction, sapQuery, type SapSession } from "@/lib/sap-client";
import { useSapCachedList } from "@/hooks/useSapCachedList";

export interface SapItem {
  id: string;
  item_code: string;
  item_name: string;
  items_group_code: number | null;
  is_active: boolean; // Valid='tYES' AND Frozen='tNO'
  valid: boolean;
  frozen: boolean;
  sap_sync_status: "synced" | "error" | "pending";
  sap_sync_error: string | null;
}

export interface ItemInput {
  item_code: string;
  item_name: string;
  items_group_code: number | null;
  is_active: boolean;
}

export function useItems(companyDb?: string) {
  const cacheKey = companyDb ? `items_all:${companyDb}` : "items_all:none";
  const { options, isLoading, reload } = useSapCachedList({
    cacheKey,
    endpoint: "Items",
    params: {
      $select: "ItemCode,ItemName,ItemsGroupCode,Valid,Frozen",
      $orderby: "ItemName",
    },
    mapRow: (row: any) =>
      ({
        code: row.ItemCode,
        name: row.ItemName,
        extra: String(row.ItemsGroupCode ?? ""),
        _raw: row,
      } as any),
    enabled: !!companyDb,
  });

  // Per-row error overlay from last action so UI can show error badges
  const [overlay, setOverlay] = useState<Record<string, { status: SapItem["sap_sync_status"]; error: string | null }>>({});

  const items = useMemo<SapItem[]>(() => {
    return options.map((opt: any) => {
      const raw = opt._raw || {};
      const valid = raw.Valid === "tYES";
      const frozen = raw.Frozen === "tYES";
      const o = overlay[opt.code];
      return {
        id: `sap:${opt.code}`,
        item_code: opt.code,
        item_name: raw.ItemName || opt.name || opt.code,
        items_group_code: typeof raw.ItemsGroupCode === "number" ? raw.ItemsGroupCode : null,
        valid,
        frozen,
        is_active: valid && !frozen,
        sap_sync_status: o?.status || "synced",
        sap_sync_error: o?.error || null,
      };
    });
  }, [options, overlay]);

  const refresh = useCallback(() => reload(), [reload]);

  const setRowOverlay = useCallback(
    (code: string, status: SapItem["sap_sync_status"], error: string | null) =>
      setOverlay((prev) => ({ ...prev, [code]: { status, error } })),
    [],
  );

  return { items, isLoading, refresh, setRowOverlay };
}

export async function fetchItemFromSap(itemCode: string, session: SapSession): Promise<SapItem | null> {
  try {
    const { data } = await sapQuery(
      session,
      `Items('${itemCode}')`,
      { $select: "ItemCode,ItemName,ItemsGroupCode,Valid,Frozen" },
      false,
    );
    const raw = data as any;
    if (!raw) return null;
    const valid = raw.Valid === "tYES";
    const frozen = raw.Frozen === "tYES";
    return {
      id: `sap:${raw.ItemCode}`,
      item_code: raw.ItemCode,
      item_name: raw.ItemName,
      items_group_code: typeof raw.ItemsGroupCode === "number" ? raw.ItemsGroupCode : null,
      valid,
      frozen,
      is_active: valid && !frozen,
      sap_sync_status: "synced",
      sap_sync_error: null,
    };
  } catch {
    return null;
  }
}

export async function createItem(input: ItemInput, session: SapSession): Promise<void> {
  const payload: Record<string, unknown> = {
    ItemCode: input.item_code,
    ItemName: input.item_name,
    Valid: input.is_active ? "tYES" : "tNO",
    Frozen: input.is_active ? "tNO" : "tYES",
  };
  if (input.items_group_code != null) payload.ItemsGroupCode = input.items_group_code;
  await sapAction(session, "Items", "POST", payload);
}

export async function updateItem(itemCode: string, input: Partial<ItemInput>, session: SapSession): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (input.item_name !== undefined) payload.ItemName = input.item_name;
  if (input.items_group_code !== undefined && input.items_group_code !== null) payload.ItemsGroupCode = input.items_group_code;
  if (input.is_active !== undefined) {
    payload.Valid = input.is_active ? "tYES" : "tNO";
    payload.Frozen = input.is_active ? "tNO" : "tYES";
  }
  await sapAction(session, `Items('${itemCode}')`, "PATCH", payload);
}

export async function toggleItemActive(item: SapItem, session: SapSession): Promise<void> {
  const newActive = !item.is_active;
  await sapAction(session, `Items('${item.item_code}')`, "PATCH", {
    Valid: newActive ? "tYES" : "tNO",
    Frozen: newActive ? "tNO" : "tYES",
  });
}
