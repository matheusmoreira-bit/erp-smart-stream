// Edge function: nf-entrada-sap-watcher
// Polling periódico: para cada NF com status awaiting_sap, consulta o Draft
// de Pedido de Compra no SAP. Se aprovado, cria o esboço (Draft) de NF de
// Entrada (PurchaseInvoice). Se rejeitado, marca como sap_rejected.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { tryWatcherLock, releaseWatcherLock, isTestCompanyDb } from "../_shared/watcher-lock.ts";
import { linkNfToAp } from "../_shared/link-nf-ap.ts";

/**
 * Consulta PurchaseInvoices no SAP que consumam o PC informado e registra
 * o vínculo NF↔AP em `nf_entrada_contas_pagar`. Casamento é feito por
 * BaseEntry do PC (1 PC → N NF → N AP), não por valor.
 */
async function linkPoInvoicesToNf(
  sb: ReturnType<typeof createClient>,
  baseUrl: string,
  cookie: string,
  args: { nfImportId: string; companyDb: string; poEntry: number },
): Promise<number> {
  const q = `${baseUrl}/PurchaseInvoices?$filter=DocumentLines/any(l:l/BaseType eq 22 and l/BaseEntry eq ${args.poEntry})` +
    `&$select=DocEntry,DocNum,DocTotal,PaidToDate,DocCurrency&$orderby=DocEntry asc&$top=50`;
  const r = await fetch(q, { headers: { Cookie: cookie } });
  if (!r.ok) return 0;
  const j = await r.json().catch(() => ({}));
  const arr = Array.isArray(j?.value) ? j.value : [];
  let linked = 0;
  for (const inv of arr) {
    const res = await linkNfToAp(sb, {
      nfImportId: args.nfImportId,
      source: "sap",
      companyDb: args.companyDb,
      apDocEntry: Number(inv.DocEntry),
      apDocNum: Number(inv.DocNum),
      apTotal: Number(inv.DocTotal),
      apPaid: Number(inv.PaidToDate ?? 0),
      apCurrency: inv.DocCurrency ? String(inv.DocCurrency) : null,
      linkedBy: "nf-entrada-sap-watcher",
    });
    if (res.inserted) linked += 1;
  }
  return linked;
}

