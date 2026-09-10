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
  confidence: number;
  reasons: string[];
  valorDiff: number;
  diasDiff: number | null;
}

export interface MastertaxLinkedNf {
  importId: string;
  chaveAcesso: string;
  numeroNf: string;
  serie: string;
  cnpjFornecedor: string;
  nomeFornecedor: string;
  dataEmissao: string | null;
  valorTotal: number;
  posted: boolean;
  invoiceDocNum: string | null;
  invoiceDocEntry: string | null;
  draftId: string | null;
  matchReason: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface MastertaxPoSearchResult {
  purchaseOrder: {
    docEntry: number;
    docNum: number | null;
    cardCode: string;
    cardName: string | null;
    docDate: string | null;
    docTotal: number;
    docCurrency?: string | null;
    documentStatus: string | null;
  };
  supplier?: {
    cardCode: string;
    taxId: string;
    country: string;
    international: boolean;
  };
  linked?: MastertaxLinkedNf | null;
  bestConfidence?: number;
  window: { de: string; ate: string };
  cnpjFilter?: string | null;
  valueRange?: { min: number; max: number; tolerance: number } | null;

  candidates: MastertaxCandidate[];
  masterTaxConfigured: boolean;
  masterTax?: {
    configured: boolean;
    httpStatus: number | null;
    periodo: { de: string; ate: string };
    recebidas: number;
    lidas: number;
    outroDestinatario: number;
    totalAnalisadas: number;
    descartadasPorCnpj: number;
    descartadasPorValor: number;
    descartadasJaLancadas?: number;
    descartadasComEsboco?: number;
    descartadasOutroPedido?: number;
    descartadasCanceladas?: number;
    exibidas: number;
    error: string | null;
  } | null;
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

export interface ManualNfInput {
  numero_nf: string;
  serie?: string;
  chave_acesso?: string;
  data_emissao: string;
  valor_total: number;
  cnpj_fornecedor?: string;
  nome_fornecedor?: string;
}

export interface AiNfFields {
  numero_nf?: string | null;
  serie?: string | null;
  chave_acesso?: string | null;
  data_emissao?: string | null;
  valor_total?: number | string | null;
  cnpj_fornecedor?: string | null;
  nome_fornecedor?: string | null;
  moeda?: string | null;
  observacoes?: string | null;
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

  const search = useCallback(async (
    poDocEntry: number | string,
    windowDays = 90,
    cnpjFornecedor?: string,
  ) => {
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
        cnpj_fornecedor: cnpjFornecedor?.replace(/\D/g, "") || undefined,
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

  /** Desfaz a vinculação de uma NF marcada como incorreta (só antes do lançamento). */
  const unlink = useCallback(async (poDocEntry: number | string, importId: string, reason?: string) => {
    if (!companyDb) throw new Error("Sessão do ERP não encontrada.");
    setLinking(true);
    try {
      return await call<{ ok: boolean; unlinked: boolean }>({
        action: "unlink",
        company_db: companyDb,
        po_doc_entry: poDocEntry,
        import_id: importId,
        reason,
      });
    } finally {
      setLinking(false);
    }
  }, [companyDb]);

  /** Lançamento manual da NF de entrada, vinculada ao pedido. */
  const manualPost = useCallback(async (
    poDocEntry: number | string,
    nf: ManualNfInput,
    mode: "draft" | "post",
  ) => {
    if (!companyDb) throw new Error("Sessão do ERP não encontrada.");
    setLinking(true);
    try {
      return await call<MastertaxLinkResult>({
        action: "manual_post",
        company_db: companyDb,
        po_doc_entry: poDocEntry,
        nf,
        mode,
      });
    } finally {
      setLinking(false);
    }
  }, [companyDb]);

  /** IA lê os anexos do pedido e sugere os campos da NF. */
  const aiExtract = useCallback(async (poDocEntry: number | string, expenseId: string) => {
    if (!companyDb) throw new Error("Sessão do ERP não encontrada.");
    const data = await call<{ ok: boolean; fields: AiNfFields; analyzedFiles: number }>({
      action: "ai_extract",
      company_db: companyDb,
      po_doc_entry: poDocEntry,
      expense_id: expenseId,
    });
    return data;
  }, [companyDb]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { search, link, unlink, manualPost, aiExtract, reset, loading, linking, error, result };
}
