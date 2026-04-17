import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { authFetch } from "@/lib/auth-fetch";
import type { Supplier } from "@/hooks/useSuppliers";

export interface PagCorpCandidate {
  /** Stable client-side id (tx id + index) */
  key: string;
  /** Source PagCorp transaction id */
  transactionId: string | number;
  transactionDate: string;
  transactionDescription: string;
  transactionAmount: number;
  /** Extracted supplier data via AI */
  card_name: string;
  federal_tax_id: string | null;
  email?: string | null;
  phone1?: string | null;
  phone2?: string | null;
  bill_to_street?: string | null;
  bill_to_zip?: string | null;
  bill_to_city?: string | null;
  bill_to_state?: string | null;
  bill_to_block?: string | null;
  bill_to_building?: string | null;
  /** Result of dedup against existing suppliers */
  existing: boolean;
  existingMatch?: {
    by: "tax_id" | "name" | "saved_link";
    card_code?: string | null;
    card_name?: string | null;
  };
  /** Persistent decision saved in pagcorp_supplier_links */
  savedResolution?: "imported" | "linked" | "ignored";
  /** AI extraction failed for this transaction */
  aiFailed?: boolean;
  aiError?: string;
}

export interface ScanProgress {
  stage: "fetching" | "extracting" | "done";
  current: number;
  total: number;
}

export interface PagCorpSupplierLink {
  id: string;
  company_db: string | null;
  federal_tax_id: string | null;
  card_name_key: string | null;
  supplier_id: string | null;
  card_code: string | null;
  card_name: string | null;
  resolution: "imported" | "linked" | "ignored";
}

export function cleanDigits(s?: string | null): string {
  return (s || "").replace(/\D/g, "");
}

export function normalizeName(s?: string | null): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Upsert a decision (link / import / ignore) so future scans skip it. */
export async function savePagCorpSupplierLink(input: {
  companyDb: string | null;
  federalTaxId: string | null;
  cardName: string | null;
  supplierId?: string | null;
  cardCode?: string | null;
  resolution: "imported" | "linked" | "ignored";
  resolvedBy?: string | null;
}) {
  const tax = cleanDigits(input.federalTaxId) || null;
  const nameKey = normalizeName(input.cardName) || null;
  const { error } = await (supabase as any).from("pagcorp_supplier_links").insert({
    company_db: input.companyDb,
    federal_tax_id: tax,
    card_name_key: nameKey,
    supplier_id: input.supplierId || null,
    card_code: input.cardCode || null,
    card_name: input.cardName || null,
    resolution: input.resolution,
    resolved_by: input.resolvedBy || null,
  });
  if (error) throw error;
}

/**
 * Scans the last 30 days of PagCorp transactions that have accountability
 * (receipts), extracts supplier data via AI for each, and classifies them
 * as "new", "already exists" (against the supplier list) or "previously
 * resolved" (against pagcorp_supplier_links).
 */
