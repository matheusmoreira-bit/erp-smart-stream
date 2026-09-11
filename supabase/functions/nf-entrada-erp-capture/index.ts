// Edge function: nf-entrada-erp-capture
//
// Captura automática das NFs de Entrada já existentes no ERP.
//
// Objetivo: o usuário não precisa lançar manualmente cada nota. A partir do
// cache `sap_nf_entrada_cache` (alimentado por `sap-nf-entrada-sync`), esta
// função cria/atualiza o registro correspondente em `nf_entrada_imports` com
// número, série, subsérie, modelo e data do documento, além do vínculo com a
// despesa (pedido de compra) e do status do ERP.
//
// Segurança: apenas scheduler/serviço/admin. Toda leitura de ERP é feita pelo
// cache — nenhuma credencial é exposta ao cliente.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireSchedulerOrAdmin, serviceClient } from "../_shared/automation-auth.ts";
import { tryWatcherLock, releaseWatcherLock } from "../_shared/watcher-lock.ts";

const TIME_BUDGET_MS = 90_000;
const PAGE_SIZE = 500;

interface CacheRow {
  company_db: string;
  doc_entry: number;
  doc_num: number | null;
  series: number | null;
  card_code: string | null;
  card_name: string | null;
  doc_date: string | null;
  doc_due_date: string | null;
  tax_date: string | null;
  doc_total: number | null;
  paid_to_date: number | null;
  document_status: string | null;
  cancelled: string | null;
  base_po_doc_entry: number | null;
  series_string: string | null;
  sub_series_string: string | null;
  sequence_serial: string | null;
  sequence_model: string | null;
  folio_number: string | null;
}

/** Chave sintética estável para notas capturadas direto do ERP (sem XML). */
function erpKey(companyDb: string, docEntry: number): string {
  return `ERP:${companyDb}:${docEntry}`;
}

function numeroNf(row: CacheRow): string {
  return String(row.folio_number ?? row.sequence_serial ?? row.doc_num ?? row.doc_entry);
}

