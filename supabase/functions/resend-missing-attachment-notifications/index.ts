// Backfill: reenvia por email as notificações de despesas integradas ao SAP
// SEM anexo (contingência), para leonardo.oliveira@anagaming.com.br e fiscal@.
// Uma mensagem por documento, com links assinados dos anexos internos (7 dias).
//
// POST /functions/v1/resend-missing-attachment-notifications
// Body opcional: { dry_run?: boolean, expense_ids?: string[], recipients?: string[] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_RECIPIENTS = [
  "leonardo.oliveira@anagaming.com.br",
  "fiscal@anagaming.com.br",
];

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtMoney(n: number | null | undefined, currency: string | null | undefined) {
  const cur = (currency || "BRL").trim();
  if (n == null) return "-";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(Number(n));
  } catch {
    return `${cur} ${Number(n).toFixed(2)}`;
  }
}

async function getSignedLinks(
  supabase: ReturnType<typeof createClient>,
  expenseId: string,
): Promise<Array<{ file_name: string; url: string }>> {
  const { data: rows } = await supabase
    .from("expense_attachments")
    .select("file_name, file_path")
    .eq("expense_id", expenseId);
  if (!rows || rows.length === 0) return [];
  const ttl = 60 * 60 * 24 * 7;
  const out: Array<{ file_name: string; url: string }> = [];
  for (const r of rows as Array<{ file_name: string; file_path: string }>) {
    if (!r?.file_path) continue;
    const { data, error } = await supabase.storage.from("expense-attachments").createSignedUrl(r.file_path, ttl);
    if (!error && data?.signedUrl) {
      out.push({ file_name: r.file_name || r.file_path.split("/").pop() || "anexo", url: data.signedUrl });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = Boolean(body.dry_run);
    const recipients: string[] = Array.isArray(body.recipients) && body.recipients.length > 0
      ? body.recipients
      : DEFAULT_RECIPIENTS;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let q = supabase
      .from("expenses")
      .select("id, supplier_name, supplier_code, total_amount, currency, company_db, sap_doc_entry, sap_doc_num, requester_name, requester_email, doc_date, due_date, sap_integration_last_attempt_at, remarks, origin, cost_center, project, sap_attachment_status")
      .not("sap_doc_entry", "is", null)
      .is("sap_attachment_entry", null)
      .order("sap_integration_last_attempt_at", { ascending: false });

    if (Array.isArray(body.expense_ids) && body.expense_ids.length > 0) {
      q = q.in("id", body.expense_ids);
    }

    const { data: rows, error } = await q;
    if (error) throw error;

    const results: Array<{ id: string; ok: boolean; error?: string; attachments: number }> = [];

    for (const e of (rows || []) as any[]) {
      const atts = await getSignedLinks(supabase, e.id);
      const amountStr = fmtMoney(e.total_amount, e.currency);
      const reasonLabel = e.sap_attachment_status === "not_applicable"
        ? "Integração de anexos desligada para a empresa (lançamento manual necessário)"
        : "Pedido integrado sem anexo vinculado no SAP";

      const subject = `[SEM ANEXO — REENVIO] Despesa integrada ao SAP — ${e.supplier_name || "-"} (DocNum ${e.sap_doc_num ?? "-"})`;

      const attsHtml = atts.length > 0
        ? `<h4 style="margin:12px 0 6px">Anexos internos (${atts.length}) — links válidos por 7 dias</h4>
           <ul style="padding-left:18px;margin:0">${atts
             .map((a) => `<li><a href="${esc(a.url)}">${esc(a.file_name)}</a></li>`).join("")}</ul>`
        : `<p style="color:#a00;margin:8px 0">Nenhum anexo interno disponível.</p>`;

      const html = `
        <div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
          <p style="background:#fff3cd;border:1px solid #ffe69c;padding:10px 12px;border-radius:6px;margin:0 0 12px">
            <strong>⚠️ Reenvio — Despesa integrada ao SAP sem anexo do documento original.</strong><br>
            ${esc(reasonLabel)}. Providencie o lançamento manual do anexo no pedido do SAP.
          </p>
          <table style="border-collapse:collapse">
            <tr><td style="padding:4px 10px;color:#666">Empresa</td><td style="padding:4px 10px">${esc(e.company_db || "-")}</td></tr>
            <tr><td style="padding:4px 10px;color:#666">SAP DocNum</td><td style="padding:4px 10px">${e.sap_doc_num ?? "-"}</td></tr>
            <tr><td style="padding:4px 10px;color:#666">SAP DocEntry</td><td style="padding:4px 10px">${e.sap_doc_entry ?? "-"}</td></tr>
            <tr><td style="padding:4px 10px;color:#666">Fornecedor</td><td style="padding:4px 10px"><strong>${esc(e.supplier_name || "-")}</strong>${e.supplier_code ? ` (${esc(e.supplier_code)})` : ""}</td></tr>
            <tr><td style="padding:4px 10px;color:#666">Valor</td><td style="padding:4px 10px"><strong>${esc(amountStr)}</strong></td></tr>
            <tr><td style="padding:4px 10px;color:#666">Data</td><td style="padding:4px 10px">${esc(e.doc_date || "-")}${e.due_date ? ` · venc. ${esc(e.due_date)}` : ""}</td></tr>
            <tr><td style="padding:4px 10px;color:#666">Solicitante</td><td style="padding:4px 10px">${esc(e.requester_name || "-")}${e.requester_email ? ` · ${esc(e.requester_email)}` : ""}</td></tr>
            <tr><td style="padding:4px 10px;color:#666">Centro de custo</td><td style="padding:4px 10px">${esc(e.cost_center || "-")}</td></tr>
            <tr><td style="padding:4px 10px;color:#666">Projeto</td><td style="padding:4px 10px">${esc(e.project || "-")}</td></tr>
            <tr><td style="padding:4px 10px;color:#666">Integrado em</td><td style="padding:4px 10px">${esc(e.sap_integration_last_attempt_at || "-")}</td></tr>
            <tr><td style="padding:4px 10px;color:#666">ID interno</td><td style="padding:4px 10px">${esc(e.id)}</td></tr>
          </table>
          ${attsHtml}
        </div>
      `;

      const textLines = [
        "Reenvio — Despesa integrada ao SAP sem anexo do documento original.",
        reasonLabel,
        "",
        `Empresa: ${e.company_db || "-"}`,
        `SAP DocNum: ${e.sap_doc_num ?? "-"} / DocEntry: ${e.sap_doc_entry ?? "-"}`,
        `Fornecedor: ${e.supplier_name || "-"}${e.supplier_code ? ` (${e.supplier_code})` : ""}`,
        `Valor: ${amountStr}`,
        `Data: ${e.doc_date || "-"}${e.due_date ? ` (venc. ${e.due_date})` : ""}`,
        `Solicitante: ${e.requester_name || "-"}${e.requester_email ? ` (${e.requester_email})` : ""}`,
        `Centro de custo: ${e.cost_center || "-"}`,
        `Projeto: ${e.project || "-"}`,
        `Integrado em: ${e.sap_integration_last_attempt_at || "-"}`,
        `ID interno: ${e.id}`,
        "",
        atts.length > 0 ? "Anexos internos (links por 7 dias):" : "Nenhum anexo interno disponível.",
        ...atts.map((a) => `- ${a.file_name}: ${a.url}`),
      ];

      if (dryRun) {
        results.push({ id: e.id, ok: true, attachments: atts.length });
        continue;
      }

      const { error: sendErr } = await supabase.functions.invoke("send-smtp-email", {
        body: {
          to: recipients,
          replyTo: e.requester_email || undefined,
          subject,
          html,
          text: textLines.join("\n"),
        },
      });
      results.push({
        id: e.id,
        ok: !sendErr,
        error: sendErr ? String(sendErr.message || sendErr) : undefined,
        attachments: atts.length,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        dryRun,
        recipients,
        total: results.length,
        sent: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
