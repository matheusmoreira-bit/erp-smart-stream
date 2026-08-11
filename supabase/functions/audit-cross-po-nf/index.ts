// Edge function: audit-cross-po-nf
// Cruzamento Pedido de Compra (SAP) × NF de Entrada (SAP) × Nota capturada (MasterTax).
// Retorna três listas:
//   A (erp)       -> PC lançado sem NF de Entrada no SAP e/ou sem nota capturada no MasterTax
//   B (ambos)     -> PC com NF de Entrada vinculada no SAP E nota capturada no MasterTax
//   C (mastertax) -> nota capturada no MasterTax sem lançamento no SAP e/ou sem PC vinculado
//
// Somente leitura (nada é persistido).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { authErrorResponse, requireAdminOrSapSession } from "../_shared/auth.ts";

interface Body {
  company_db?: string;
  periodo_inicio?: string;
  periodo_fim?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const isoDate = (v?: string) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    await requireAdminOrSapSession(req);
  } catch (e) {
    return authErrorResponse(e, corsHeaders);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const companyDb = (body.company_db || "").trim();
    const inicio = isoDate(body.periodo_inicio);
    const fim = isoDate(body.periodo_fim);
    if (!companyDb || !inicio || !fim) {
      return json({ error: "company_db, periodo_inicio e periodo_fim (YYYY-MM-DD) são obrigatórios" }, 400);
    }

    // 1) Pedidos de compra do período
    const { data: pos, error: poErr } = await sb
      .from("sap_purchase_order_cache")
      .select("doc_entry, doc_num, card_code, card_name, doc_date, doc_total, doc_currency, document_status, cancelled")
      .eq("company_db", companyDb)
      .gte("doc_date", inicio)
      .lte("doc_date", fim)
      .limit(5000);
    if (poErr) throw poErr;
    const pedidos = (pos || []).filter((p) => (p.cancelled ?? "tNO") !== "tYES");

    // 2) NF de Entrada lançadas no SAP (janela ampliada: NF pode vir depois do período do PC)
    const fimNf = new Date(new Date(fim).getTime() + 90 * 86400000).toISOString().slice(0, 10);
    const { data: nfs, error: nfErr } = await sb
      .from("sap_nf_entrada_cache")
      .select("doc_entry, doc_num, card_code, card_name, doc_date, doc_total, base_po_doc_entry, cancelled")
      .eq("company_db", companyDb)
      .gte("doc_date", inicio)
      .lte("doc_date", fimNf)
      .limit(8000);
    if (nfErr) throw nfErr;
    const notasSap = (nfs || []).filter((n) => (n.cancelled ?? "tNO") !== "tYES");
    const nfByPo = new Map<number, typeof notasSap[number]>();
    const nfByEntry = new Map<number, typeof notasSap[number]>();
    for (const n of notasSap) {
      if (typeof n.base_po_doc_entry === "number") nfByPo.set(n.base_po_doc_entry, n);
      nfByEntry.set(n.doc_entry, n);
    }

    // 3) Notas capturadas pelo MasterTax
    const { data: mtRaw, error: mtErr } = await sb
      .from("nf_entrada_imports")
      .select(
        "id, numero_nf, serie, chave_acesso, cnpj_fornecedor, nome_fornecedor, data_emissao, valor_total, status, sap_matched_po_doc_entry, sap_matched_po_is_draft, sap_matched_card_code, erp_invoice_doc_entry, erp_invoice_posted",
      )
      .eq("sap_company_db", companyDb)
      .gte("data_emissao", inicio)
      .lte("data_emissao", fim)
      .limit(5000);
    if (mtErr) throw mtErr;
    const mastertax = mtRaw || [];

    // Índices MasterTax por PC e por NF do SAP
    const mtByPo = new Map<number, typeof mastertax[number]>();
    const mtByNfEntry = new Map<number, typeof mastertax[number]>();
    for (const m of mastertax) {
      if (typeof m.sap_matched_po_doc_entry === "number" && !m.sap_matched_po_is_draft) {
        mtByPo.set(m.sap_matched_po_doc_entry, m);
      }
      if (typeof m.erp_invoice_doc_entry === "number") mtByNfEntry.set(m.erp_invoice_doc_entry, m);
    }

    const colunaA: unknown[] = [];
    const colunaB: unknown[] = [];
    const usadosMt = new Set<string>();

    for (const p of pedidos) {
      const nf = nfByPo.get(p.doc_entry) || null;
      const mt = mtByPo.get(p.doc_entry) || (nf ? mtByNfEntry.get(nf.doc_entry) || null : null);
      const row = {
        po_doc_entry: p.doc_entry,
        po_doc_num: p.doc_num,
        po_date: p.doc_date,
        po_total: p.doc_total,
        po_currency: p.doc_currency,
        po_status: p.document_status,
        card_code: p.card_code,
        card_name: p.card_name,
        nf_doc_entry: nf?.doc_entry ?? null,
        nf_doc_num: nf?.doc_num ?? null,
        nf_date: nf?.doc_date ?? null,
        nf_total: nf?.doc_total ?? null,
        mastertax_id: mt?.id ?? null,
        mastertax_numero: mt?.numero_nf ?? null,
        mastertax_chave: mt?.chave_acesso ?? null,
        mastertax_valor: mt?.valor_total ?? null,
        mastertax_status: mt?.status ?? null,
        cnpj_fornecedor: mt?.cnpj_fornecedor ?? null,
        motivo: !nf && !mt
          ? "PC sem NF de Entrada no SAP e sem nota capturada"
          : !nf
          ? "PC sem NF de Entrada lançada no SAP"
          : "NF lançada no SAP, mas nota não capturada pelo MasterTax",
      };
      if (mt) usadosMt.add(mt.id);
      if (nf && mt) colunaB.push({ ...row, motivo: "PC com NF de Entrada vinculada e nota capturada" });
      else colunaA.push(row);
    }

    // 4) Coluna C — MasterTax sem lançamento no SAP e/ou sem PC vinculado
    const colunaC = mastertax
      .filter((m) => !usadosMt.has(m.id))
      .filter((m) => {
        const temPc = typeof m.sap_matched_po_doc_entry === "number" && !m.sap_matched_po_is_draft;
        const lancada = !!m.erp_invoice_posted || typeof m.erp_invoice_doc_entry === "number";
        return !temPc || !lancada;
      })
      .map((m) => ({
        mastertax_id: m.id,
        mastertax_numero: m.numero_nf,
        mastertax_serie: m.serie,
        mastertax_chave: m.chave_acesso,
        mastertax_valor: m.valor_total,
        mastertax_status: m.status,
        data_emissao: m.data_emissao,
        cnpj_fornecedor: m.cnpj_fornecedor,
        card_name: m.nome_fornecedor,
        card_code: m.sap_matched_card_code,
        po_doc_entry: typeof m.sap_matched_po_doc_entry === "number" ? m.sap_matched_po_doc_entry : null,
        nf_doc_entry: m.erp_invoice_doc_entry ?? null,
        motivo: typeof m.sap_matched_po_doc_entry !== "number"
          ? "Nota capturada sem pedido de compra vinculado"
          : "Nota vinculada a PC, mas sem NF de Entrada lançada no SAP",
      }));

    return json({
      ok: true,
      company_db: companyDb,
      periodo: { inicio, fim },
      totais: {
        pedidos: pedidos.length,
        nf_sap: notasSap.length,
        mastertax: mastertax.length,
        a: colunaA.length,
        b: colunaB.length,
        c: colunaC.length,
      },
      erp: colunaA,
      ambos: colunaB,
      mastertax: colunaC,
    });
  } catch (e) {
    console.error("[audit-cross-po-nf]", e);
    return json({ error: (e as Error).message }, 500);
  }
});