function serie(row: CacheRow): string | null {
  return row.series_string ?? (row.series != null ? String(row.series) : null);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;

  const sb = serviceClient();
  const gotLock = await tryWatcherLock(sb, "nf-entrada-erp-capture", 10);
  if (!gotLock) {
    return new Response(JSON.stringify({ ok: true, skipped: "another_run_in_progress" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  let created = 0;
  let updated = 0;
  let scanned = 0;
  let lastError: string | null = null;

  try {
    let offset = 0;
    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      const { data, error } = await sb
        .from("sap_nf_entrada_cache")
        .select(
          "company_db,doc_entry,doc_num,series,card_code,card_name,doc_date,doc_due_date,tax_date,doc_total,paid_to_date,document_status,cancelled,base_po_doc_entry,series_string,sub_series_string,sequence_serial,sequence_model,folio_number",
        )
        .not("base_po_doc_entry", "is", null)
        .order("doc_entry", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`cache: ${error.message}`);
      const rows = (data || []) as CacheRow[];
      if (rows.length === 0) break;
      scanned += rows.length;

      // Despesas (pedidos de compra) das empresas presentes na página.
      const companies = Array.from(new Set(rows.map((r) => r.company_db)));
      const poEntries = Array.from(
        new Set(rows.map((r) => r.base_po_doc_entry).filter((v): v is number => v != null)),
      );
      const { data: expenseRows } = await sb
        .from("expenses")
        .select("id,company_db,sap_doc_entry,supplier_code,supplier_name,cost_center")
        .in("company_db", companies)
        .in("sap_doc_entry", poEntries);
      const expenseByPo = new Map<string, {
        id: string;
        supplier_code: string | null;
        supplier_name: string | null;
        cost_center: string | null;
      }>();
      for (
        const e of (expenseRows || []) as Array<{
          id: string;
          company_db: string;
          sap_doc_entry: number;
          supplier_code: string | null;
          supplier_name: string | null;
          cost_center: string | null;
        }>
      ) {
        expenseByPo.set(`${e.company_db}:${e.sap_doc_entry}`, {
          id: e.id,
          supplier_code: e.supplier_code,
          supplier_name: e.supplier_name,
          cost_center: e.cost_center,
        });
      }

      // Registros já existentes: por chave sintética do ERP e pelo DocEntry da NF.
      const keys = rows.map((r) => erpKey(r.company_db, r.doc_entry));
      const docEntries = rows.map((r) => String(r.doc_entry));
      const { data: existingRows } = await sb
        .from("nf_entrada_imports")
        .select("id,chave_acesso,sap_company_db,erp_invoice_doc_entry,auto_captured,expense_id")
        .in("sap_company_db", companies)
        .or(`chave_acesso.in.(${keys.join(",")}),erp_invoice_doc_entry.in.(${docEntries.join(",")})`);
      const byKey = new Map<string, { id: string; auto_captured: boolean | null; expense_id: string | null }>();
      for (
        const x of (existingRows || []) as Array<{
          id: string;
          chave_acesso: string | null;
          sap_company_db: string | null;
          erp_invoice_doc_entry: string | null;
          auto_captured: boolean | null;
          expense_id: string | null;
        }>
      ) {
        const rec = { id: x.id, auto_captured: x.auto_captured, expense_id: x.expense_id };
        if (x.chave_acesso) byKey.set(`k:${x.sap_company_db}:${x.chave_acesso}`, rec);
        if (x.erp_invoice_doc_entry) byKey.set(`d:${x.sap_company_db}:${x.erp_invoice_doc_entry}`, rec);
      }

      for (const row of rows) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) break;
        const po = row.base_po_doc_entry;
        if (po == null) continue;
        const expense = expenseByPo.get(`${row.company_db}:${po}`);
        if (!expense) continue; // NF do ERP sem pedido do Flow: fora do escopo.

        const cancelled = row.cancelled === "tYES";
        const erpFields = {
          erp_invoice_posted: true,
          erp_invoice_doc_entry: String(row.doc_entry),
          erp_invoice_doc_num: row.doc_num != null ? String(row.doc_num) : null,
          erp_invoice_doc_date: row.doc_date,
          erp_invoice_doc_status: row.document_status,
          erp_invoice_cancelled: cancelled,
          erp_invoice_open_amount: row.doc_total != null && row.paid_to_date != null
            ? Number(row.doc_total) - Number(row.paid_to_date)
            : null,
          erp_invoice_status_synced_at: new Date().toISOString(),
        };
        const fiscalFields = {
          numero_nf: numeroNf(row),
          serie: serie(row),
          subserie: row.sub_series_string,
          modelo: row.sequence_model ?? "55",
          data_emissao: row.tax_date ?? row.doc_date,
          valor_total: row.doc_total,
        };

        const existing = byKey.get(`d:${row.company_db}:${row.doc_entry}`)
          ?? byKey.get(`k:${row.company_db}:${erpKey(row.company_db, row.doc_entry)}`);

        if (existing) {
          // Registro manual/MasterTax existente: só completa o estado do ERP,
          // sem sobrescrever os dados fiscais informados pelo usuário.
          const patch: Record<string, unknown> = { ...erpFields };
          if (existing.auto_captured) Object.assign(patch, fiscalFields);
          if (!existing.expense_id) patch.expense_id = expense.id;
          if (!cancelled) patch.status = "completed";
          const { error: upErr } = await sb.from("nf_entrada_imports").update(patch).eq("id", existing.id);
          if (upErr) { lastError = upErr.message; continue; }
          updated += 1;
          continue;
        }

        const { data: inserted, error: insErr } = await sb
          .from("nf_entrada_imports")
          .insert({
            chave_acesso: erpKey(row.company_db, row.doc_entry),
            sap_company_db: row.company_db,
            expense_id: expense.id,
            cost_center: expense.cost_center,
            nome_fornecedor: row.card_name ?? expense.supplier_name,
            sap_matched_card_code: row.card_code ?? expense.supplier_code,
            sap_matched_po_doc_entry: String(po),
            sap_match_reason: "erp_auto_capture",
            auto_captured: true,
            status: cancelled ? "cancelled" : "completed",
            ...fiscalFields,
            ...erpFields,
          })
          .select("id")
          .maybeSingle();
        if (insErr) {
          // Conflito com registro concorrente: ignora, a próxima rodada atualiza.
          if (!/duplicate key/i.test(insErr.message)) lastError = insErr.message;
          continue;
        }
        created += 1;
        if (inserted?.id) {
          await sb.from("nf_entrada_logs").insert({
            import_id: inserted.id,
            step: "erp_auto_capture",
            status_to: cancelled ? "cancelled" : "completed",
            message:
              `NF ${fiscalFields.numero_nf}${fiscalFields.serie ? `/${fiscalFields.serie}` : ""} (modelo ${fiscalFields.modelo}) capturada automaticamente do ERP para o PC ${po}`,
            actor: "nf-entrada-erp-capture",
            payload: { doc_entry: row.doc_entry, doc_num: row.doc_num, po_doc_entry: po },
          });
        }
      }

      offset += rows.length;
      if (rows.length < PAGE_SIZE) break;
    }
  } catch (e) {
    lastError = (e as Error).message;
  }

  await releaseWatcherLock(
    sb,
    "nf-entrada-erp-capture",
    lastError ? "error" : "ok",
    `scanned=${scanned} created=${created} updated=${updated}${lastError ? ` err=${lastError}` : ""}`,
  );

  return new Response(
    JSON.stringify({ ok: !lastError, scanned, created, updated, error: lastError }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
