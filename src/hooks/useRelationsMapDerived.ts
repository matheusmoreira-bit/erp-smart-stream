import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { useExternalCache } from "@/lib/external-cache";
import { sapQueryAll } from "@/lib/sap-client";
import { omieListarContasPagar, type OmieContaPagar } from "@/lib/omie-client";

/** TTL curto — evita bater no ERP toda vez que o usuário reabre o mapa. */
const TTL_MS = 5 * 60 * 1000;

export interface NfApLink {
  ap_doc_entry: string;
  ap_doc_num: string | null;
  ap_total: number | null;
  ap_paid: number | null;
  source: "sap" | "omie";
  linked_at: string;
  notes: string | null;
  /** VendorPayment DocEntry quando a origem é um pagamento SAP */
  payment_doc_entry?: number | null;
  payment_doc_num?: number | null;
  payment_date?: string | null;
}

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
  ap_links: NfApLink[];
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

export interface VendorPaymentLink {
  DocEntry: number;
  DocNum: number;
  DocDate: string;
  DocTotal: number;
  CardCode: string;
  CardName: string;
  Remarks: string | null;
  /** DocEntries das PurchaseInvoices quitadas por este pagamento */
  invoiceDocEntries: number[];
  /** valor aplicado a cada InvoiceDocEntry */
  appliedByInvoice: Record<number, number>;
}

export interface ContaPagarLink {
  id: string | number;
  fornecedor: string | null;
  numero_documento: string | null;
  valor_documento: number | null;
  valor_pago: number | null;
  data_registro: string | null;
  data_vencimento: string | null;
  data_pagamento: string | null;
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
      .eq("sap_matched_po_doc_entry", String(sapDocEntry))
      .eq("sap_company_db", companyDb)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const importRows = (data || []) as Omit<NfEntradaLink, "ap_links">[];

    // Também busca NFs lançadas manualmente no SAP (não passaram pelo ERP Flow),
    // via função security-definer no cache de NF de entrada.
    let cacheRows: Array<{
      doc_entry: number;
      doc_num: number | null;
      series: number | null;
      card_code: string | null;
      card_name: string | null;
      doc_date: string | null;
      doc_total: number | null;
      document_status: string | null;
      cancelled: string | null;
      sap_update_date: string | null;
    }> = [];
    try {
      const { data: cache, error: cacheErr } = await (supabase as any).rpc(
        "get_nf_entrada_cache_by_po",
        { _company_db: companyDb, _po_doc_entry: sapDocEntry },
      );
      if (!cacheErr && Array.isArray(cache)) cacheRows = cache as typeof cacheRows;
    } catch (e) {
      console.warn("[relations-map] falha ao ler NF cache do SAP:", e);
    }

    // dedup: se o mesmo doc_entry já foi registrado como draft/invoice em importRows
    // (via sap_invoice_draft_id), não duplica com uma versão vinda do cache.
    const matchedDocEntries = new Set(
      importRows
        .map((r) => (r.sap_invoice_draft_id ? Number(r.sap_invoice_draft_id) : null))
        .filter((v): v is number => v != null && Number.isFinite(v)),
    );
    const cacheOnly: Omit<NfEntradaLink, "ap_links">[] = cacheRows
      .filter((r) => !matchedDocEntries.has(r.doc_entry) && r.cancelled !== "tYES")
      .map((r) => ({
        id: `sap-cache:${r.doc_entry}`,
        chave_acesso: `SAP#${r.doc_entry}`,
        numero_nf: r.doc_num != null ? String(r.doc_num) : null,
        serie: r.series != null ? String(r.series) : null,
        nome_fornecedor: r.card_name || r.card_code,
        valor_total: r.doc_total,
        status: r.document_status === "bost_Close" ? "sap_close" : "sap_open",
        sap_invoice_draft_id: String(r.doc_entry),
        created_at: r.sap_update_date || r.doc_date || new Date().toISOString(),
        updated_at: r.sap_update_date || r.doc_date || new Date().toISOString(),
      }));

    const nfs: Omit<NfEntradaLink, "ap_links">[] = [...importRows, ...cacheOnly];
    if (nfs.length === 0) return [];

