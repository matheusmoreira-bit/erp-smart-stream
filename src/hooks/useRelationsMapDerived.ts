import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { useExternalCache } from "@/lib/external-cache";
import { sapQueryAll } from "@/lib/sap-client";
import { omieListarContasPagar, type OmieContaPagar } from "@/lib/omie-client";
import { resolveDocumentPaymentStatus } from "@/lib/relations-payment-status";

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
  due_date?: string | null;
  status?: string | null;
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
  due_date?: string | null;
  payment_date?: string | null;
  paid_amount?: number | null;
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
  /** Valor efetivamente aplicado às NFs DESTE pedido (nunca o total do lote) */
  DocTotal: number;
  /** Total do pagamento no SAP (pode ser um lote de milhões cobrindo várias NFs) */
  PaymentDocTotal: number;
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

interface SapDocumentRelation {
  source_type: string;
  source_doc_entry: number;
  source_doc_num: string | null;
  target_type: string;
  target_doc_entry: number;
  target_doc_num: string | null;
  relation_type: string;
  amount: number | null;
  currency: string | null;
  relation_date: string | null;
  last_seen_at: string;
  metadata: Record<string, unknown> | null;
}

interface NfEntradaCacheRow {
  doc_entry: number;
  doc_num: number | null;
  series: number | null;
  card_code: string | null;
  card_name: string | null;
  doc_date: string | null;
  doc_due_date: string | null;
  doc_total: number | null;
  paid_to_date: number | null;
  document_status: string | null;
  cancelled: string | null;
  sap_update_date: string | null;
}

interface DynamicSupabase {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  from(table: string): {
    select(columns: string): {
      in(column: string, values: unknown[]): Promise<{ data: unknown; error: unknown }>;
    };
  };
}

interface SapPurchaseInvoiceRow {
  DocEntry?: unknown;
  DocNum?: unknown;
  DocDate?: string | null;
  DocDueDate?: string | null;
  DocTotal?: unknown;
  PaidToDate?: unknown;
  DocumentStatus?: string | null;
  CardCode?: string | null;
  CardName?: string | null;
}

interface SapPaymentInvoiceLine {
  DocEntry?: unknown;
  InvoiceType?: string | null;
  SumApplied?: unknown;
  AppliedFC?: unknown;
  AppliedSys?: unknown;
}

