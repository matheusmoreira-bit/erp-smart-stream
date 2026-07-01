import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { useExternalCache } from "@/lib/external-cache";
import { sapQueryAll } from "@/lib/sap-client";
import { omieListarContasPagar, type OmieContaPagar } from "@/lib/omie-client";

/** TTL curto — evita bater no ERP toda vez que o usuário reabre o mapa. */
const TTL_MS = 5 * 60 * 1000;

export interface NfEntradaLink {
  id: string;
  chave_acesso: string;
  numero_nf: string | null;
  serie: string | null;
  nome_fornecedor: string | null;
  valor_total: number | null;
  status: string;
  sap_invoice_draft_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseInvoiceLink {
  DocEntry: number;
  DocNum: number;
  DocDate: string;
  DocDueDate: string | null;
  DocTotal: number;
  PaidToDate: number;
  DocumentStatus: string;
  CardCode: string;
  CardName: string;
  isFullyPaid: boolean;
}

export interface ContaPagarLink {
  id: string | number;
  fornecedor: string | null;
  numero_documento: string | null;
  valor_documento: number | null;
  valor_pago: number | null;
  data_vencimento: string | null;
  status: string | null;
  numero_pedido: string | null;
  source: "sap" | "omie";
}

export interface RelationsMapDerivedInput {
  expenseId: string;
  sapDocEntry: number | null | undefined;
  sapDocNum: number | null | undefined;
  companyDb: string | null | undefined;
  supplierCode: string | null | undefined;
  enabled?: boolean;
}

/** NFs de entrada vinculadas ao PC — leitura direta do Cloud (barato, sem cache externo). */
export function useNfEntradaLinks({
  sapDocEntry,
  companyDb,
  enabled = true,
}: RelationsMapDerivedInput) {
  const fetcher = useCallback(async (): Promise<NfEntradaLink[]> => {
    if (!sapDocEntry || !companyDb) return [];
    const { data, error } = await supabase
      .from("nf_entrada_imports")
      .select(
        "id,chave_acesso,numero_nf,serie,nome_fornecedor,valor_total,status,sap_invoice_draft_id,created_at,updated_at",
      )
      .eq("sap_matched_po_doc_entry", String(sapDocEntry) as unknown as number)
      .eq("sap_company_db", companyDb)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []) as NfEntradaLink[];
  }, [sapDocEntry, companyDb]);

  return useExternalCache<NfEntradaLink[]>({
    cacheKey: sapDocEntry && companyDb ? `relmap:nf:${sapDocEntry}` : null,
    companyDb: companyDb ?? null,
    fetcher,
    ttlMs: TTL_MS,
    enabled: enabled && !!sapDocEntry && !!companyDb,
  });
}

