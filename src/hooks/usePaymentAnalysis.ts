import { useState, useEffect, useCallback } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQueryView } from "@/lib/sap-client";
import { omieListarContasPagar, type OmieContaPagar } from "@/lib/omie-client";

export interface PaymentAnalysisRow {
  Status_Pagamento: string;
  Numero_Pagamento_SAP: number;
  Data_do_Pagamento: string | null;
  Data_Lancamento_Pedido: string | null;
  Data_Emissao_NF: string | null;
  Data_Lancamento_NF: string | null;
  Data_Vencimento_Pagamento: string | null;
  Dias_Pedido_Ate_Pagamento: number | null;
  Dias_Emissao_NF_Ate_Pagamento: number | null;
  Dias_NF_Ate_Pagamento: number | null;
  Dias_Vencimento_Ate_Pagamento: number | null;
  Moeda: string;
  Valor_Total_Pago: number;
  Cod_PN: string;
  Nome_PN: string;
  Email_Fornecedor: string | null;
  Numero_Documento_Origem: number;
  Num_NF_Referencia: string | null;
  Valor_Aplicado_Neste_Doc: number;
  Status_Documento_Origem: string;
  Numero_Pedido_Compra: number | null;
  Nome_Solicitante: string;
  UserCode_Solicitante: string | null;
  Email_Solicitante: string | null;
  Filial: string;
  [key: string]: unknown;
}

export interface PaymentAnalysisData {
  rows: PaymentAnalysisRow[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/* ── Map OMIE contas a pagar → PaymentAnalysisRow ── */
function mapOmieToPaymentRows(contas: OmieContaPagar[]): PaymentAnalysisRow[] {
  const toIso = (d: string | null | undefined) => {
    if (!d) return null;
    const parts = d.split("/");
    return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : d;
  };

  return contas.map((c) => {
    const dataEmissao = c.data_emissao || null;
    const dataVencimento = c.data_vencimento || null;
    const dataPagamento = c.status_titulo === "LIQUIDADO" ? (c.data_previsao || c.data_vencimento || null) : null;

    const diasVencAtePag = dataPagamento && dataVencimento
      ? Math.round((new Date(dataPagamento.split("/").reverse().join("-")).getTime() -
          new Date(dataVencimento.split("/").reverse().join("-")).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const statusMap: Record<string, string> = {
      LIQUIDADO: "Pago",
      ABERTO: "Em Aberto",
      CANCELADO: "Cancelado",
      VENCIDO: "Vencido",
    };

    return {
      Status_Pagamento: statusMap[c.status_titulo || ""] || (c.status_titulo || "Desconhecido"),
      Numero_Pagamento_SAP: c.codigo_lancamento_omie,
      Data_do_Pagamento: toIso(dataPagamento),
      Data_Lancamento_Pedido: toIso(dataEmissao),
      Data_Emissao_NF: toIso(dataEmissao),
      Data_Lancamento_NF: toIso(dataEmissao),
      Data_Vencimento_Pagamento: toIso(dataVencimento),
      Dias_Pedido_Ate_Pagamento: null,
      Dias_Emissao_NF_Ate_Pagamento: null,
      Dias_NF_Ate_Pagamento: null,
      Dias_Vencimento_Ate_Pagamento: diasVencAtePag,
      Moeda: "BRL",
      Valor_Total_Pago: c.valor_documento || 0,
      Cod_PN: String(c.codigo_cliente_fornecedor || ""),
      Nome_PN: c.nome_cliente_fornecedor || `Fornecedor ${c.codigo_cliente_fornecedor}`,
      Email_Fornecedor: null,
      Numero_Documento_Origem: Number(c.numero_documento || 0),
      Num_NF_Referencia: c.numero_documento_fiscal || null,
      Valor_Aplicado_Neste_Doc: c.valor_pago || c.valor_documento || 0,
      Status_Documento_Origem: c.status_titulo || "",
      Numero_Pedido_Compra: c.numero_pedido ? Number(c.numero_pedido) : null,
      Nome_Solicitante: c.observacao || "OMIE",
      UserCode_Solicitante: null,
      Email_Solicitante: null,
      Filial: "",
    };
  });
}

export function usePaymentAnalysis(): PaymentAnalysisData {
  const { session } = useSap();
  const [rows, setRows] = useState<PaymentAnalysisRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!session) return;
    setError(null);
    const cacheKey = `payment-analysis:${session.erpType}`;
    const companyDb = session.companyDB;

    // 1. Paint cached data instantly (stale-while-revalidate)
    let hadCache = false;
    if (companyDb) {
      try {
        const { readCache } = await import("@/lib/external-cache");
        const cached = await readCache<PaymentAnalysisRow[]>(cacheKey, companyDb);
        if (cached?.data?.length) {
          setRows(cached.data);
          hadCache = true;
        }
      } catch {/* ignore */}
    }
    if (!hadCache) setIsLoading(true);

    try {
      let fresh: PaymentAnalysisRow[] = [];
      if (session.erpType === "sap") {
        const result = await sapQueryView<PaymentAnalysisRow>(
          session,
          "VW_ANALISE_PAGAMENTOS_DETALHADO",
        );
        fresh = result.data || [];
      } else if (session.erpType === "omie") {
        const contas = await omieListarContasPagar(session.companyDB, 10);
        fresh = mapOmieToPaymentRows(contas);
      }
      setRows(fresh);

      if (companyDb && fresh.length) {
        try {
          const { writeCache } = await import("@/lib/external-cache");
          await writeCache(cacheKey, companyDb, fresh);
        } catch (e) {
          console.warn("PaymentAnalysis cache write failed:", e);
        }
      }
    } catch (e) {
      console.error("Error fetching payment analysis:", e);
      if (!hadCache) setError(e instanceof Error ? e.message : "Erro ao buscar análise de pagamentos");
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { rows, isLoading, error, refresh: fetchData };
}
