import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sapFunctionFetch } from "@/lib/auth-fetch";
import { useSap } from "@/contexts/SapContext";

/** Evento disparado quando as substituições mudam (criação/revogação),
 *  para que telas dependentes (ex.: Aprovações) recarreguem sozinhas. */
export const SUBSTITUTES_CHANGED_EVENT = "erp:substitutes-changed";

export function notifySubstitutesChanged() {
  try { window.dispatchEvent(new CustomEvent(SUBSTITUTES_CHANGED_EVENT)); } catch { /* ignore */ }
}

async function callSubstituteFn<T>(payload: Record<string, unknown>): Promise<T> {
  const resp = await sapFunctionFetch("approver-substitute-manage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* noop */ }
  if (!resp.ok) {
    const msg = (parsed as { error?: string } | null)?.error || `Falha na operação (${resp.status})`;
    throw new Error(msg);
  }
  return parsed as T;
}


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
  /** Prefixos de CC que limitam a substituição (null/[] = todos os CCs). */
  cost_center_prefixes: string[] | null;
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
  cost_center_prefixes?: string[] | null;
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
  const [canManageAll, setCanManageAll] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await callSubstituteFn<{ rows: ApproverSubstitute[]; is_admin: boolean }>({
        action: "list",
      });
      setRows(res?.rows || []);
      setCanManageAll(!!res?.is_admin);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar substituições");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = useCallback(async (input: CreateSubstituteInput) => {
    await callSubstituteFn({ action: "create", ...input });
    await refresh();
    notifySubstitutesChanged();
  }, [refresh]);

  const revoke = useCallback(async (id: string, reason?: string) => {
    await callSubstituteFn({ action: "revoke", id, reason: reason || null });
    await refresh();
    notifySubstitutesChanged();
  }, [refresh]);

  return { rows, isLoading, error, refresh, create, revoke, canManageAll };
}


/** Lista officials cujas substituições ativas apontam para o usuário logado.
 *  Escopo por empresa: grants com `company_db` preenchido só valem naquela base;
 *  `company_db` nulo = substituição válida para todas as empresas. */
export function useActiveOfficialsForMe() {
  const { session } = useSap();
  const [officials, setOfficials] = useState<
    Array<{ official_email: string; official_name: string | null; id: string; ends_at: string; cost_center_prefixes: string[] | null }>
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
    const currentDb = (session?.companyDB || "").toLowerCase().trim();
    const seen = new Set<string>();
    const merged: Array<{ official_email: string; official_name: string | null; id: string; ends_at: string; cost_center_prefixes: string[] | null }> = [];
    for (const r of results) {
      const rows = ((r.data as Array<{ id: string; official_email: string; official_name: string | null; ends_at: string; company_db: string | null; cost_center_prefixes: string[] | null }>) || []);
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        const scope = (row.company_db || "").toLowerCase().trim();
        if (scope && currentDb && scope !== currentDb) continue;
        seen.add(row.id);
        merged.push({ id: row.id, official_email: row.official_email, official_name: row.official_name, ends_at: row.ends_at, cost_center_prefixes: row.cost_center_prefixes ?? null });
      }
    }
    setOfficials(merged);
  }, [session?.userName, session?.companyDB]);

  useEffect(() => { load(); }, [load]);

  return { officials, refresh: load };
}


/** Grants (não revogados) em que sou o substituto — inclui starts_at/ends_at,
 *  para permitir validar se a substituição estava vigente na data do documento. */
export interface SubstituteGrantForMe {
  id: string;
  official_email: string;
  official_name: string | null;
  starts_at: string;
  ends_at: string;
  company_db: string | null;
  cost_center_prefixes: string[] | null;
}

export function useSubstituteGrantsForMe() {
  const { session } = useSap();
  const [grants, setGrants] = useState<SubstituteGrantForMe[]>([]);

  const load = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const authEmail = (userData.user?.email || "").toLowerCase();
    const sapUser = (session?.userName || "").toLowerCase().trim();
    if (!authEmail && !sapUser) { setGrants([]); return; }

    const identifiers = Array.from(
      new Set(
        [authEmail, sapUser, authEmail.split("@")[0], sapUser.split("@")[0]].filter(Boolean),
      ),
    );
    const results = await Promise.all(
      identifiers.map((id) =>
        supabase.rpc("substitute_grants_for_me" as never, { _substitute_identifier: id } as never),
      ),
    );
    const currentDb = (session?.companyDB || "").toLowerCase().trim();
    const seen = new Set<string>();
    const merged: SubstituteGrantForMe[] = [];
    for (const r of results) {
      const rows = ((r.data as SubstituteGrantForMe[]) || []);
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        // Escopo por empresa: grant de outra base não vale na base ativa.
        const scope = (row.company_db || "").toLowerCase().trim();
        if (scope && currentDb && scope !== currentDb) continue;
        seen.add(row.id);
        merged.push(row);
      }
    }
    setGrants(merged);
  }, [session?.userName, session?.companyDB]);


  useEffect(() => { load(); }, [load]);

  return { grants, refresh: load };
}
