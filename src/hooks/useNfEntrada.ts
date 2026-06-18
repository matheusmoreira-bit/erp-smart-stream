import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type NfEntradaStatus =
  | "pending_expense"
  | "awaiting_erpflow_approval"
  | "erpflow_rejected"
  | "awaiting_sap"
  | "sap_rejected"
  | "awaiting_invoice"
  | "completed"
  | "integration_error"
  | "cancelled";

export interface NfEntradaImport {
  id: string;
  chave_acesso: string;
  numero_nf: string | null;
  serie: string | null;
  cnpj_fornecedor: string | null;
  nome_fornecedor: string | null;
  data_emissao: string | null;
  valor_total: number | null;
  status: NfEntradaStatus;
  expense_id: string | null;
  sap_company_db: string | null;
  sap_po_draft_id: string | null;
  sap_matched_po_doc_entry: string | null;
  sap_matched_po_is_draft: boolean | null;
  sap_matched_card_code: string | null;
  sap_match_reason: string | null;
  sap_invoice_draft_id: string | null;
  xml_storage_path: string | null;
  pdf_storage_path: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface NfEntradaLog {
  id: string;
  import_id: string;
  step: string;
  status_from: NfEntradaStatus | null;
  status_to: NfEntradaStatus | null;
  message: string | null;
  actor: string | null;
  created_at: string;
  payload: unknown;
}

export function useNfEntrada() {
  const [items, setItems] = useState<NfEntradaImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("nf_entrada_imports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (err) setError(err.message);
    else setItems((data || []) as NfEntradaImport[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const reprocess = useCallback(async (id: string) => {
    const { error: err } = await supabase.functions.invoke("nf-entrada-to-sap", {
      body: { import_id: id },
    });
    if (err) throw err;
    await fetchAll();
  }, [fetchAll]);

  const rematchSap = useCallback(async (id: string) => {
    const { data, error: err } = await supabase.functions.invoke("nf-entrada-rematch", {
      body: { import_id: id },
    });
    if (err) throw err;
    await fetchAll();
    return data as { matched: boolean; cardCode?: string; docEntry?: string; isDraft?: boolean; reason?: string; skipped?: string };
  }, [fetchAll]);

  const cancel = useCallback(async (id: string) => {
    const { error: err } = await supabase
      .from("nf_entrada_imports")
      .update({ status: "cancelled" })
      .eq("id", id);
    if (err) throw err;
    await fetchAll();
  }, [fetchAll]);

  const pullNow = useCallback(async () => {
    const { error: err } = await supabase.functions.invoke("mastertax-pull", { body: {} });
    if (err) throw err;
    await fetchAll();
  }, [fetchAll]);

  return { items, loading, error, refresh: fetchAll, reprocess, rematchSap, cancel, pullNow };
}

export async function fetchNfEntradaLogs(importId: string): Promise<NfEntradaLog[]> {
  const { data, error } = await supabase
    .from("nf_entrada_logs")
    .select("*")
    .eq("import_id", importId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as NfEntradaLog[];
}

export async function getSignedFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("nf-entrada-files")
    .createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}