export function useImportPagCorpSuppliers(
  companyDb: string | undefined,
  existingSuppliers: Supplier[],
) {
  const [candidates, setCandidates] = useState<PagCorpCandidate[]>([]);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    if (!companyDb) {
      setError("Empresa não selecionada");
      return;
    }
    setScanning(true);
    setError(null);
    setCandidates([]);

    try {
      // 1) Build dedup index from current supplier list (SAP cache + local)
      const taxIndex = new Map<string, Supplier>();
      const nameIndex = new Map<string, Supplier>();
      for (const s of existingSuppliers) {
        const tax = cleanDigits(s.federal_tax_id);
        if (tax) taxIndex.set(tax, s);
        const name = normalizeName(s.card_name);
        if (name) nameIndex.set(name, s);
      }

      // 1b) Load persisted PagCorp -> supplier mappings
      const { data: linksData } = await (supabase as any)
        .from("pagcorp_supplier_links")
        .select("*")
        .eq("company_db", companyDb);
      const links = (linksData || []) as PagCorpSupplierLink[];
      const linkByTax = new Map<string, PagCorpSupplierLink>();
      const linkByName = new Map<string, PagCorpSupplierLink>();
      for (const l of links) {
        if (l.federal_tax_id) linkByTax.set(l.federal_tax_id, l);
        if (l.card_name_key) linkByName.set(l.card_name_key, l);
      }

      // 2) Fetch PagCorp transactions of the last 30 days
      setProgress({ stage: "fetching", current: 0, total: 0 });
      const today = new Date();
      const start = new Date(today);
      start.setDate(start.getDate() - 30);
      const params = new URLSearchParams({
        startDate: start.toISOString().slice(0, 10),
        endDate: today.toISOString().slice(0, 10),
        companyDb,
      });
      const res = await authFetch(`pagcorp-proxy?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Erro ${res.status} ao buscar PagCorp`);
      }
      const result = await res.json();
      const items: any[] = result.items || [];

      const withReceipts = items.filter(
        (t) => Array.isArray(t.receipts) && t.receipts.length > 0,
      );

      const results: PagCorpCandidate[] = [];
      const seenTax = new Set<string>();
      const seenName = new Set<string>();

      for (let i = 0; i < withReceipts.length; i++) {
        const tx = withReceipts[i];
        setProgress({ stage: "extracting", current: i + 1, total: withReceipts.length });

        const txId = tx.id || tx.expenseId || i;
        const txDate = tx.eventDate || tx.date || tx.expenseDate || tx.createdAt || "";
        const txDesc = tx.description || tx.expenseDescription || "—";
        const txAmount = Number(tx.amount || tx.value || tx.expenseValue || 0);

        try {
          const { data, error: fnErr } = await supabase.functions.invoke(
            "supplier-ai-extract",
            {
              body: {
                description: txDesc,
                amount: txAmount,
                receipts: tx.receipts || [],
                attachments: (tx.attachments || []).slice(0, 5),
                hint: tx.accountName || tx.accountAlias,
              },
            },
          );
          if (fnErr) throw fnErr;

          const extracted = (data as any)?.supplier;
          if (!extracted?.card_name) {
            results.push({
              key: `${txId}-${i}`,
              transactionId: txId,
              transactionDate: txDate,
              transactionDescription: txDesc,
              transactionAmount: txAmount,
              card_name: "(não identificado)",
              federal_tax_id: null,
              existing: false,
              aiFailed: true,
              aiError: "IA não identificou fornecedor",
            });
            continue;
          }

          const tax = cleanDigits(extracted.federal_tax_id);
          const nameKey = normalizeName(extracted.card_name);

          // Saved decision wins
          const savedLink =
            (tax ? linkByTax.get(tax) : undefined) ||
            (nameKey ? linkByName.get(nameKey) : undefined);

          let existingMatch: PagCorpCandidate["existingMatch"] | undefined;
          let savedResolution: PagCorpCandidate["savedResolution"];

          if (savedLink) {
            savedResolution = savedLink.resolution;
            if (savedLink.resolution === "linked" || savedLink.resolution === "imported") {
              existingMatch = {
                by: "saved_link",
                card_code: savedLink.card_code,
                card_name: savedLink.card_name,
              };
            }
          } else {
            const taxHit = tax ? taxIndex.get(tax) : undefined;
            if (taxHit) {
              existingMatch = {
                by: "tax_id",
                card_code: taxHit.card_code,
                card_name: taxHit.card_name,
              };
            } else {
              const nameHit = nameKey ? nameIndex.get(nameKey) : undefined;
              if (nameHit) {
                existingMatch = {
                  by: "name",
                  card_code: nameHit.card_code,
                  card_name: nameHit.card_name,
                };
              }
            }
          }

          if (!existingMatch && !savedResolution) {
            if (tax && seenTax.has(tax)) continue;
            if (!tax && nameKey && seenName.has(nameKey)) continue;
            if (tax) seenTax.add(tax);
            if (nameKey) seenName.add(nameKey);
          }

          results.push({
            key: `${txId}-${i}`,
            transactionId: txId,
            transactionDate: txDate,
            transactionDescription: txDesc,
            transactionAmount: txAmount,
            card_name: extracted.card_name,
            federal_tax_id: tax || null,
            email: extracted.email || null,
            phone1: extracted.phone1 || null,
            phone2: extracted.phone2 || null,
            bill_to_street: extracted.bill_to_street || null,
            bill_to_zip: extracted.bill_to_zip || null,
            bill_to_city: extracted.bill_to_city || null,
            bill_to_state: extracted.bill_to_state || null,
            bill_to_block: extracted.bill_to_block || null,
            bill_to_building: extracted.bill_to_building || null,
            existing: !!existingMatch,
            existingMatch,
            savedResolution,
          });
        } catch (e) {
          results.push({
            key: `${txId}-${i}`,
            transactionId: txId,
            transactionDate: txDate,
            transactionDescription: txDesc,
            transactionAmount: txAmount,
            card_name: "(falha na extração)",
            federal_tax_id: null,
            existing: false,
            aiFailed: true,
            aiError: e instanceof Error ? e.message : "Erro desconhecido",
          });
        }
      }

      setCandidates(results);
      setProgress({ stage: "done", current: results.length, total: withReceipts.length });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao escanear PagCorp");
    } finally {
      setScanning(false);
    }
  }, [companyDb, existingSuppliers]);

  return { candidates, progress, scanning, error, scan, setCandidates };
}
