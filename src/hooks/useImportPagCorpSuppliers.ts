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
    by: "tax_id" | "name";
    card_code?: string | null;
    card_name?: string | null;
  };
  /** AI extraction failed for this transaction */
  aiFailed?: boolean;
  aiError?: string;
}

export interface ScanProgress {
  stage: "fetching" | "extracting" | "done";
  current: number;
  total: number;
}

function cleanDigits(s?: string | null): string {
  return (s || "").replace(/\D/g, "");
}

function normalizeName(s?: string | null): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Scans the last 30 days of PagCorp transactions that have accountability
 * (receipts), extracts supplier data via AI for each, and classifies them
 * as "new" or "already exists" against the current supplier list.
 *
 * Dedup criteria: matches by CNPJ/CPF (digits only) OR by normalized name.
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

      // Only transactions that have receipts (accountability)
      const withReceipts = items.filter(
        (t) => Array.isArray(t.receipts) && t.receipts.length > 0,
      );

      // 3) Run AI extraction sequentially (avoids hammering the gateway)
      const results: PagCorpCandidate[] = [];
      // Track candidates already added in this scan to avoid duplicates among
      // multiple transactions that point to the same supplier.
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

          // Dedup against existing suppliers
          let existingMatch:
            | PagCorpCandidate["existingMatch"]
            | undefined;
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

          // Skip duplicates already collected in this scan
          if (!existingMatch) {
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