/** Contas a pagar / faturas de compra vinculadas ao PC. Usa SAP B1 ou OMIE conforme sessão. */
export function useContasPagarLinks({
  sapDocEntry,
  sapDocNum,
  companyDb,
  supplierCode,
  enabled = true,
}: RelationsMapDerivedInput) {
  const { session } = useSap();
  const erpType = session?.erpType;

  const fetcher = useCallback(async (): Promise<{
    invoices: PurchaseInvoiceLink[];
    payables: ContaPagarLink[];
  }> => {
    if (!companyDb) return { invoices: [], payables: [] };

    // ── SAP B1 via Service Layer ────────────────────────────────────────────
    if (erpType === "sap" && session && sapDocEntry) {
      const filter = encodeURIComponent(
        `DocumentLines/any(l: l/BaseEntry eq ${sapDocEntry} and l/BaseType eq 22)`,
      );
      const select = encodeURIComponent(
        "DocEntry,DocNum,DocDate,DocDueDate,DocTotal,PaidToDate,DocumentStatus,CardCode,CardName",
      );
      const endpoint = `PurchaseInvoices?$filter=${filter}&$select=${select}&$orderby=DocEntry desc`;

      let invoices: PurchaseInvoiceLink[] = [];
      try {
        const { data } = await sapQueryAll(session, endpoint, undefined, false);
        const rows = Array.isArray(data?.value) ? data.value : [];
        invoices = rows.map((r: any) => {
          const total = Number(r?.DocTotal) || 0;
          const paid = Number(r?.PaidToDate) || 0;
          return {
            DocEntry: Number(r?.DocEntry),
            DocNum: Number(r?.DocNum),
            DocDate: r?.DocDate,
            DocDueDate: r?.DocDueDate ?? null,
            DocTotal: total,
            PaidToDate: paid,
            DocumentStatus: String(r?.DocumentStatus || ""),
            CardCode: String(r?.CardCode || ""),
            CardName: String(r?.CardName || ""),
            isFullyPaid: total > 0 && Math.abs(total - paid) < 0.01,
          } as PurchaseInvoiceLink;
        });
      } catch (e) {
        console.warn("[relations-map] falha ao buscar PurchaseInvoices:", e);
      }

      const payables: ContaPagarLink[] = invoices.map((inv) => ({
        id: `sap:${inv.DocEntry}`,
        fornecedor: inv.CardName || inv.CardCode,
        numero_documento: String(inv.DocNum),
        valor_documento: inv.DocTotal,
        valor_pago: inv.PaidToDate,
        data_vencimento: inv.DocDueDate,
        status: inv.isFullyPaid
          ? "Pago"
          : inv.DocumentStatus === "bost_Close"
            ? "Fechado"
            : "Em aberto",
        numero_pedido: sapDocNum ? String(sapDocNum) : null,
        source: "sap",
      }));

      return { invoices, payables };
    }

    // ── OMIE via omie-proxy ─────────────────────────────────────────────────
    if (erpType === "omie") {
      try {
        const all = await omieListarContasPagar(companyDb, 6);
        const poNum = sapDocNum ? String(sapDocNum) : null;
        const supplier = supplierCode ? String(supplierCode) : null;

        const filtered = all.filter((row: OmieContaPagar) => {
          if (poNum && row.numero_pedido && String(row.numero_pedido) === poNum) return true;
          // fallback: casa por fornecedor + valor quando o pedido não foi propagado
          if (
            supplier &&
            row.codigo_cliente_fornecedor &&
            String(row.codigo_cliente_fornecedor) === supplier
          ) {
            return true;
          }
          return false;
        });

        const payables: ContaPagarLink[] = filtered.map((row) => ({
          id: `omie:${row.codigo_lancamento_omie}`,
          fornecedor: row.nome_cliente_fornecedor ?? null,
          numero_documento: row.numero_documento ?? row.numero_documento_fiscal ?? null,
          valor_documento: row.valor_documento ?? null,
          valor_pago: row.valor_pago ?? null,
          data_vencimento: row.data_vencimento ?? null,
          status: row.status_titulo ?? null,
          numero_pedido: row.numero_pedido ?? null,
          source: "omie",
        }));

        return { invoices: [], payables };
      } catch (e) {
        console.warn("[relations-map] falha ao buscar OMIE contas a pagar:", e);
        return { invoices: [], payables: [] };
      }
    }

    return { invoices: [], payables: [] };
  }, [erpType, session, sapDocEntry, sapDocNum, companyDb, supplierCode]);

  const cacheKey =
    erpType === "sap" && sapDocEntry
      ? `relmap:ap:sap:${sapDocEntry}`
      : erpType === "omie" && (sapDocNum || supplierCode)
        ? `relmap:ap:omie:${sapDocNum || ""}:${supplierCode || ""}`
        : null;

  return useExternalCache<{ invoices: PurchaseInvoiceLink[]; payables: ContaPagarLink[] }>({
    cacheKey,
    companyDb: companyDb ?? null,
    fetcher,
    ttlMs: TTL_MS,
    enabled: enabled && !!companyDb && (erpType === "sap" || erpType === "omie"),
  });
}