interface SapVendorPaymentRow {
  DocEntry?: unknown;
  DocNum?: unknown;
  DocDate?: string | null;
  BillOfExchangeAmount?: unknown;
  CashSum?: unknown;
  TransferSum?: unknown;
  DocTotal?: unknown;
  CardCode?: string | null;
  CardName?: string | null;
  Remarks?: string | null;
  PaymentInvoices?: SapPaymentInvoiceLine[];
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

async function readRelations(companyDb: string, sapDocEntry: number): Promise<SapDocumentRelation[]> {
  const { data, error } = await (supabase as any)
    .from("sap_document_relations")
    .select("source_type,source_doc_entry,source_doc_num,target_type,target_doc_entry,target_doc_num,relation_type,amount,currency,relation_date,last_seen_at,metadata")
    .eq("company_db", companyDb)
    .or(`source_doc_entry.eq.${sapDocEntry},target_doc_entry.eq.${sapDocEntry}`);
  if (error) {
    console.warn("[relations-map] falha ao ler sap_document_relations:", error);
    return [];
  }
  const direct = (data || []) as SapDocumentRelation[];
  const apInvoiceEntries = Array.from(
    new Set(
      direct
        .flatMap((r) => [
          r.target_type === "ap_invoice" ? Number(r.target_doc_entry) : null,
          r.source_type === "ap_invoice" ? Number(r.source_doc_entry) : null,
        ])
        .filter((v): v is number => v != null && Number.isFinite(v)),
    ),
  );
  if (apInvoiceEntries.length === 0) return direct;

  const { data: downstream, error: downstreamError } = await (supabase as any)
    .from("sap_document_relations")
    .select("source_type,source_doc_entry,source_doc_num,target_type,target_doc_entry,target_doc_num,relation_type,amount,currency,relation_date,last_seen_at,metadata")
    .eq("company_db", companyDb)
    .eq("relation_type", "ap_invoice_to_vendor_payment")
    .in("source_doc_entry", apInvoiceEntries);
  if (downstreamError) {
    console.warn("[relations-map] falha ao ler relações downstream:", downstreamError);
    return direct;
  }

  const byKey = new Map<string, SapDocumentRelation>();
  for (const row of [...direct, ...((downstream || []) as SapDocumentRelation[])]) {
    byKey.set(
      [
        row.source_type,
        row.source_doc_entry,
        row.target_type,
        row.target_doc_entry,
        row.relation_type,
      ].join(":"),
      row,
    );
  }
  return Array.from(byKey.values());
}

/** NFs de entrada vinculadas ao PC — leitura direta do Cloud (barato, sem cache externo). */
export function useNfEntradaLinks({
  sapDocEntry,
  companyDb,
  supplierCode,
  enabled = true,
}: RelationsMapDerivedInput) {
  const fetcher = useCallback(async (): Promise<NfEntradaLink[]> => {
    if (!sapDocEntry || !companyDb) return [];
    const relations = await readRelations(companyDb, sapDocEntry);
    const purchaseInvoiceRelations = relations.filter(
      (r) =>
        r.relation_type === "purchase_order_to_ap_invoice" &&
        r.source_type === "purchase_order" &&
        Number(r.source_doc_entry) === Number(sapDocEntry) &&
        r.target_type === "ap_invoice",
    );

    const { data, error } = await supabase
      .from("nf_entrada_imports")
      .select(
        "id,chave_acesso,numero_nf,serie,nome_fornecedor,valor_total,status,sap_invoice_draft_id,erp_invoice_doc_entry,erp_invoice_doc_num,created_at,updated_at,sap_matched_card_code",
      )
      .eq("sap_matched_po_doc_entry", String(sapDocEntry))
      .eq("sap_company_db", companyDb)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const expectedSupplier = String(supplierCode || "").trim().toUpperCase();
    const importRows = ((data || []) as Array<Omit<NfEntradaLink, "ap_links"> & {
      erp_invoice_doc_entry?: string | null;
      erp_invoice_doc_num?: string | null;
      sap_matched_card_code?: string | null;
    }>)
      // Guarda contra vínculos cruzados: o DocEntry pode colidir entre bases/
      // documentos, então só aceitamos a NF quando o fornecedor confere.
      .filter((r) => {
        const matched = String(r.sap_matched_card_code || "").trim().toUpperCase();
        if (!expectedSupplier || !matched) return true;
        return matched === expectedSupplier;
      })
      .map((r) => ({
        ...r,
        sap_invoice_draft_id: r.erp_invoice_doc_entry || r.sap_invoice_draft_id,
        numero_nf: r.numero_nf || r.erp_invoice_doc_num || null,
      })) as Omit<NfEntradaLink, "ap_links">[];


    // Também busca NFs lançadas manualmente no SAP (não passaram pelo ERP Flow),
    // via função security-definer no cache de NF de entrada.
    let cacheRows: NfEntradaCacheRow[] = [];
    try {
      const { data: cache, error: cacheErr } = await (supabase as unknown as DynamicSupabase).rpc(
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
    const relationOnly: Omit<NfEntradaLink, "ap_links">[] = purchaseInvoiceRelations
      .filter((r) => !matchedDocEntries.has(Number(r.target_doc_entry)))
      .map((r) => ({
        id: `sap-rel:${r.target_doc_entry}`,
        chave_acesso: `SAP#${r.target_doc_entry}`,
        numero_nf: r.target_doc_num,
        serie: null,
        nome_fornecedor: asString(r.metadata?.card_name) || asString(r.metadata?.card_code) || null,
        valor_total: r.amount,
        status: "sap_linked",
        sap_invoice_draft_id: String(r.target_doc_entry),
        created_at: r.relation_date || r.last_seen_at,
        updated_at: r.last_seen_at,
        due_date: asString(r.metadata?.doc_due_date),
        paid_amount: Number(r.metadata?.paid_to_date || 0),
      }));
    for (const r of relationOnly) matchedDocEntries.add(Number(r.sap_invoice_draft_id));
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
        due_date: r.doc_due_date,
        paid_amount: r.paid_to_date,
      }));

    const nfs: Omit<NfEntradaLink, "ap_links">[] = [...importRows, ...relationOnly, ...cacheOnly];
    if (nfs.length === 0) return [];

    // Busca contas a pagar vinculadas (N por NF) — tabela de rastreabilidade.
    // Só existe para NFs vindas de nf_entrada_imports (as do cache SAP não têm nf_import_id).
    const ids = importRows.map((n) => n.id);
    const byNf = new Map<string, NfApLink[]>();
    if (ids.length > 0) {
      const { data: linksData } = await (supabase as unknown as DynamicSupabase)
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

    const paymentRelationsByInvoice = new Map<number, SapDocumentRelation[]>();
    for (const rel of relations) {
      if (rel.relation_type !== "ap_invoice_to_vendor_payment") continue;
      const arr = paymentRelationsByInvoice.get(rel.source_doc_entry) || [];
      arr.push(rel);
      paymentRelationsByInvoice.set(rel.source_doc_entry, arr);
    }

    for (const nf of nfs) {
      const invEntry = nf.sap_invoice_draft_id ? Number(nf.sap_invoice_draft_id) : null;
      if (!invEntry || !Number.isFinite(invEntry)) continue;
      const arr = byNf.get(nf.id) || [];
      const selfKey = String(invEntry);
      if (!arr.some((link) => link.ap_doc_entry === selfKey)) {
        arr.push({
          ap_doc_entry: selfKey,
          ap_doc_num: nf.numero_nf,
          ap_total: nf.valor_total,
          ap_paid: null,
          source: "sap",
          linked_at: nf.created_at,
          notes: "NF de entrada vinculada pelo watcher SAP",
        });
      }
      for (const rel of paymentRelationsByInvoice.get(invEntry) || []) {
        const paymentKey = String(rel.target_doc_entry);
        if (arr.some((link) => link.payment_doc_entry === rel.target_doc_entry || link.ap_doc_entry === paymentKey)) continue;
        arr.push({
          ap_doc_entry: paymentKey,
          ap_doc_num: rel.target_doc_num,
          ap_total: rel.amount,
          ap_paid: rel.amount,
          source: "sap",
          linked_at: rel.relation_date || rel.last_seen_at,
          notes: "Pagamento fornecedor vinculado pelo watcher SAP",
          payment_doc_entry: rel.target_doc_entry,
          payment_doc_num: rel.target_doc_num ? Number(rel.target_doc_num) : null,
          payment_date: rel.relation_date,
        });
      }
      byNf.set(nf.id, arr);
    }

    return nfs.map((n) => ({ ...n, ap_links: byNf.get(n.id) || [] })) as NfEntradaLink[];
  }, [sapDocEntry, companyDb, supplierCode]);

  return useExternalCache<NfEntradaLink[]>({
    cacheKey: sapDocEntry && companyDb ? `relmap:nf:v4:${sapDocEntry}:${supplierCode || ""}` : null,

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
  const effectiveErpType = erpType || (sapDocEntry ? "sap" : null);

  const fetcher = useCallback(async (): Promise<{
    invoices: PurchaseInvoiceLink[];
    payables: ContaPagarLink[];
    payments: VendorPaymentLink[];
    paymentsByInvoice: Record<number, VendorPaymentLink[]>;
  }> => {
    const empty = { invoices: [], payables: [], payments: [], paymentsByInvoice: {} };
    if (!companyDb) return empty;
    const relationRows = sapDocEntry ? await readRelations(companyDb, sapDocEntry) : [];
    const relationInvoices: PurchaseInvoiceLink[] = relationRows
      .filter(
        (r) =>
          r.relation_type === "purchase_order_to_ap_invoice" &&
          r.source_type === "purchase_order" &&
          Number(r.source_doc_entry) === Number(sapDocEntry) &&
          r.target_type === "ap_invoice",
      )
      .map((r) => {
        const total = Number(r.amount || 0);
        const paid = Number(r.metadata?.paid_to_date || 0);
        return {
          DocEntry: Number(r.target_doc_entry),
          DocNum: Number(r.target_doc_num || r.target_doc_entry),
          DocDate: r.relation_date || r.last_seen_at,
          DocDueDate: asString(r.metadata?.doc_due_date),
          DocTotal: total,
          PaidToDate: paid,
          DocumentStatus: asString(r.metadata?.document_status) || "sap_linked",
          CardCode: asString(r.metadata?.card_code) || String(supplierCode || ""),
          CardName: asString(r.metadata?.card_name) || "",
          isFullyPaid: resolveDocumentPaymentStatus(total, paid).state === "paid",
        } as PurchaseInvoiceLink;
      });

    const relationPaymentRows = relationRows.filter((r) => r.relation_type === "ap_invoice_to_vendor_payment");

    // ── SAP B1 via Service Layer ────────────────────────────────────────────
    if (effectiveErpType === "sap" && sapDocEntry) {
      const filter = encodeURIComponent(
        `DocumentLines/any(l: l/BaseEntry eq ${sapDocEntry} and l/BaseType eq 22)`,
      );
      const select = encodeURIComponent(
        "DocEntry,DocNum,DocDate,DocDueDate,DocTotal,PaidToDate,DocumentStatus,CardCode,CardName",
      );
      const endpoint = `PurchaseInvoices?$filter=${filter}&$select=${select}&$orderby=DocEntry desc`;

      let invoices: PurchaseInvoiceLink[] = [...relationInvoices];
      if (session) {
        try {
          const { data } = await sapQueryAll(session, endpoint, undefined, false);
          const rows = Array.isArray(data?.value) ? data.value : [];
          const liveInvoices = (rows as SapPurchaseInvoiceRow[]).map((r) => {
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
          const byEntry = new Map(invoices.map((invoice) => [invoice.DocEntry, invoice]));
          for (const invoice of liveInvoices) {
            byEntry.set(invoice.DocEntry, { ...byEntry.get(invoice.DocEntry), ...invoice });
          }
          invoices = Array.from(byEntry.values());
        } catch (e) {
          console.warn("[relations-map] falha ao buscar PurchaseInvoices:", e);
        }
      }

      // Algumas NFs lançadas no SAP não preservam a linha base do PC no Service Layer,
      // então o filtro por DocumentLines/BaseEntry pode voltar vazio. Usa o cache de
      // NFs por PC como fallback para descobrir os DocEntries que devem ser casados
      // contra VendorPayments[].PaymentInvoices[].DocEntry.
      try {
        const { data: cache, error: cacheErr } = await (supabase as unknown as DynamicSupabase).rpc(
          "get_nf_entrada_cache_by_po",
          { _company_db: companyDb, _po_doc_entry: sapDocEntry },
        );
        if (!cacheErr && Array.isArray(cache)) {
          const existing = new Set(invoices.map((i) => i.DocEntry));
          const cachedInvoices = (cache as NfEntradaCacheRow[])
            .filter((r) => r?.cancelled !== "tYES" && Number.isFinite(Number(r?.doc_entry)))
            .filter((r) => !existing.has(Number(r.doc_entry)))
            .map((r) => {
              const total = Number(r?.doc_total) || 0;
              return {
                DocEntry: Number(r?.doc_entry),
                DocNum: Number(r?.doc_num),
                DocDate: String(r?.doc_date || ""),
                DocDueDate: r?.doc_due_date ?? null,
                DocTotal: total,
                PaidToDate: Number(r?.paid_to_date) || 0,
                DocumentStatus: String(r?.document_status || ""),
                CardCode: String(r?.card_code || supplierCode || ""),
                CardName: String(r?.card_name || ""),
                isFullyPaid: resolveDocumentPaymentStatus(total, r?.paid_to_date, r?.document_status).state === "paid",
              } as PurchaseInvoiceLink;
            });
          invoices = [...invoices, ...cachedInvoices];
        }
      } catch (e) {
        console.warn("[relations-map] falha ao buscar cache de NFs para AP:", e);
      }

      // ── VendorPayments (Outgoing Payments): busca por CardCode das faturas
      // e casa pelas PaymentInvoices[].DocEntry ∈ set de invoices ───────────
      const payments: VendorPaymentLink[] = [];
      const paymentsByInvoice: Record<number, VendorPaymentLink[]> = {};
      const invoiceEntrySet = new Set(invoices.map((i) => i.DocEntry));
      const cardCodes = Array.from(new Set(invoices.map((i) => i.CardCode).filter(Boolean)));
      const paymentByEntry = new Map<number, VendorPaymentLink>();
      const registerPayment = (payment: VendorPaymentLink) => {
        const current = paymentByEntry.get(payment.DocEntry);
        if (!current) {
          paymentByEntry.set(payment.DocEntry, payment);
          payments.push(payment);
          for (const de of payment.invoiceDocEntries) {
            (paymentsByInvoice[de] ||= []).push(payment);
          }
          return;
        }

        current.PaymentDocTotal = Math.max(current.PaymentDocTotal, payment.PaymentDocTotal);
        current.DocDate = current.DocDate || payment.DocDate;
        current.DocNum = current.DocNum || payment.DocNum;
        current.CardCode = current.CardCode || payment.CardCode;
        current.CardName = current.CardName || payment.CardName;
        current.Remarks = current.Remarks || payment.Remarks;
        for (const [docEntryText, appliedValue] of Object.entries(payment.appliedByInvoice)) {
          const docEntry = Number(docEntryText);
          current.appliedByInvoice[docEntry] = Math.max(
            current.appliedByInvoice[docEntry] || 0,
            Number(appliedValue) || 0,
          );
          if (!current.invoiceDocEntries.includes(docEntry)) current.invoiceDocEntries.push(docEntry);
          const list = (paymentsByInvoice[docEntry] ||= []);
          if (!list.some((item) => item.DocEntry === current.DocEntry)) list.push(current);
        }
        current.DocTotal = Object.values(current.appliedByInvoice).reduce((sum, value) => sum + value, 0);
      };
      const registerPaymentRows = (vpRows: SapVendorPaymentRow[]) => {
        for (const r of vpRows) {
          const paymentDocEntry = Number(r?.DocEntry);
          if (!Number.isFinite(paymentDocEntry)) continue;
          const invLines = Array.isArray(r?.PaymentInvoices) ? r.PaymentInvoices : [];
          const applied: Record<number, number> = {};
          const invEntries: number[] = [];
          for (const li of invLines) {
            const de = Number(li?.DocEntry);
            const it = String(li?.InvoiceType || "");
            // it_PurchaseInvoice quita faturas de compra
            if (it === "it_PurchaseInvoice" && invoiceEntrySet.has(de)) {
              // O Service Layer pode devolver SumApplied ou AppliedFC/AppliedSys.
              const sum = Number(li?.SumApplied ?? li?.AppliedFC ?? li?.AppliedSys ?? 0) || 0;
              if (!invEntries.includes(de)) invEntries.push(de);
              applied[de] = (applied[de] || 0) + sum;
            }
          }
          if (invEntries.length === 0) continue;
          // Total do lote no SAP (pode cobrir dezenas de NFs de vários pedidos).
          const paymentDocTotal =
            Number(r?.BillOfExchangeAmount) ||
            Number(r?.CashSum) ||
            Number(r?.TransferSum) ||
            Number(r?.DocTotal) ||
            0;
          // Valor que interessa a ESTE pedido: somente o aplicado às NFs dele.
          const appliedToThisPo = Object.values(applied).reduce((a, b) => a + b, 0);
          const payment: VendorPaymentLink = {
            DocEntry: paymentDocEntry,
            DocNum: Number(r?.DocNum),
            DocDate: String(r?.DocDate || ""),
            DocTotal: appliedToThisPo || paymentDocTotal,
            PaymentDocTotal: paymentDocTotal || appliedToThisPo,
            CardCode: String(r?.CardCode || ""),
            CardName: String(r?.CardName || ""),
            Remarks: r?.Remarks ?? null,
            invoiceDocEntries: invEntries,
            appliedByInvoice: applied,
          };
          registerPayment(payment);
        }
      };

      for (const rel of relationPaymentRows) {
        const invoiceEntry = Number(rel.source_doc_entry);
        if (!invoiceEntrySet.has(invoiceEntry)) continue;
        const paymentDocEntry = Number(rel.target_doc_entry);
        const applied = Number(rel.amount || 0);
        registerPayment({
          DocEntry: paymentDocEntry,
          DocNum: Number(rel.target_doc_num || paymentDocEntry),
          DocDate: rel.relation_date || rel.last_seen_at,
          DocTotal: applied,
          PaymentDocTotal: applied,
          CardCode: asString(rel.metadata?.card_code) || "",
          CardName: asString(rel.metadata?.card_name) || "",
          Remarks: "Pagamento fornecedor vinculado pelo watcher SAP",
          invoiceDocEntries: [invoiceEntry],
          appliedByInvoice: { [invoiceEntry]: applied },
        });
      }

      if (session && invoiceEntrySet.size > 0) {
        // Primeiro tenta o vínculo exato: VendorPayments -> PaymentInvoices -> DocEntry da NF.
        // Esse é o modelo observado no SAP (ex.: AP DocEntry 3100 paga NF DocEntry 6370).
        for (const invoiceDocEntry of Array.from(invoiceEntrySet).slice(0, 20)) {
          try {
            const vpByInvoiceFilter = encodeURIComponent(
              `Cancelled eq 'tNO' and PaymentInvoices/any(i: i/DocEntry eq ${invoiceDocEntry} and i/InvoiceType eq 'it_PurchaseInvoice')`,
            );
            const vpByInvoiceEndpoint = `VendorPayments?$filter=${vpByInvoiceFilter}&$orderby=DocEntry desc`;
            const { data: vpByInvoiceData } = await sapQueryAll(session, vpByInvoiceEndpoint, undefined, false);
            registerPaymentRows(Array.isArray(vpByInvoiceData?.value) ? (vpByInvoiceData.value as SapVendorPaymentRow[]) : []);
          } catch (e) {
            console.warn(`[relations-map] falha ao buscar VendorPayments da NF ${invoiceDocEntry}:`, e);
          }
        }

        // Fallback: algumas versões do Service Layer não aceitam filtro any() em PaymentInvoices.
        // Busca os pagamentos recentes do fornecedor e filtra localmente pelas linhas da NF.
        if (cardCodes.length > 0) {
          try {
            const cardFilter = cardCodes.map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
            const vpFilter = encodeURIComponent(`Cancelled eq 'tNO' and (${cardFilter})`);
            const vpEndpoint = `VendorPayments?$filter=${vpFilter}&$orderby=DocEntry desc&$top=500`;
            const { data: vpData } = await sapQueryAll(session, vpEndpoint, undefined, false);
            registerPaymentRows(Array.isArray(vpData?.value) ? (vpData.value as SapVendorPaymentRow[]) : []);
          } catch (e) {
            console.warn("[relations-map] falha ao buscar VendorPayments:", e);
          }
        }
      }

      invoices = invoices.map((invoice) => {
        const paidByPayments = (paymentsByInvoice[invoice.DocEntry] || []).reduce(
          (sum, payment) => sum + (payment.appliedByInvoice[invoice.DocEntry] || 0),
          0,
        );
        const paid = Math.max(invoice.PaidToDate, paidByPayments);
        return {
          ...invoice,
          PaidToDate: paid,
          isFullyPaid: resolveDocumentPaymentStatus(invoice.DocTotal, paid, invoice.DocumentStatus).state === "paid",
        };
      });

      // Payables = faturas em aberto + pagamentos (com data de pagamento)
      const invoicePayables: ContaPagarLink[] = invoices.map((inv) => {
        const paymentStatus = resolveDocumentPaymentStatus(inv.DocTotal, inv.PaidToDate, inv.DocumentStatus);
        const paymentDates = (paymentsByInvoice[inv.DocEntry] || [])
          .map((payment) => payment.DocDate)
          .filter(Boolean)
          .sort();
        return {
          id: `sap:${inv.DocEntry}`,
          fornecedor: inv.CardName || inv.CardCode,
          numero_documento: String(inv.DocNum),
          valor_documento: inv.DocTotal,
          valor_pago: inv.PaidToDate,
          data_registro: inv.DocDate || null,
          data_vencimento: inv.DocDueDate,
          data_pagamento: paymentDates[paymentDates.length - 1] || null,
          status: paymentStatus.label,
          numero_pedido: sapDocNum ? String(sapDocNum) : null,
          source: "sap",
        };
      });

      // Baixas: exibimos SEMPRE o valor aplicado às NFs deste pedido. O total do
      // lote (p.PaymentDocTotal) pode somar milhões e não pertence a este PC.
      const paymentPayables: ContaPagarLink[] = payments.map((p) => ({
        id: `sap-vp:${p.DocEntry}`,
        fornecedor: p.CardName || p.CardCode,
        numero_documento: String(p.DocNum),
        valor_documento: p.DocTotal,
        valor_pago: p.DocTotal,
        data_registro: p.DocDate || null,
        data_vencimento: null,
        data_pagamento: p.DocDate || null,
        status: "Baixado/Pago",
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
    if (effectiveErpType === "omie") {
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
          const paymentStatus = resolveDocumentPaymentStatus(
            row.valor_documento,
            row.valor_pago,
            row.status_titulo,
          );
          return {
            id: `omie:${row.codigo_lancamento_omie}`,
            fornecedor: row.nome_cliente_fornecedor ?? null,
            numero_documento: row.numero_documento ?? row.numero_documento_fiscal ?? null,
            valor_documento: row.valor_documento ?? null,
            valor_pago: row.valor_pago ?? null,
            data_registro: row.data_registro ?? row.data_emissao ?? null,
            data_vencimento: row.data_vencimento ?? null,
            data_pagamento: typeof dataPag === "string" ? dataPag : null,
            status: paymentStatus.label,
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
  }, [effectiveErpType, session, sapDocEntry, sapDocNum, companyDb, supplierCode]);

  // v7: consolida PaidToDate e baixas vinculadas para status total/parcial.
  const cacheKey =
    effectiveErpType === "sap" && sapDocEntry
      ? `relmap:ap:sap:v7:${sapDocEntry}`
      : effectiveErpType === "omie" && (sapDocNum || supplierCode)
        ? `relmap:ap:omie:v2:${sapDocNum || ""}:${supplierCode || ""}`
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
    enabled: enabled && !!companyDb && (effectiveErpType === "sap" || effectiveErpType === "omie"),
  });
}
