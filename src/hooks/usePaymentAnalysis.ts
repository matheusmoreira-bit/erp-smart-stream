import { useState, useEffect, useCallback } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQueryView } from "@/lib/sap-client";

export interface PaymentAnalysisRow {
  DocNum: number;
  DocDate: string;
  CardCode: string;
  CardName: string;
  DocTotal: number;
  DocCurrency: string;
  DocumentStatus: string;
  PaymentDate?: string;
  PaymentMethod?: string;
  DaysToPayment?: number;
  CostCenter?: string;
  Project?: string;
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
