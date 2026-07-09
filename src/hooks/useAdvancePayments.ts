import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sapFunctionFetch } from "@/lib/auth-fetch";
import { useSap } from "@/contexts/SapContext";

export type AdvanceStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "integrating"
  | "integrated"
  | "failed";

export const ADVANCE_STATUS_LABELS: Record<AdvanceStatus, string> = {
  draft: "Rascunho",
  pending: "Pendente Aprovação",
  approved: "Aprovado",
  rejected: "Rejeitado",
  integrating: "Integrando ao SAP",
  integrated: "Integrado",
  failed: "Falhou",
};

export const ADVANCE_STATUS_COLORS: Record<AdvanceStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  pending: "bg-warning/15 text-warning",
  approved: "bg-primary/15 text-primary",
  rejected: "bg-destructive/15 text-destructive",
  integrating: "bg-primary/15 text-primary",
  integrated: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
};

export interface AdvanceAttachment {
  id: string;
  file_name: string;
  file_path: string;
  file_size?: number;
  mime_type?: string;
}

export interface AdvancePayment {
  id: string;
  company_db: string;
  supplier_card_code: string;
  supplier_name: string;
  supplier_cnpj?: string | null;
  amount: number;
  currency: string;
  due_date?: string | null;
  remarks?: string | null;
  status: AdvanceStatus;
  requester_id: string;
  requester_name?: string | null;
  requester_email?: string | null;
  rejection_reason?: string | null;
  cost_center?: string | null;
  cost_center_name?: string | null;
  sap_doc_entry?: number | null;
  sap_doc_num?: number | null;
  sap_integration_error?: string | null;
  sap_integrated_at?: string | null;
  created_at: string;
  updated_at: string;
  attachments?: AdvanceAttachment[];
}

export interface CreateAdvanceInput {
  company_db: string;
  supplier_card_code: string;
  supplier_name: string;
  supplier_cnpj?: string;
  amount: number;
  currency: string;
  due_date?: string;
  remarks?: string;
  cost_center?: string;
  cost_center_name?: string;
  files?: File[];
  submit?: boolean; // true => goes to pending; false => draft
}

async function callAdvanceToSap(advance_id: string) {
  const res = await sapFunctionFetch("advance-to-sap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ advance_id }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Edge function returned ${res.status}`);
  if (data?.success === false) throw new Error(data?.error || "Falha ao integrar no SAP");
  return data;
}

export function useAdvancePayments() {
  const { session } = useSap();
  const [items, setItems] = useState<AdvancePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const company = session?.companyDB;
      if (!company) {
        setItems([]);
        return;
      }
      const { data, error: err } = await (supabase.from("advance_payments") as any)
        .select("*")
        .eq("company_db", company)
        .order("created_at", { ascending: false });
      if (err) throw err;

      const ids = (data || []).map((r: any) => r.id);
      let attMap: Record<string, AdvanceAttachment[]> = {};
      if (ids.length) {
        const { data: atts } = await (supabase.from("advance_payment_attachments") as any)
          .select("*")
          .in("advance_id", ids);
        for (const a of (atts || []) as any[]) {
          (attMap[a.advance_id] ||= []).push(a);
        }
      }
      setItems((data || []).map((r: any) => ({ ...r, attachments: attMap[r.id] || [] })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [session?.companyDB]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const create = useCallback(
    async (input: CreateAdvanceInput) => {
      if (!session) throw new Error("Sessão SAP não encontrada");
      const userIdentifier = session.userName;

      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) throw new Error("Usuário não autenticado.");

      const status: AdvanceStatus = input.submit ? "pending" : "draft";

      const { data: row, error: err } = await (supabase.from("advance_payments") as any)
        .insert({
          company_db: input.company_db,
          supplier_card_code: input.supplier_card_code,
          supplier_name: input.supplier_name,
          supplier_cnpj: input.supplier_cnpj || null,
          amount: input.amount,
          currency: input.currency,
          due_date: input.due_date || null,
          remarks: input.remarks || null,
          requester_id: uid,
          requester_name: userIdentifier,
          requester_email: userIdentifier,
          status,
        })
        .select()
        .single();
      if (err) throw err;

      if (input.files?.length) {
        const advId = row.id;
        const rows: any[] = [];
        const { sapFunctionFetch } = await import("@/lib/auth-fetch");
        for (const file of input.files) {
          const fd = new FormData();
          fd.append("advance_id", advId);
          fd.append("file", file, file.name);
          const res = await sapFunctionFetch("expense-attachment-storage", {
            method: "POST",
            body: fd,
          });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.ok) {
            throw new Error(data?.error || `Falha ao enviar anexo ${file.name}: ${res.status}`);
          }
          rows.push({
            advance_id: advId,
            file_path: data.file_path,
            file_name: data.file_name,
            file_size: data.file_size,
            mime_type: data.mime_type,
            uploaded_by: uid,
          });
        }
        if (rows.length) {
          const { error: aErr } = await (supabase.from("advance_payment_attachments") as any).insert(rows);
          if (aErr) throw aErr;
        }
      }

      await fetchAll();
      return row as AdvancePayment;
    },
    [session, fetchAll],
  );

  const approve = useCallback(
    async (id: string) => {
      const { error: err } = await (supabase.from("advance_payments") as any)
        .update({ status: "approved" })
        .eq("id", id);
      if (err) throw err;
      // Tenta integrar imediatamente
      try {
        await (supabase.from("advance_payments") as any)
          .update({ status: "integrating" })
          .eq("id", id);
        await callAdvanceToSap(id);
      } catch (e) {
        await (supabase.from("advance_payments") as any)
          .update({ status: "failed", sap_integration_error: e instanceof Error ? e.message : String(e) })
          .eq("id", id);
        throw e;
      } finally {
        await fetchAll();
      }
    },
    [fetchAll],
  );

  const reject = useCallback(
    async (id: string, reason: string) => {
      const { error: err } = await (supabase.from("advance_payments") as any)
        .update({ status: "rejected", rejection_reason: reason })
        .eq("id", id);
      if (err) throw err;
      await fetchAll();
    },
    [fetchAll],
  );

  const retry = useCallback(
    async (id: string) => {
      await (supabase.from("advance_payments") as any)
        .update({ status: "integrating", sap_integration_error: null })
        .eq("id", id);
      try {
        await callAdvanceToSap(id);
      } catch (e) {
        await (supabase.from("advance_payments") as any)
          .update({ status: "failed", sap_integration_error: e instanceof Error ? e.message : String(e) })
          .eq("id", id);
        throw e;
      } finally {
        await fetchAll();
      }
    },
    [fetchAll],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error: err } = await (supabase.from("advance_payments") as any).delete().eq("id", id);
      if (err) throw err;
      await fetchAll();
    },
    [fetchAll],
  );

  return { items, loading, error, refresh: fetchAll, create, approve, reject, retry, remove };
}
