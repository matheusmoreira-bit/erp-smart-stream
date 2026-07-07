import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";

export interface ApproverSubstitute {
  id: string;
  company_db: string | null;
  official_email: string;
  official_name: string | null;
  substitute_email: string;
  substitute_name: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  granted_by_id: string | null;
  granted_by_email: string;
  revoked_at: string | null;
  revoked_by_id: string | null;
  revoked_by_email: string | null;
  revoked_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSubstituteInput {
  official_email: string;
  official_name?: string | null;
  substitute_email: string;
  substitute_name?: string | null;
  starts_at: string;
  ends_at: string;
  reason?: string | null;
  company_db?: string | null;
}

export function statusOf(row: ApproverSubstitute, now = Date.now()): "active" | "scheduled" | "expired" | "revoked" {
  if (row.revoked_at) return "revoked";
  const start = new Date(row.starts_at).getTime();
  const end = new Date(row.ends_at).getTime();
  if (now < start) return "scheduled";
  if (now >= end) return "expired";
  return "active";
}

export function useApproverSubstitutes() {
  const [rows, setRows] = useState<ApproverSubstitute[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("approver_substitutes" as never)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRows((data as ApproverSubstitute[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar substituições");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = useCallback(async (input: CreateSubstituteInput) => {
    const { data: userData } = await supabase.auth.getUser();
    const grantedById = userData.user?.id ?? null;
    const grantedByEmail = userData.user?.email ?? "";
    if (!grantedByEmail) throw new Error("Sessão de administrador ausente");
    const { error } = await supabase.from("approver_substitutes" as never).insert({
      ...input,
      granted_by_id: grantedById,
      granted_by_email: grantedByEmail,
    } as never);
    if (error) throw error;
    await refresh();
  }, [refresh]);

  const revoke = useCallback(async (id: string, reason?: string) => {
    const { data: userData } = await supabase.auth.getUser();
    const revokedById = userData.user?.id ?? null;
    const revokedByEmail = userData.user?.email ?? "";
    const { error } = await supabase
      .from("approver_substitutes" as never)
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by_id: revokedById,
        revoked_by_email: revokedByEmail,
        revoked_reason: reason || null,
      } as never)
      .eq("id", id);
    if (error) throw error;
    await refresh();
  }, [refresh]);

  return { rows, isLoading, error, refresh, create, revoke };
}

/** Lista officials cujas substituições ativas apontam para o usuário logado. */
export function useActiveOfficialsForMe() {
  const { session } = useSap();
  const [officials, setOfficials] = useState<
    Array<{ official_email: string; official_name: string | null; id: string; ends_at: string }>
  >([]);

  const load = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const authEmail = (userData.user?.email || "").toLowerCase();
    // Também consideramos o SAP userName (ex.: "Leonardo.Rossini") — necessário
    // para usuários que só têm sessão no ERP e não em Lovable Cloud.
    const sapUser = (session?.userName || "").toLowerCase().trim();
    if (!authEmail && !sapUser) { setOfficials([]); return; }

    const nowIso = new Date().toISOString();
    const { data } = await supabase
      .from("approver_substitutes" as never)
      .select("id, official_email, official_name, ends_at, starts_at, revoked_at, substitute_email")
      .is("revoked_at", null)
      .lte("starts_at", nowIso)
      .gte("ends_at", nowIso);

    const authPrefix = authEmail.split("@")[0];
    const sapPrefix = sapUser.split("@")[0];
    const mine = ((data as ApproverSubstitute[]) || []).filter((r) => {
      const s = (r.substitute_email || "").toLowerCase();
      const sPrefix = s.split("@")[0];
      if (authEmail && (s === authEmail || sPrefix === authPrefix)) return true;
      if (sapUser && (s === sapUser || sPrefix === sapPrefix)) return true;
      return false;
    });
    setOfficials(mine.map((r) => ({
      official_email: r.official_email,
      official_name: r.official_name,
      id: r.id,
      ends_at: r.ends_at,
    })));
  }, [session?.userName]);

  useEffect(() => { load(); }, [load]);

  return { officials, refresh: load };
}
