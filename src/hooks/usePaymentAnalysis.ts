import { useState, useEffect, useCallback } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQueryView } from "@/lib/sap-client";

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

export function usePaymentAnalysis(): PaymentAnalysisData {
  const { session } = useSap();
  const [rows, setRows] = useState<PaymentAnalysisRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!session) return;
    setIsLoading(true);
    setError(null);

    try {
      const result = await sapQueryView<PaymentAnalysisRow>(
        session,
        "VW_ANALISE_PAGAMENTOS_DETALHADO",
      );
      setRows(result.data || []);
    } catch (e) {
      console.error("Error fetching VW_ANALISE_PAGAMENTOS_DETALHADO:", e);
      setError(e instanceof Error ? e.message : "Erro ao buscar análise de pagamentos");
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { rows, isLoading, error, refresh: fetchData };
}
