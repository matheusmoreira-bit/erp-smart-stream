// Edge function: nf-entrada-invoice-draft
// Cria manualmente o esboço (Draft) de NF de Entrada (oPurchaseInvoices) no SAP B1
// para uma NF capturada pela Master Tax que já está vinculada a um Pedido de Compra
// e ainda não teve a NF de entrada lançada.
//
// Idempotente: se sap_invoice_draft_id já existir, devolve o valor sem criar de novo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getIntegrationPause, pauseResponse } from "../_shared/integration-pause.ts";

interface NfRow {
  id: string;
  chave_acesso: string;
  status: string;
  sap_company_db: string | null;
  sap_po_draft_id: string | null;
  sap_invoice_draft_id: string | null;
  sap_matched_po_doc_entry: string | null;
  sap_matched_po_is_draft: boolean | null;
  sap_matched_card_code: string | null;
}

function buildBaseUrl(raw: string): string {
  let url = (raw || "").replace(/\/+$/, "");
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
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (error) throw new Error(`Credenciais SAP erro: ${error.message}`);
  const kv: Record<string, string> = {};
  for (const r of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
    kv[r.credential_key] = r.credential_value ?? "";
  }
  if (!kv.service_layer_url || !kv.username || !kv.password) {
    throw new Error(`Credenciais SAP ausentes para ${companyDb}`);
  }
  return kv;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  { const _pause = await getIntegrationPause("sap_b1"); if (_pause) return pauseResponse(_pause, corsHeaders); }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { import_id?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  if (!body.import_id) return json(400, { error: "import_id é obrigatório" });

  const actor = req.headers.get("x-sap-user") || "nf-entrada-invoice-draft";

  const { data, error } = await sb
    .from("nf_entrada_imports")
    .select("*")
    .eq("id", body.import_id)
    .maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!data) return json(404, { error: "NF não encontrada" });

  const row = data as unknown as NfRow;

  if (row.sap_invoice_draft_id) {
    return json(200, { ok: true, alreadyExists: true, draftId: row.sap_invoice_draft_id });
  }
  if (row.status === "cancelled") return json(409, { error: "NF cancelada — não é possível lançar esboço." });
  if (!row.sap_company_db) return json(409, { error: "NF sem base SAP definida." });

  // Só cria a partir de um PC efetivo (não esboço) vinculado.
  const poEntry = Number(row.sap_matched_po_doc_entry ?? NaN);
  if (!Number.isFinite(poEntry) || row.sap_matched_po_is_draft !== false) {
    return json(409, {
      error: "É necessário um Pedido de Compra efetivo vinculado no SAP (esboços não podem ser faturados).",
    });
  }

  let baseUrl = "";
  let cookie = "";
  try {
    const creds = await loadCreds(sb, row.sap_company_db);
    baseUrl = buildBaseUrl(creds.service_layer_url);
    cookie = await sapLogin(baseUrl, creds.company_db || row.sap_company_db, creds.username, creds.password);
  } catch (e) {
    return json(502, { error: (e as Error).message });
  }

  try {
    const poR = await fetch(
      `${baseUrl}/PurchaseOrders(${poEntry})?$select=DocEntry,CardCode,DocumentStatus,DocumentLines`,
      { headers: { Cookie: cookie } },
    );
    if (!poR.ok) throw new Error(`Consulta do PC ${poEntry} falhou ${poR.status}`);
    const po = await poR.json();

    const lines = Array.isArray(po.DocumentLines) && po.DocumentLines.length
      ? po.DocumentLines.map((l: Record<string, unknown>) => ({
          BaseType: 22,
          BaseEntry: poEntry,
          BaseLine: l.LineNum ?? 0,
        }))
      : [{ BaseType: 22, BaseEntry: poEntry, BaseLine: 0 }];

    const invResp = await fetch(`${baseUrl}/Drafts`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        DocObjectCode: "oPurchaseInvoices",
        CardCode: po.CardCode || row.sap_matched_card_code,
        Comments: `NF Entrada chave ${row.chave_acesso} (vinculada PC #${poEntry})`,
        DocumentLines: lines,
      }),
    });
    if (!invResp.ok) {
      throw new Error(`Draft NF Entrada falhou ${invResp.status}: ${(await invResp.text()).slice(0, 300)}`);
    }
    const invJson = await invResp.json();
    const draftId = String(invJson.DocEntry);

    await sb.from("nf_entrada_imports").update({
      sap_invoice_draft_id: draftId,
      status: "completed",
      last_error: null,
    }).eq("id", row.id);

    await sb.from("nf_entrada_logs").insert({
      import_id: row.id,
      step: "create_invoice_draft",
      status_from: row.status,
      status_to: "completed",
      message: `Esboço de NF de Entrada criado manualmente vinculado ao PC ${poEntry}: Draft ${draftId}`,
      actor,
    });

    return json(200, { ok: true, draftId, poEntry });
  } catch (e) {
    const msg = (e as Error).message;
    await sb.from("nf_entrada_imports").update({ last_error: msg }).eq("id", row.id);
    await sb.from("nf_entrada_logs").insert({
      import_id: row.id,
      step: "create_invoice_draft",
      status_from: row.status,
      message: msg,
      actor,
    });
    return json(500, { error: msg });
  } finally {
    await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
  }
});
