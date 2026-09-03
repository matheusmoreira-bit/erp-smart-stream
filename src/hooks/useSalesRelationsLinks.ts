import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { NfEntradaLink, NfApLink } from "@/hooks/useRelationsMapDerived";

/**
 * Vínculos do lado de VENDAS (NF de Saída + Contas a Receber).
 *
 * Importante: o mapa de relações de compras deriva NF/CP a partir do DocEntry
 * do pedido, mas ORDR (venda) e OPOR (compra) têm numeração independente no
 * SAP — usar aquele caminho num pedido de venda vincula documentos de outra
 * cadeia. Aqui só usamos vínculos explícitos de venda:
 * `sales_order_invoices` (NFSe/Invoice emitida) e as baixas de recebimento.
 */

interface SalesInvoiceRow {
  id: string;
  sap_invoice_doc_entry: number | null;
  sap_invoice_doc_num: number | null;
  nfse_number: string | null;
  rps_number: string | null;
  series: string | null;
  authorized_at: string | null;
  total_amount: number | null;
  currency: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface BaixaRow {
  id: string;
  data_recebimento: string | null;
  valor_baixado: number | null;
  valor_juros_multa: number | null;
  status: string | null;
  sap_incoming_payment_doc_entry: number | null;
  created_at: string | null;
  criado_por_nome: string | null;
}

export interface UseSalesRelationsLinksInput {
  expenseId: string;
  companyDb: string | null | undefined;
  sapDocEntry: number | null | undefined;
  customerName?: string | null;
  enabled?: boolean;
}

export function useSalesRelationsLinks({
  expenseId,
  companyDb,
  sapDocEntry,
  customerName,
  enabled = true,
}: UseSalesRelationsLinksInput) {
  const [rows, setRows] = useState<NfEntradaLink[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!enabled || !expenseId) {
      setRows([]);
      return;
    }
    setIsLoading(true);
    try {
      const filters: string[] = [`expense_id.eq.${expenseId}`];
      if (companyDb && sapDocEntry) filters.push(`sap_order_doc_entry.eq.${sapDocEntry}`);

      let query = supabase
        .from("sales_order_invoices")
        .select(
          "id,sap_invoice_doc_entry,sap_invoice_doc_num,nfse_number,rps_number,series,authorized_at,total_amount,currency,status,created_at,updated_at",
        );
      query = companyDb ? query.eq("company_db", companyDb) : query;
      const { data, error } = await query.or(filters.join(","));
      if (error) throw error;

      const invoices = ((data || []) as SalesInvoiceRow[]).filter(
        (inv) => inv.status !== "failed" || !!inv.sap_invoice_doc_entry,
      );

      const mapped: NfEntradaLink[] = [];
      for (const inv of invoices) {
        let apLinks: NfApLink[] = [];
        let paid = 0;
        if (companyDb && inv.sap_invoice_doc_entry) {
          const { data: baixas } = await (supabase as unknown as {
            rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
          }).rpc("list_baixas_by_invoice", {
            p_company_db: companyDb,
            p_invoice_doc_entry: inv.sap_invoice_doc_entry,
          });
          const list = (baixas || []) as BaixaRow[];
          apLinks = list.map((b) => {
            const valor = Number(b.valor_baixado || 0);
            paid += valor;
            return {
              ap_doc_entry: String(b.sap_incoming_payment_doc_entry ?? b.id),
              ap_doc_num: b.sap_incoming_payment_doc_entry != null ? String(b.sap_incoming_payment_doc_entry) : null,
              ap_total: valor,
              ap_paid: b.status === "sincronizado" ? valor : 0,
              source: "sap" as const,
              linked_at: b.created_at || b.data_recebimento || new Date().toISOString(),
              notes: b.criado_por_nome ? `Baixa por ${b.criado_por_nome}` : null,
              payment_doc_entry: b.sap_incoming_payment_doc_entry,
              payment_doc_num: b.sap_incoming_payment_doc_entry,
              payment_date: b.data_recebimento,
              due_date: null,
              status: b.status === "sincronizado" ? "Baixado/Recebido" : "Pendente de sincronização",
            };
          });
        }

        mapped.push({
          id: inv.id,
          chave_acesso: "",
          numero_nf: inv.nfse_number || (inv.sap_invoice_doc_num != null ? String(inv.sap_invoice_doc_num) : null),
          serie: inv.series,
          nome_fornecedor: customerName || null,
          valor_total: Number(inv.total_amount || 0),
          status: inv.status,
          sap_invoice_draft_id: inv.sap_invoice_doc_entry != null ? String(inv.sap_invoice_doc_entry) : null,
          created_at: inv.authorized_at || inv.created_at,
          updated_at: inv.updated_at,
          ap_links: apLinks,
          due_date: null,
          payment_date: apLinks.map((l) => l.payment_date).filter(Boolean).sort().pop() || null,
          paid_amount: paid,
        });
      }
      setRows(mapped);
    } catch (cause) {
      console.warn("[sales-relations] falha ao carregar vínculos de venda:", cause);
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, expenseId, companyDb, sapDocEntry, customerName]);

  useEffect(() => {
    void load();
  }, [load]);

  return useMemo(() => ({ data: rows, isLoading, refresh: load }), [rows, isLoading, load]);
}
