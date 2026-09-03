import { useEffect, useState } from "react";
import { useSap } from "@/contexts/SapContext";
import { supabase } from "@/integrations/supabase/client";
import { sapQuery } from "@/lib/sap-client";

export type RelationDocumentSource =
  | "expense"
  | "purchase_order"
  | "purchase_invoice"
  | "sales_order"
  | "sales_invoice";

export interface RelationCardDetail {
  source: RelationDocumentSource;
  title: string;
  expenseId: string;
  docEntry?: number | null;
  docNum?: string | number | null;
}

export interface RelationDocumentLine {
  id: string;
  itemCode: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  costCenter: string | null;
  project: string | null;
}

interface SapDocumentLine {
  LineNum?: unknown;
  ItemCode?: unknown;
  ItemDescription?: unknown;
  Quantity?: unknown;
  UnitPrice?: unknown;
  Price?: unknown;
  LineTotal?: unknown;
  CostingCode?: unknown;
  ProjectCode?: unknown;
  Project?: unknown;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

async function readExpenseLines(expenseId: string): Promise<RelationDocumentLine[]> {
  const { data, error } = await supabase
    .from("expense_items")
    .select("id,item_code,description,quantity,unit_price,line_total,cost_center,project")
    .eq("expense_id", expenseId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data || []).map((line) => ({
    id: line.id,
    itemCode: line.item_code,
    description: line.description,
    quantity: numberValue(line.quantity),
    unitPrice: numberValue(line.unit_price),
    lineTotal: numberValue(line.line_total),
    costCenter: line.cost_center,
    project: line.project,
  }));
}

function mapSapLines(lines: SapDocumentLine[]): RelationDocumentLine[] {
  return lines.map((line, index) => ({
    id: String(line.LineNum ?? index),
    itemCode: textValue(line.ItemCode),
    description: textValue(line.ItemDescription) || "Sem descrição",
    quantity: numberValue(line.Quantity),
    unitPrice: numberValue(line.UnitPrice ?? line.Price),
    lineTotal: numberValue(line.LineTotal),
    costCenter: textValue(line.CostingCode),
    project: textValue(line.ProjectCode ?? line.Project),
  }));
}

export function useRelationDocumentLines(detail: RelationCardDetail | null) {
  const { session } = useSap();
  const [lines, setLines] = useState<RelationDocumentLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!detail) {
      setLines([]);
      setError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const numericDocNum = Number(detail.docNum);
        if (
          detail.source === "expense" ||
          (!detail.docEntry && !Number.isFinite(numericDocNum)) ||
          session?.erpType === "omie"
        ) {
          const localLines = await readExpenseLines(detail.expenseId);
          if (!cancelled) setLines(localLines);
          return;
        }

        if (!session) throw new Error("Sessão ERP indisponível para consultar o documento.");
        const resource =
          detail.source === "purchase_invoice"
            ? "PurchaseInvoices"
            : detail.source === "sales_invoice"
              ? "Invoices"
              : detail.source === "sales_order"
                ? "Orders"
                : "PurchaseOrders";
        const endpoint = detail.docEntry
          ? `${resource}(${detail.docEntry})?$select=DocEntry,DocNum,DocumentLines`
          : `${resource}?$filter=DocNum eq ${numericDocNum}&$select=DocEntry,DocNum,DocumentLines&$top=1`;
        const { data } = await sapQuery(session, endpoint);
        const response = data as {
          value?: Array<{ DocumentLines?: SapDocumentLine[] }>;
          DocumentLines?: SapDocumentLine[];
        } | null;
        const document = Array.isArray(response?.value) ? response.value[0] : response;
        const sapLines = Array.isArray(document?.DocumentLines) ? document.DocumentLines : [];
        if (!cancelled) setLines(mapSapLines(sapLines));
      } catch (cause) {
        if (cancelled) return;
        setLines([]);
        setError(cause instanceof Error ? cause.message : "Falha ao carregar os itens do documento.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [detail, session]);

  return { lines, isLoading, error };
}
