// Helper compartilhado: registra vínculo entre uma NF de entrada (nf_entrada_imports)
// e um lançamento de Contas a Pagar no ERP (SAP PurchaseInvoice ou OMIE conta a pagar).
// Cardinalidade: 1 PO → N NF → N contas a pagar; portanto o upsert usa a chave
// (nf_import_id, source, ap_doc_entry) e mantém contador `settlement_ap_count`.

export interface LinkNfApArgs {
  nfImportId: string;
  source: "sap" | "omie";
  companyDb: string;
  apDocEntry: string | number;
  apDocNum?: string | number | null;
  apTotal?: number | null;
  apPaid?: number | null;
  apCurrency?: string | null;
  linkedBy?: string;
  notes?: string;
}

// deno-lint-ignore no-explicit-any
export async function linkNfToAp(sb: any, args: LinkNfApArgs): Promise<{ inserted: boolean; id?: string; error?: string }> {
  const payload = {
    nf_import_id: args.nfImportId,
    source: args.source,
    company_db: args.companyDb,
    ap_doc_entry: String(args.apDocEntry),
    ap_doc_num: args.apDocNum != null ? String(args.apDocNum) : null,
    ap_total: args.apTotal ?? null,
    ap_paid: args.apPaid ?? null,
    ap_currency: args.apCurrency ?? null,
    linked_by: args.linkedBy ?? "system",
    notes: args.notes ?? null,
  };

  const { data, error } = await sb
    .from("nf_entrada_contas_pagar")
    .upsert(payload, { onConflict: "nf_import_id,source,ap_doc_entry", ignoreDuplicates: false })
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn("[link-nf-ap] upsert falhou:", error.message);
    return { inserted: false, error: error.message };
  }

  // Recalcula o contador local (fonte de verdade continua sendo a tabela de vínculo).
  const { count } = await sb
    .from("nf_entrada_contas_pagar")
    .select("id", { count: "exact", head: true })
    .eq("nf_import_id", args.nfImportId);
  await sb
    .from("nf_entrada_imports")
    .update({ settlement_ap_count: count ?? 0 })
    .eq("id", args.nfImportId);

  return { inserted: true, id: data?.id };
}