    // Busca contas a pagar vinculadas (N por NF) — tabela de rastreabilidade.
    // Só existe para NFs vindas de nf_entrada_imports (as do cache SAP não têm nf_import_id).
    const ids = importRows.map((n) => n.id);
    const byNf = new Map<string, NfApLink[]>();
    if (ids.length > 0) {
      const { data: linksData } = await (supabase as any)
        .from("nf_entrada_contas_pagar")
        .select("nf_import_id, ap_doc_entry, ap_doc_num, ap_total, ap_paid, source, linked_at, notes")
        .in("nf_import_id", ids);
      for (const row of (linksData || []) as Array<NfApLink & { nf_import_id: string }>) {
        const arr = byNf.get(row.nf_import_id) || [];
        arr.push({
          ap_doc_entry: row.ap_doc_entry,
          ap_doc_num: row.ap_doc_num,
          ap_total: row.ap_total,
          ap_paid: row.ap_paid,
          source: row.source,
          linked_at: row.linked_at,
          notes: row.notes,
        });
        byNf.set(row.nf_import_id, arr);
      }
    }
    return nfs.map((n) => ({ ...n, ap_links: byNf.get(n.id) || [] })) as NfEntradaLink[];
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
    payments: VendorPaymentLink[];
    paymentsByInvoice: Record<number, VendorPaymentLink[]>;
  }> => {
    const empty = { invoices: [], payables: [], payments: [], paymentsByInvoice: {} };
    if (!companyDb) return empty;

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

      // ── VendorPayments (Outgoing Payments): busca por CardCode das faturas
      // e casa pelas PaymentInvoices[].DocEntry ∈ set de invoices ───────────
      const payments: VendorPaymentLink[] = [];
      const paymentsByInvoice: Record<number, VendorPaymentLink[]> = {};
      const invoiceEntrySet = new Set(invoices.map((i) => i.DocEntry));
      const cardCodes = Array.from(new Set(invoices.map((i) => i.CardCode).filter(Boolean)));
      if (invoiceEntrySet.size > 0 && cardCodes.length > 0) {
        try {
          const cardFilter = cardCodes.map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
          const vpFilter = encodeURIComponent(`Cancelled eq 'tNO' and (${cardFilter})`);
          const vpEndpoint = `VendorPayments?$filter=${vpFilter}&$orderby=DocEntry desc&$top=200`;
          const { data: vpData } = await sapQueryAll(session, vpEndpoint, undefined, false);
          const vpRows = Array.isArray(vpData?.value) ? vpData.value : [];
          for (const r of vpRows as any[]) {
            const invLines = Array.isArray(r?.PaymentInvoices) ? r.PaymentInvoices : [];
            const applied: Record<number, number> = {};
            const invEntries: number[] = [];
            for (const li of invLines) {
              const de = Number(li?.DocEntry);
              const it = String(li?.InvoiceType || "");
              // it_PurchaseInvoice quita faturas de compra
              if (it === "it_PurchaseInvoice" && invoiceEntrySet.has(de)) {
                invEntries.push(de);
                applied[de] = (applied[de] || 0) + (Number(li?.SumApplied) || 0);
              }
            }
            if (invEntries.length === 0) continue;
            const payment: VendorPaymentLink = {
              DocEntry: Number(r?.DocEntry),
              DocNum: Number(r?.DocNum),
              DocDate: String(r?.DocDate || ""),
              DocTotal:
                Number(r?.BillOfExchangeAmount) ||
                Number(r?.CashSum) ||
                Number(r?.TransferSum) ||
                Object.values(applied).reduce((a, b) => a + b, 0),
              CardCode: String(r?.CardCode || ""),
              CardName: String(r?.CardName || ""),
              Remarks: r?.Remarks ?? null,
              invoiceDocEntries: invEntries,
              appliedByInvoice: applied,
            };
            payments.push(payment);
            for (const de of invEntries) {
              (paymentsByInvoice[de] ||= []).push(payment);
            }
          }
        } catch (e) {
          console.warn("[relations-map] falha ao buscar VendorPayments:", e);
        }
      }

      // Payables = faturas em aberto + pagamentos (com data de pagamento)
      const invoicePayables: ContaPagarLink[] = invoices.map((inv) => ({
        id: `sap:${inv.DocEntry}`,
        fornecedor: inv.CardName || inv.CardCode,
        numero_documento: String(inv.DocNum),
        valor_documento: inv.DocTotal,
        valor_pago: inv.PaidToDate,
        data_registro: inv.DocDate || null,
        data_vencimento: inv.DocDueDate,
        data_pagamento: null,
        status: inv.isFullyPaid
          ? "Pago"
          : inv.DocumentStatus === "bost_Close"
            ? "Fechado"
            : "Em aberto",
        numero_pedido: sapDocNum ? String(sapDocNum) : null,
        source: "sap",
      }));

      const paymentPayables: ContaPagarLink[] = payments.map((p) => ({
        id: `sap-vp:${p.DocEntry}`,
        fornecedor: p.CardName || p.CardCode,
        numero_documento: String(p.DocNum),
        valor_documento: p.DocTotal,
        valor_pago: p.DocTotal,
        data_registro: p.DocDate || null,
        data_vencimento: null,
        data_pagamento: p.DocDate || null,
        status: "Pago",
        numero_pedido: sapDocNum ? String(sapDocNum) : null,
        source: "sap",
      }));

      return {
        invoices,
        payables: [...invoicePayables, ...paymentPayables],
        payments,
        paymentsByInvoice,
      };
    }

    // ── OMIE via omie-proxy ─────────────────────────────────────────────────
    if (erpType === "omie") {
      try {
        const all = await omieListarContasPagar(companyDb, 6);
        const poNum = sapDocNum ? String(sapDocNum) : null;
        const supplier = supplierCode ? String(supplierCode) : null;

        const filtered = all.filter((row: OmieContaPagar) => {
          if (poNum && row.numero_pedido && String(row.numero_pedido) === poNum) return true;
          if (
            supplier &&
            row.codigo_cliente_fornecedor &&
            String(row.codigo_cliente_fornecedor) === supplier
          ) {
            return true;
          }
          return false;
        });

        const payables: ContaPagarLink[] = filtered.map((row) => {
          const dataPag = (row as Record<string, unknown>)["data_pagamento"];
          return {
            id: `omie:${row.codigo_lancamento_omie}`,
            fornecedor: row.nome_cliente_fornecedor ?? null,
            numero_documento: row.numero_documento ?? row.numero_documento_fiscal ?? null,
            valor_documento: row.valor_documento ?? null,
            valor_pago: row.valor_pago ?? null,
            data_registro: row.data_registro ?? row.data_emissao ?? null,
            data_vencimento: row.data_vencimento ?? null,
            data_pagamento: typeof dataPag === "string" ? dataPag : null,
            status: row.status_titulo ?? null,
            numero_pedido: row.numero_pedido ?? null,
            source: "omie" as const,
          };
        });

        return { invoices: [], payables, payments: [], paymentsByInvoice: {} };
      } catch (e) {
        console.warn("[relations-map] falha ao buscar OMIE contas a pagar:", e);
        return empty;
      }
    }

    return empty;
  }, [erpType, session, sapDocEntry, sapDocNum, companyDb, supplierCode]);

  const cacheKey =
    erpType === "sap" && sapDocEntry
      ? `relmap:ap:sap:${sapDocEntry}`
      : erpType === "omie" && (sapDocNum || supplierCode)
        ? `relmap:ap:omie:${sapDocNum || ""}:${supplierCode || ""}`
        : null;

  return useExternalCache<{
    invoices: PurchaseInvoiceLink[];
    payables: ContaPagarLink[];
    payments: VendorPaymentLink[];
    paymentsByInvoice: Record<number, VendorPaymentLink[]>;
  }>({
    cacheKey,
    companyDb: companyDb ?? null,
    fetcher,
    ttlMs: TTL_MS,
    enabled: enabled && !!companyDb && (erpType === "sap" || erpType === "omie"),
  });
}
