import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  company_db: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export function useAuditLog(companyDb?: string) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      let query = supabase
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);

      if (companyDb) {
        query = query.eq("company_db", companyDb);
      }

      const { data, error: err } = await query;
      if (err) throw err;
      setEntries((data as AuditLogEntry[]) || []);
    } catch (e: any) {
      setError(e.message || "Erro ao carregar logs");
    } finally {
      setIsLoading(false);
    }
  }, [companyDb]);

  useEffect(() => { fetch(); }, [fetch]);

  return { entries, isLoading, error, refresh: fetch };
}

/** Helper to insert an audit log entry from anywhere in the app */
export async function logAuditAction(params: {
  action: string;
  entity_type: string;
  entity_id?: string;
  actor_email?: string;
  company_db?: string;
  details?: Record<string, unknown>;
}) {
  try {
    await supabase.from("audit_log").insert([{
      action: params.action,
      entity_type: params.entity_type,
      entity_id: params.entity_id || null,
      actor_email: params.actor_email || null,
      company_db: params.company_db || null,
      details: (params.details || {}) as any,
    }]);
  } catch {
    // silent – audit should never block main flow
  }
}
