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
  status?: string | null;
  sap_company_db: string | null;
  sap_po_draft_id: string | null;

  sap_invoice_draft_id: string | null;
  sap_matched_po_doc_entry: string | null;
  sap_matched_po_is_draft: boolean | null;
  sap_matched_card_code: string | null;
  valor_total: number | null;
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

/**
 * Procura no SAP uma NF de Entrada que já consuma o Pedido de Compra informado.
 * Primeiro nas PurchaseInvoices efetivas; se não houver, nos esboços (Drafts).
 */
async function findExistingPoInvoice(
  baseUrl: string,
  cookie: string,
  poEntry: number,
): Promise<{ docEntry: number; docNum: number | null; isDraft: boolean } | null> {
  const filter = `DocumentLines/any(l:l/BaseType eq 22 and l/BaseEntry eq ${poEntry})`;

  const invUrl = `${baseUrl}/PurchaseInvoices?$filter=${filter}` +
    `&$select=DocEntry,DocNum,Cancelled&$orderby=DocEntry asc&$top=5`;
  const r = await fetch(invUrl, { headers: { Cookie: cookie } });
  if (r.ok) {
    const j = await r.json().catch(() => ({}));
    const arr = Array.isArray(j?.value) ? j.value : [];
    const found = arr.find((inv: Record<string, unknown>) => inv.Cancelled !== "tYES");
    if (found) {
      return {
        docEntry: Number(found.DocEntry),
        docNum: found.DocNum != null ? Number(found.DocNum) : null,
        isDraft: false,
      };
    }
  }

  const draftUrl = `${baseUrl}/Drafts?$filter=DocObjectCode eq 'oPurchaseInvoices' and ${filter}` +
    `&$select=DocEntry,DocNum,Cancelled&$orderby=DocEntry asc&$top=5`;
  const dr = await fetch(draftUrl, { headers: { Cookie: cookie } });
  if (dr.ok) {
    const dj = await dr.json().catch(() => ({}));
    const darr = Array.isArray(dj?.value) ? dj.value : [];
    const dfound = darr.find((inv: Record<string, unknown>) => inv.Cancelled !== "tYES");
    if (dfound) {
      return {
        docEntry: Number(dfound.DocEntry),
        docNum: dfound.DocNum != null ? Number(dfound.DocNum) : null,
        isDraft: true,
      };
    }
  }

  return null;
}

/**
 * Quando o vínculo aponta para um ESBOÇO de Pedido de Compra, tenta descobrir o
 * PurchaseOrder efetivo gerado a partir dele. O SAP não guarda um ponteiro
 * direto esboço→documento, então casamos por CardCode + data + total (e, em
 * último caso, pelo DocNum do esboço).
 */
