import { requireIntegrationCaller, authorizeIntegrationCompany } from "../_shared/integration-auth.ts";
import { AuthError, authErrorResponse } from "../_shared/auth.ts";
import { createNfDraftOnce, assertNfDraftEligible } from "../_shared/nf-draft-once.ts";
// Edge function: nf-entrada-to-sap
// Quando uma NF de entrada já foi aprovada no ERP Flow, cria um esboço (Draft)
// de Pedido de Compra (ObjectCode 22) no SAP Business One.
//
// Idempotente: se sap_po_draft_id já existir para o registro, não cria novamente.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getIntegrationPause, pauseResponse } from "../_shared/integration-pause.ts";
import { getStandaloneMode } from "../_shared/standalone-mode.ts";

interface NfRow {
  id: string;
  chave_acesso: string;
  cnpj_fornecedor: string | null;
  itens: Array<Record<string, unknown>>;
  sap_company_db: string | null;
  sap_po_draft_id: string | null;
  status: string;
}

async function loadCredentials(sb: ReturnType<typeof createClient>, companyDb: string) {
  const { data, error } = await sb
    .from("system_credentials_v")
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


function buildBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function sapLogin(baseUrl: string, companyDB: string, username: string, password: string): Promise<string> {
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: username, Password: password, CompanyDB: companyDB }),
  });
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}: ${(await r.text()).slice(0, 200)}`);
  await r.json();
  const sc = r.headers.get("set-cookie") || "";
  const sess = sc.match(/B1SESSION=([^;]+)/)?.[1];
  const route = sc.match(/ROUTEID=([^;]+)/)?.[1];
  if (!sess) throw new Error("B1SESSION ausente");
  return `B1SESSION=${sess}${route ? `; ROUTEID=${route}` : ""}`;
}

async function createPoDraft(baseUrl: string, cookie: string, body: Record<string, unknown>): Promise<string> {
  // ObjectCode 22 = Purchase Order Draft
  const r = await fetch(`${baseUrl}/Drafts`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, DocObjectCode: "oPurchaseOrders" }),
  });
  if (!r.ok) throw new Error(`Draft PO falhou ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j = await r.json();
  return String(j.DocEntry);
}

class StandalonePausedError extends Error {}

