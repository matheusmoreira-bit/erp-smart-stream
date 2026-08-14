import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";


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
  cnpj_destinatario: string | null;
  nome_destinatario: string | null;
  data_emissao: string | null;
  valor_total: number | null;
  status: NfEntradaStatus;
  expense_id: string | null;
  sap_company_db: string | null;
  sap_po_draft_id: string | null;
  sap_matched_po_doc_entry: string | null;
  sap_matched_po_doc_num: string | null;
  sap_matched_po_is_draft: boolean | null;
  sap_matched_card_code: string | null;
  sap_match_reason: string | null;
  sap_invoice_draft_id: string | null;
  erp_invoice_posted: boolean | null;
  erp_invoice_doc_entry: string | null;
  erp_invoice_doc_num: string | null;
  rejection_reason: string | null;
  xml_storage_path: string | null;
  pdf_storage_path: string | null;
  last_error: string | null;
  last_poll_at: string | null;
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

const onlyDigits = (v: string | null | undefined) => (v || "").replace(/\D/g, "");

export function useNfEntrada() {
  const { session } = useSap();
  const companyDb = session?.companyDB ?? null;
  const [items, setItems] = useState<NfEntradaImport[]>([]);
  const [companyTaxId, setCompanyTaxId] = useState<string | null>(null);
  /** Notas capturadas na base ativa cujo tomador não é o CNPJ da empresa. */
  const [foreignCount, setForeignCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Segregação por empresa: sem base ativa não listamos nada, para nunca
    // misturar notas de bases distintas (ex.: TST - ANA Gaming x ANA Gaming).
    if (!companyDb) {
      setItems([]);
      setForeignCount(0);
      setLoading(false);
      return;
    }

    const { data: company } = await supabase
      .from("companies")
      .select("tax_id")
      .eq("company_db", companyDb)
      .maybeSingle();
    const taxId = onlyDigits(company?.tax_id);
    setCompanyTaxId(taxId || null);

    const { data, error: err } = await supabase
      .from("nf_entrada_imports")
      .select("*")
      .eq("sap_company_db", companyDb)
      .order("created_at", { ascending: false })
      .limit(500);
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const rows = (data || []) as NfEntradaImport[];
    // Segunda barreira: quando conhecemos o CNPJ da empresa, só exibimos as
    // notas em que ela é a tomadora/destinatária.
    const scoped = taxId
      ? rows.filter((r) => !r.cnpj_destinatario || onlyDigits(r.cnpj_destinatario) === taxId)
      : rows;
    setForeignCount(rows.length - scoped.length);
    setItems(scoped);
    setLoading(false);
  }, [companyDb]);

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

  /** Reconfere no SAP se a NF já existe (watcher sob demanda) e atualiza o status. */
  const recheckSap = useCallback(async (id: string) => {
    const { data, error: err } = await supabase.functions.invoke("nf-entrada-sap-watcher", {
      body: { import_id: id },
    });
    if (err) throw err;
    await fetchAll();
    return data as {
      ok?: boolean;
      skipped?: string;
      results?: Array<{ id: string; status: string; error?: string }>;
    };
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

  /** Cria manualmente o esboço de NF de Entrada no SAP a partir do PC vinculado. */
  const createInvoiceDraft = useCallback(async (id: string) => {
    const { data, error: err } = await supabase.functions.invoke("nf-entrada-invoice-draft", {
      body: { import_id: id },
    });
    if (err) {
      const detail = (data as { error?: string } | null)?.error;
      throw new Error(detail || err.message);
    }
    if ((data as { error?: string } | null)?.error) {
      throw new Error((data as { error: string }).error);
    }
    await fetchAll();
    return data as { ok: boolean; draftId?: string; poEntry?: number; alreadyExists?: boolean };
  }, [fetchAll]);

  return {
    items, loading, error, companyDb, companyTaxId, foreignCount,
    refresh: fetchAll, reprocess, rematchSap, recheckSap, cancel, pullNow, createInvoiceDraft,
  };


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

export async function fetchNfFile(importId: string, kind: "xml" | "pdf"): Promise<string> {
  const { data, error } = await supabase.functions.invoke("nf-entrada-fetch-file", {
    body: { import_id: importId, kind },
  });
  if (error) throw error;
  const url = (data as { url?: string; error?: string })?.url;
  if (!url) throw new Error((data as { error?: string })?.error || "Sem URL");
  return url;
}
