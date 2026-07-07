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

    // Usa RPC SECURITY DEFINER para contornar RLS — necessário quando o usuário
    // só tem sessão SAP (sem auth.users no Lovable Cloud), caso do Leonardo.
    const identifiers = Array.from(new Set([authEmail, sapUser, authEmail.split("@")[0], sapUser.split("@")[0]].filter(Boolean)));
    const results = await Promise.all(
      identifiers.map((id) =>
        supabase.rpc("active_officials_for_substitute" as never, { _substitute_identifier: id } as never),
      ),
    );
    const seen = new Set<string>();
    const merged: Array<{ official_email: string; official_name: string | null; id: string; ends_at: string }> = [];
    for (const r of results) {
      const rows = ((r.data as Array<{ id: string; official_email: string; official_name: string | null; ends_at: string }>) || []);
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        merged.push({ id: row.id, official_email: row.official_email, official_name: row.official_name, ends_at: row.ends_at });
      }
    }
    setOfficials(merged);
  }, [session?.userName]);

  useEffect(() => { load(); }, [load]);

  return { officials, refresh: load };
}