interface NfRow {
  id: string;
  chave_acesso: string;
  sap_company_db: string | null;
  sap_po_draft_id: string | null;
  sap_invoice_draft_id: string | null;
  sap_matched_po_doc_entry: string | null;
  sap_matched_po_is_draft: boolean | null;
  sap_matched_card_code: string | null;
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


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const gotLock = await tryWatcherLock(sb, "nf-entrada-sap-watcher", 10);
  if (!gotLock) {
    return new Response(
      JSON.stringify({ ok: true, skipped: "another_run_in_progress" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Paginação: processa em páginas de 50 até esvaziar ou atingir limite de tempo (90s).
  const PAGE_SIZE = 50;
  const TIME_BUDGET_MS = 90_000;
  const startedAt = Date.now();
  const results: Array<{ id: string; status: string; error?: string }> = [];
  let pageOffset = 0;

  while (Date.now() - startedAt < TIME_BUDGET_MS) {
    const { data: rows, error } = await sb
      .from("nf_entrada_imports")
      .select("*")
      .eq("status", "awaiting_sap")
      .order("created_at", { ascending: true })
      .range(pageOffset, pageOffset + PAGE_SIZE - 1);
    if (error) {
      await releaseWatcherLock(sb, "nf-entrada-sap-watcher", "error", error.message);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }
    if (!rows || rows.length === 0) break;

    // Agrupar por company_db para reaproveitar login (pulando bases de teste)
    const byCompany = new Map<string, NfRow[]>();
    for (const r of rows as NfRow[]) {
      if (!r.sap_company_db || !r.sap_po_draft_id) continue;
      if (isTestCompanyDb(r.sap_company_db)) {
        results.push({ id: r.id, status: "skipped", error: "test_base" });
        continue;
      }
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
          // CASO 1: vinculado a um Pedido de Compra EFETIVO já existente no SAP.
          // Não precisa polling — cria o Draft da NF de Entrada referenciando o PO.
          if (row.sap_matched_po_doc_entry && row.sap_matched_po_is_draft === false) {
            const poEntry = Number(row.sap_matched_po_doc_entry);
            const poR = await fetch(
              `${baseUrl}/PurchaseOrders(${poEntry})?$select=DocEntry,CardCode,DocumentLines`,
              { headers: { Cookie: cookie } },
            );
            if (!poR.ok) throw new Error(`Consulta PO existente falhou ${poR.status}`);
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
            if (!invResp.ok) throw new Error(`Draft NF Entrada (PO vinculada) falhou ${invResp.status}: ${(await invResp.text()).slice(0, 300)}`);
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
              message: `Draft NF Entrada criado vinculado ao PC ${poEntry}: Draft ${invJson.DocEntry}`,
              actor: "nf-entrada-sap-watcher",
            });
            results.push({ id: row.id, status: "completed" });
            continue;
          }

          // CASO 2 (padrão): polling do Draft do Pedido de Compra
          const dr = await fetch(
            `${baseUrl}/Drafts(${row.sap_po_draft_id})?$select=DocEntry,DocumentStatus,DocNum,Cancelled,CardCode`,
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

    // Próxima página: avança o offset pelo total recebido
    pageOffset += rows.length;
    if (rows.length < PAGE_SIZE) break; // última página
  }

  // Segunda passada: para NFs já `completed` que ainda não têm vínculo com
  // Contas a Pagar (settlement_ap_count = 0), tenta localizar as
  // PurchaseInvoices efetivas do PC e registrar o vínculo. Isso desacopla o
  // linking do sucesso da baixa automática (antes só rodava no settlement).
  const linkResults: Array<{ id: string; linked: number; error?: string }> = [];
  try {
    const { data: pending } = await sb
      .from("nf_entrada_imports")
      .select("id, sap_company_db, sap_matched_po_doc_entry, settlement_ap_count")
      .eq("status", "completed")
      .not("sap_matched_po_doc_entry", "is", null)
      .or("settlement_ap_count.is.null,settlement_ap_count.eq.0")
      .order("created_at", { ascending: false })
      .limit(200);

    const byCompanyLink = new Map<string, Array<{ id: string; poEntry: number }>>();
    for (const p of (pending || []) as Array<{ id: string; sap_company_db: string | null; sap_matched_po_doc_entry: string | null }>) {
      if (!p.sap_company_db || !p.sap_matched_po_doc_entry) continue;
      if (isTestCompanyDb(p.sap_company_db)) continue;
      const poEntry = Number(p.sap_matched_po_doc_entry);
      if (!Number.isFinite(poEntry)) continue;
      const arr = byCompanyLink.get(p.sap_company_db) || [];
      arr.push({ id: p.id, poEntry });
      byCompanyLink.set(p.sap_company_db, arr);
    }

    for (const [companyDb, list] of byCompanyLink) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      let cookie = "";
      let baseUrl = "";
      try {
        const creds = await loadCreds(sb, companyDb);
        baseUrl = buildBaseUrl(creds.service_layer_url);
        cookie = await sapLogin(baseUrl, creds.company_db || companyDb, creds.username, creds.password);
      } catch (e) {
        for (const item of list) linkResults.push({ id: item.id, linked: 0, error: (e as Error).message });
        continue;
      }
      try {
        for (const item of list) {
          try {
            const linked = await linkPoInvoicesToNf(sb, baseUrl, cookie, {
              nfImportId: item.id,
              companyDb,
              poEntry: item.poEntry,
            });
            linkResults.push({ id: item.id, linked });
          } catch (e) {
            linkResults.push({ id: item.id, linked: 0, error: (e as Error).message });
          }
        }
      } finally {
        await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn("[nf-entrada-sap-watcher] link pass failed:", (e as Error).message);
  }

  await releaseWatcherLock(sb, "nf-entrada-sap-watcher", "ok", `processed=${results.length} linked=${linkResults.length}`);
  return new Response(JSON.stringify({ ok: true, results, linkResults, processed: results.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