async function process(sb: ReturnType<typeof createClient>, row: NfRow): Promise<string> {
  assertNfDraftEligible(row);
  if (row.sap_po_draft_id) return row.sap_po_draft_id;
  if (!row.sap_company_db) throw new Error("sap_company_db não definido");
  {
    const _sa = await getStandaloneMode(row.sap_company_db);
    if (_sa) throw new StandalonePausedError(`Empresa em modo standalone: integração com o ERP pausada. O documento permanece na fila e será enviado quando o modo for desligado.`);
  }

  // Resolver fornecedor (CardCode) por CNPJ no SAP
  const creds = await loadCredentials(sb, row.sap_company_db);
  const baseUrl = buildBaseUrl(creds.service_layer_url);
  const cookie = await sapLogin(baseUrl, creds.company_db || row.sap_company_db, creds.username, creds.password);

  try {
    const cnpj = (row.cnpj_fornecedor || "").replace(/\D/g, "");
    const bpResp = await fetch(
      `${baseUrl}/BusinessPartners?$filter=FederalTaxID eq '${cnpj}'&$select=CardCode&$top=1`,
      { headers: { Cookie: cookie } },
    );
    const bpJson = await bpResp.json();
    const cardCode = bpJson?.value?.[0]?.CardCode;
    if (!cardCode) throw new Error(`Fornecedor CNPJ ${cnpj} não encontrado no SAP`);

    const docLines = (row.itens || []).map((it) => ({
      ItemCode: (it as Record<string, unknown>).ItemCode || (it as Record<string, unknown>).item_code,
      Quantity: (it as Record<string, unknown>).Quantity || (it as Record<string, unknown>).quantidade || 1,
      Price: (it as Record<string, unknown>).Price || (it as Record<string, unknown>).preco_unitario || 0,
    }));

    const correlation = `ERPFlow NF ${row.id}`;
    const draftId = await createNfDraftOnce(sb, row.id, () => createPoDraft(baseUrl, cookie, {
      CardCode: cardCode,
      Comments: correlation,
      DocumentLines: docLines,
    }), async () => {
      const filter = `DocObjectCode eq 'oPurchaseOrders' and Comments eq '${correlation.replace(/'/g, "''")}'`;
      const response = await fetch(`${baseUrl}/Drafts?$select=DocEntry&$filter=${encodeURIComponent(filter)}&$top=2`, { headers: { Cookie: cookie } });
      if (!response.ok) throw new Error("Não foi possível reconciliar o Draft no SAP");
      const data = await response.json();
      if (!Array.isArray(data.value)) throw new Error("Resposta inválida na reconciliação do SAP");
      if (data.value.length > 1) throw new Error("Mais de um Draft encontrado; revisão manual necessária");
      return data.value.length ? String(data.value[0].DocEntry) : null;
    });

    const { data: saved, error: saveError } = await sb.from("nf_entrada_imports").update({
      sap_po_draft_id: draftId,
      status: "awaiting_sap",
      last_error: null,
    }).eq("id", row.id).eq("status", row.status).select("id").maybeSingle();
    if (saveError || !saved) throw new Error("Draft confirmado, mas vínculo local falhou; tente reconciliar novamente");

    const { error: logError } = await sb.from("nf_entrada_logs").insert({
      import_id: row.id,
      step: "create_po_draft",
      status_to: "awaiting_sap",
      message: `Draft PO criado: ${draftId}`,
      actor: "nf-entrada-to-sap",
    });

    if (logError) throw new Error("Draft confirmado, mas auditoria local falhou");
    return draftId;
  } finally {
    await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let caller;
  try { caller = await requireIntegrationCaller(req); }
  catch (error) { return authErrorResponse(error, corsHeaders) ?? new Response("Falha de autenticação", { status: 503 }); }
  { const _pause = await getIntegrationPause("sap_b1"); if (_pause) return pauseResponse(_pause, corsHeaders); }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { import_id?: string } = {};
  try { body = (await req.json()) ?? {}; } catch { /* ignore */ }

  if (!body?.import_id && !caller.technical) return new Response(JSON.stringify({ error: "Lote exige identidade técnica" }), { status: 403, headers: corsHeaders });
  let rows: NfRow[];
  if (body.import_id) {
    const { data, error } = await sb.from("nf_entrada_imports").select("*").eq("id", body.import_id).limit(1);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    rows = (data || []) as NfRow[];
  } else {
    const { data, error } = await sb
      .from("nf_entrada_imports")
      .select("*")
      .eq("status", "pending_expense")
      .limit(20);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    rows = (data || []) as NfRow[];
  }

  const results: Array<{ id: string; ok: boolean; draft?: string; error?: string; skipped?: boolean }> = [];
  for (const row of rows) {
    try {
      await authorizeIntegrationCompany(req, caller, "nf_entrada", row.sap_company_db);
      const draftId = await process(sb, row);
      results.push({ id: row.id, ok: true, draft: draftId });
    } catch (e) {
      if (e instanceof AuthError) {
        if (body.import_id) return authErrorResponse(e, corsHeaders)!;
        results.push({ id: row.id, ok: false, error: e.message, skipped: true });
        continue;
      }
      const msg = (e as Error).message;
      if (e instanceof StandalonePausedError) {
        // Mantém o documento na fila (status inalterado) para reenvio automático
        // assim que o modo standalone for desligado.
        await sb.from("nf_entrada_imports").update({ last_error: msg }).eq("id", row.id);
        results.push({ id: row.id, ok: false, error: msg, skipped: true });
        continue;
      }
      await sb.from("nf_entrada_imports").update({
        status: "integration_error",
        last_error: msg,
      }).eq("id", row.id).eq("status", row.status);
      await sb.from("nf_entrada_logs").insert({
        import_id: row.id,
        step: "create_po_draft",
        status_to: "integration_error",
        message: msg,
        actor: "nf-entrada-to-sap",
      });
      results.push({ id: row.id, ok: false, error: msg });
    }
  }

  return new Response(JSON.stringify({ ok: results.every(r => r.ok), results }), {
    status: body.import_id && results.some(r => !r.ok) ? 502 : 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
