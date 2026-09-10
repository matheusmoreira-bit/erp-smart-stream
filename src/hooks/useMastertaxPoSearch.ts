import { useCallback, useState } from "react";
import { sapFunctionFetch } from "@/lib/auth-fetch";

export interface MastertaxCandidate {
  chave_acesso: string;
  numero_nf: string;
  serie: string;
  cnpj_fornecedor: string;
  nome_fornecedor: string;
  data_emissao: string;
  valor_total: number;
  source: "mastertax" | "importada";
  import_id?: string;
  alreadyLinkedPoDocEntry?: string | null;
  alreadyPosted?: boolean;
  score: number;
  reasons: string[];
  valorDiff: number;
  diasDiff: number | null;
}

export interface MastertaxPoSearchResult {
  purchaseOrder: {
    docEntry: number;
    docNum: number | null;
    cardCode: string;
    cardName: string | null;
    docDate: string | null;
    docTotal: number;
    documentStatus: string | null;
  };
  window: { de: string; ate: string };
  candidates: MastertaxCandidate[];
  masterTaxConfigured: boolean;
  warning: string | null;
}

export interface MastertaxLinkResult {
  ok: boolean;
  mode: "draft" | "post";
  alreadyExists?: boolean;
  draftId?: string;
  invoiceDocEntry?: string;
  invoiceDocNum?: string | null;
  poDocNum?: number | null;
  importId?: string;
}

const FN = "mastertax-po-nf-search";

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await sapFunctionFetch(FN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload: unknown = null;
  try { payload = await res.json(); } catch { /* resposta sem corpo */ }
  const err = (payload as { error?: string } | null)?.error;
  if (!res.ok) {
    if (res.status === 403) throw new Error(err || "Você não tem permissão para esta ação.");
    throw new Error(err || `Falha na busca (HTTP ${res.status}).`);
  }
  if (err) throw new Error(err);
  return payload as T;
}

/** Busca na Master Tax a NF correspondente a um pedido de compra do ERP. */
export function useMastertaxPoSearch(companyDb: string | null | undefined) {
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MastertaxPoSearchResult | null>(null);

  const search = useCallback(async (poDocEntry: number | string, windowDays = 90) => {
    if (!companyDb) {
      setError("Sessão do ERP não encontrada.");
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await call<MastertaxPoSearchResult>({
        action: "search",
        company_db: companyDb,
        po_doc_entry: poDocEntry,
        window_days: windowDays,
      });
      setResult(data);
      return data;
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyDb]);

  const link = useCallback(async (
    poDocEntry: number | string,
    chaveAcesso: string,
    mode: "draft" | "post",
  ) => {
    if (!companyDb) throw new Error("Sessão do ERP não encontrada.");
    setLinking(true);
    try {
      return await call<MastertaxLinkResult>({
        action: "link",
        company_db: companyDb,
        po_doc_entry: poDocEntry,
        chave_acesso: chaveAcesso,
        mode,
      });
    } finally {
      setLinking(false);
    }
  }, [companyDb]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { search, link, reset, loading, linking, error, result };
}