async function resolveEffectivePoFromDraft(
  baseUrl: string,
  cookie: string,
  draftEntry: number,
  fallback: { cardCode?: string | null; total?: number | null },
): Promise<{ docEntry: number; docNum: number | null; matchedBy: string } | null> {
  let cardCode = fallback.cardCode ?? null;
  let docDate: string | null = null;
  let docTotal: number | null = fallback.total ?? null;
  let draftDocNum: number | null = null;

  const dr = await fetch(
    `${baseUrl}/Drafts(${draftEntry})?$select=DocEntry,DocNum,CardCode,DocDate,DocTotal,Cancelled`,
    { headers: { Cookie: cookie } },
  );
  if (dr.ok) {
    const dj = await dr.json().catch(() => ({}));
    if (dj?.Cancelled === "tYES") return null;
    cardCode = (dj?.CardCode as string) || cardCode;
    docDate = (dj?.DocDate as string) || null;
    if (dj?.DocTotal != null) docTotal = Number(dj.DocTotal);
    if (dj?.DocNum != null) draftDocNum = Number(dj.DocNum);
  }
  // 404 = esboço já convertido em documento: seguimos com os dados do fallback.
  if (!cardCode) return null;

  const filters = [`CardCode eq '${String(cardCode).replace(/'/g, "''")}'`, `Cancelled eq 'tNO'`];
  if (docDate) filters.push(`DocDate ge '${docDate.slice(0, 10)}'`);
  const url = `${baseUrl}/PurchaseOrders?$filter=${filters.join(" and ")}` +
    `&$select=DocEntry,DocNum,DocTotal,DocDate&$orderby=DocEntry desc&$top=40`;
  const r = await fetch(url, { headers: { Cookie: cookie } });
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  const arr: Array<Record<string, unknown>> = Array.isArray(j?.value) ? j.value : [];
  if (!arr.length) return null;

  if (docTotal != null && Number.isFinite(docTotal)) {
    const byTotal = arr.find((po) => Math.abs(Number(po.DocTotal) - Number(docTotal)) <= 0.01);
    if (byTotal) {
      return { docEntry: Number(byTotal.DocEntry), docNum: byTotal.DocNum != null ? Number(byTotal.DocNum) : null, matchedBy: "cardcode+total" };
    }
  }
  if (draftDocNum != null) {
    const byNum = arr.find((po) => Number(po.DocNum) === draftDocNum);
    if (byNum) {
      return { docEntry: Number(byNum.DocEntry), docNum: draftDocNum, matchedBy: "docnum" };
    }
  }
  return null;
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

  // Execução sob demanda para um registro específico (permitida também em bases de teste).
  let manualId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const raw = (body as { import_id?: unknown })?.import_id;
    if (typeof raw === "string" && /^[0-9a-f-]{36}$/i.test(raw)) manualId = raw;
  } catch { /* sem body */ }

  // Paginação: processa em páginas de 50 até esvaziar ou atingir limite de tempo (90s).
  const PAGE_SIZE = 50;
  const TIME_BUDGET_MS = 90_000;
  const startedAt = Date.now();
  const results: Array<{ id: string; status: string; error?: string }> = [];
  let pageOffset = 0;

  while (Date.now() - startedAt < TIME_BUDGET_MS) {
    let q = sb.from("nf_entrada_imports").select("*");
    q = manualId
      ? q.eq("id", manualId)
      : q.eq("status", "awaiting_sap")
        .order("created_at", { ascending: true })
        .range(pageOffset, pageOffset + PAGE_SIZE - 1);
    const { data: rows, error } = await q;
    if (error) {
      await releaseWatcherLock(sb, "nf-entrada-sap-watcher", "error", error.message);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }
    if (!rows || rows.length === 0) break;

    // Agrupar por company_db para reaproveitar login (pulando bases de teste)
    const byCompany = new Map<string, NfRow[]>();
    for (const r of rows as NfRow[]) {
      if (!r.sap_company_db) continue;
      if (!r.sap_po_draft_id && !r.sap_matched_po_doc_entry) continue;
      if (!manualId && isTestCompanyDb(r.sap_company_db)) {
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
          // CASO 0: já existe NF de Entrada efetiva no SAP consumindo o PC vinculado.
          // Nesse caso não criamos nada — apenas refletimos a realidade do SAP.
          if (row.sap_matched_po_doc_entry && !row.sap_invoice_draft_id) {
            let poEntry = Number(row.sap_matched_po_doc_entry);
            let resolvedFromDraft: { docEntry: number; docNum: number | null; matchedBy: string } | null = null;

            // Se o vínculo aponta para um ESBOÇO, resolve antes o PC efetivo.
            if (Number.isFinite(poEntry) && row.sap_matched_po_is_draft === true) {
              resolvedFromDraft = await resolveEffectivePoFromDraft(baseUrl, cookie, poEntry, {
                cardCode: row.sap_matched_card_code ?? null,
                total: row.valor_total ?? null,
              });
              if (resolvedFromDraft) {
                await sb.from("nf_entrada_imports").update({
                  sap_matched_po_doc_entry: String(resolvedFromDraft.docEntry),
                  sap_matched_po_doc_num: resolvedFromDraft.docNum != null ? String(resolvedFromDraft.docNum) : null,
                  sap_matched_po_is_draft: false,
                  sap_match_reason: `PC efetivo resolvido a partir do esboço ${poEntry} (${resolvedFromDraft.matchedBy})`,
                  last_poll_at: new Date().toISOString(),
                }).eq("id", row.id);
                await sb.from("nf_entrada_logs").insert({
                  import_id: row.id,
                  step: "sap_po_draft_resolved",
                  message: `Esboço ${poEntry} corresponde ao Pedido de Compra ${resolvedFromDraft.docEntry}${resolvedFromDraft.docNum != null ? ` / DocNum ${resolvedFromDraft.docNum}` : ""}`,
                  actor: "nf-entrada-sap-watcher",
                  payload: { draft_entry: poEntry, po_doc_entry: resolvedFromDraft.docEntry, po_doc_num: resolvedFromDraft.docNum, matched_by: resolvedFromDraft.matchedBy },
                });
                poEntry = resolvedFromDraft.docEntry;
              }
            }

            if (Number.isFinite(poEntry) && (row.sap_matched_po_is_draft !== true || resolvedFromDraft)) {
              const existing = await findExistingPoInvoice(baseUrl, cookie, poEntry);
              if (existing) {
                await sb.from("nf_entrada_imports").update({
                  sap_invoice_draft_id: String(existing.docEntry),
                  status: "completed",
                  last_poll_at: new Date().toISOString(),
                  last_error: null,
                }).eq("id", row.id);
                await sb.from("nf_entrada_logs").insert({
                  import_id: row.id,
                  step: "sap_invoice_detected",
                  status_from: row.status ?? null,
                  status_to: "completed",
                  message: `${existing.isDraft ? "Esboço de NF" : "NF"} de Entrada já existente no SAP para o PC ${poEntry}: DocEntry ${existing.docEntry}${existing.docNum != null ? ` / DocNum ${existing.docNum}` : ""}${resolvedFromDraft ? ` (PC resolvido a partir do esboço ${row.sap_matched_po_doc_entry})` : ""}`,
                  actor: "nf-entrada-sap-watcher",
                  payload: {
                    po_doc_entry: poEntry,
                    resolved_from_draft: resolvedFromDraft ? Number(row.sap_matched_po_doc_entry) : null,
                    doc_entry: existing.docEntry,
                    doc_num: existing.docNum,
                    is_draft: existing.isDraft,
                  },
                });
                results.push({ id: row.id, status: "completed" });
                continue;

              }
            }
          }

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
          if (!row.sap_po_draft_id) {
            results.push({ id: row.id, status: row.status || "awaiting_sap", error: "sem draft de PC para consultar" });
            continue;
          }
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
    if (manualId) break; // execução sob demanda: apenas um registro
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
