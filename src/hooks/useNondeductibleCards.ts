import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface NondeductibleCard {
  id: string;
  company_db: string;
  card_identifier: string;
  card_label: string | null;
  card_holder: string | null;
  supplier_code: string;
  supplier_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface NondeductibleCardInput {
  card_identifier: string;
  card_label?: string | null;
  card_holder?: string | null;
  supplier_code: string;
  supplier_name?: string | null;
}

/**
 * Resolve the identifier we store for a PagCorp transaction's card.
 * Prefer the last 4 digits when present (most stable), otherwise the card name.
 */
export function resolveCardIdentifier(t: {
  cardLastDigits?: string | null;
  cardName?: string | null;
}): string | null {
  if (t.cardLastDigits) return String(t.cardLastDigits).trim();
  if (t.cardName) return String(t.cardName).trim();
  return null;
}

export function useNondeductibleCards(companyDb?: string | null) {
  const [items, setItems] = useState<NondeductibleCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!companyDb) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("pagcorp_nondeductible_cards" as any)
        .select("*")
        .eq("company_db", companyDb)
        .order("card_label", { ascending: true });
      if (error) throw error;
      setItems((data || []) as any);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao buscar cartões");
    } finally {
      setLoading(false);
    }
  }, [companyDb]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const upsert = useCallback(
    async (input: NondeductibleCardInput, id?: string) => {
      if (!companyDb) throw new Error("Empresa não selecionada");
      const payload: any = { ...input, company_db: companyDb };
      if (id) {
        const { error } = await supabase
          .from("pagcorp_nondeductible_cards" as any)
          .update(payload)
          .eq("id", id);
        if (error) throw error;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) payload.created_by = user.id;
        const { error } = await supabase
          .from("pagcorp_nondeductible_cards" as any)
          .insert(payload);
        if (error) throw error;
      }
      await fetchAll();
    },
    [companyDb, fetchAll],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("pagcorp_nondeductible_cards" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
      await fetchAll();
    },
    [fetchAll],
  );

  const byIdentifier = useMemo(() => {
    const m = new Map<string, NondeductibleCard>();
    items.forEach((c) => m.set(c.card_identifier, c));
    return m;
  }, [items]);

  return { items, loading, error, fetchAll, upsert, remove, byIdentifier };
}
