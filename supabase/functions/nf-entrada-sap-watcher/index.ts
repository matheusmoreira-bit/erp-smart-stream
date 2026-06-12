// Edge function: nf-entrada-sap-watcher
// Polling periódico: para cada NF com status awaiting_sap, consulta o Draft
// de Pedido de Compra no SAP. Se aprovado, cria o esboço (Draft) de NF de
// Entrada (PurchaseInvoice). Se rejeitado, marca como sap_rejected.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface NfRow {
  id: string;
  chave_acesso: string;
  sap_company_db: string | null;
  sap_po_draft_id: string | null;
  sap_invoice_draft_id: string | null;
  itens: Array<Record<string, unknown>>;
  impostos: Record<string, unknown>;
}

function buildBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function sapLogin(baseUrl: string, companyDB: string, u: string, p: string): Promise<string> {
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: u, Password: p, CompanyDB: companyDB }),
  });
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}`);
  await r.json();
  const sc = r.headers.get("set-cookie") || "";
  const s = sc.match(/B1SESSION=([^;]+)/)?.[1];
  const rt = sc.match(/ROUTEID=([^;]+)/)?.[1];
  if (!s) throw new Error("B1SESSION ausente");
  return `B1SESSION=${s}${rt ? `; ROUTEID=${rt}` : ""}`;
}

async function loadCreds(sb: ReturnType<typeof createClient>, companyDb: string) {
  const { data, error } = await sb
    .from("system_credentials")
    .select("config")
    .eq("system", "sap")
    .eq("company_db", companyDb)
    .maybeSingle();
  if (error || !data) throw new Error(`Credenciais SAP ausentes para ${companyDb}`);
  return data.config as Record<string, string>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: rows, error } = await sb
    .from("nf_entrada_imports")
    .select("*")
    .eq("status", "awaiting_sap")
    .limit(50);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }

  const results: Array<{ id: string; status: string; error?: string }> = [];

  // Agrupar por company_db para reaproveitar login
  const byCompany = new Map<string, NfRow[]>();
  for (const r of (rows || []) as NfRow[]) {
    if (!r.sap_company_db || !r.sap_po_draft_id) continue;
    const arr = byCompany.get(r.sap_company_db) || [];
    arr.push(r);
    byCompany.set(r.sap_company_db, arr);
  }

  for (const [companyDb, list] of byCompany) {
    let cookie = "";
    let baseUrl = "";
    try {
      const creds = await loadCreds(sb, companyDb);
      baseUrl = buildBaseUrl(creds.service_layer_url);
      cookie = await sapLogin(baseUrl, creds.company_db || companyDb, creds.username, creds.password);
    } catch (e) {
      for (const row of list) {
        results.push({ id: row.id, status: "skipped", error: (e as Error).message });
      }
      continue;
    }

    try {
      for (const row of list) {
        try {
          // Consultar Draft (PurchaseOrder)
          const dr = await fetch(
            `${baseUrl}/Drafts(${row.sap_po_draft_id})?$select=DocEntry,DocumentStatus,DocNum,Cancelled`,
            { headers: { Cookie: cookie } },
          );
          if (!dr.ok) throw new Error(`Consulta Draft falhou ${dr.status}`);
          const dj = await dr.json();

          // DocumentStatus: bost_Open / bost_Close ; quando vira documento real, sai de Drafts
          // Estratégia simples: se Draft sumiu/foi convertido (404) consideramos aprovado e procuramos o PO real
          // Para v1: se Cancelled = 'tYES' → sap_rejected
          if (dj.Cancelled === "tYES") {
            await sb.from("nf_entrada_imports").update({
              status: "sap_rejected",
              rejection_reason: "Draft cancelado no SAP",
              last_poll_at: new Date().toISOString(),
            }).eq("id", row.id);
            await sb.from("nf_entrada_logs").insert({
              import_id: row.id,
              step: "sap_status_check",
              status_to: "sap_rejected",
              message: "Draft cancelado no SAP",
              actor: "nf-entrada-sap-watcher",
            });
            results.push({ id: row.id, status: "sap_rejected" });
            continue;
          }

          if (dj.DocumentStatus === "bost_Close") {
            // Considerado aprovado/processado → cria Draft de Nota Fiscal de Entrada (PurchaseInvoice)
            const docLines = (row.itens || []).map((it) => ({
              BaseType: 22, // Purchase Order
              BaseEntry: Number(row.sap_po_draft_id),
              BaseLine: (it as Record<string, unknown>).LineNum ?? 0,
            }));

            const invResp = await fetch(`${baseUrl}/Drafts`, {
              method: "POST",
              headers: { Cookie: cookie, "Content-Type": "application/json" },
              body: JSON.stringify({
                DocObjectCode: "oPurchaseInvoices",
                CardCode: dj.CardCode,
                Comments: `NF Entrada chave ${row.chave_acesso}`,
                DocumentLines: docLines,
              }),
            });
            if (!invResp.ok) throw new Error(`Draft NF Entrada falhou ${invResp.status}: ${(await invResp.text()).slice(0, 300)}`);
            const invJson = await invResp.json();

            await sb.from("nf_entrada_imports").update({
              sap_invoice_draft_id: String(invJson.DocEntry),
              status: "completed",
              last_poll_at: new Date().toISOString(),
              last_error: null,
            }).eq("id", row.id);

            await sb.from("nf_entrada_logs").insert({
              import_id: row.id,
              step: "create_invoice_draft",
              status_to: "completed",
              message: `Draft NF Entrada criado: ${invJson.DocEntry}`,
              actor: "nf-entrada-sap-watcher",
            });
            results.push({ id: row.id, status: "completed" });
            continue;
          }

          await sb.from("nf_entrada_imports").update({
            last_poll_at: new Date().toISOString(),
          }).eq("id", row.id);
          results.push({ id: row.id, status: "awaiting_sap" });
        } catch (e) {
          const msg = (e as Error).message;
          await sb.from("nf_entrada_logs").insert({
            import_id: row.id,
            step: "sap_status_check",
            message: msg,
            actor: "nf-entrada-sap-watcher",
          });
          results.push({ id: row.id, status: "error", error: msg });
        }
      }
    } finally {
      await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
