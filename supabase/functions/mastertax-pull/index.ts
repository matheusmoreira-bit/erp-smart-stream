// Edge function: mastertax-pull
// Busca NFs novas (notas-servico) na Master Tax (https://api.mastertax.app),
// baixa XML quando disponível, e faz upsert idempotente em public.nf_entrada_imports.
//
// Por empresa, lê credenciais em system_credentials:
//   base_url, empresa_id (UUID Master Tax), token (Bearer), cnpj (opcional)
//
// Endpoint principal:
//   GET {base_url}/api/notas-servico?empresa_id=...&emissaoDe=YYYY-MM-DD&emissaoAte=YYYY-MM-DD&pagina=N&quantidade=N
//   Header: Authorization: Bearer {token}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { logIntegrationCall } from "../_shared/integration-log.ts";

const DEFAULT_BASE_URL = "https://api.mastertax.app";

interface MasterTaxInvoice {
  chave_acesso: string;
  numero_nf: string;
  serie: string;
  cnpj_fornecedor: string;
  nome_fornecedor: string;
  data_emissao: string;
  valor_total: number;
  condicao_pagamento?: string;
  itens: Array<Record<string, unknown>>;
  impostos: Record<string, unknown>;
  xml_base64?: string;
  raw?: Record<string, unknown>;
}

interface CompanyCreds {
  company_db: string;
  base_url: string;
  token: string;
  empresa_ids: string[];
  cnpj: string;
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = (raw || "").trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_BASE_URL;
}

function sanitizeCnpj(raw: string): string {
  return (raw || "").replace(/\D+/g, "");
}

function parseEmpresaIds(raw: string): string[] {
  return (raw || "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function parseNotaFromRow(row: any): MasterTaxInvoice | null {
  const chave: string | undefined =
    row?.chave || row?.chave_acesso || row?.chaveAcesso || row?.chNFe ||
    row?.codigo_verificacao || row?.id;
  if (!chave || typeof chave !== "string") return null;

  const numero = String(row?.numero ?? row?.nNF ?? row?.numero_nf ?? row?.numero_nfse ?? "");
  const serie = String(row?.serie ?? row?.serie_nf ?? "");
  const cnpjFor = String(
    row?.emitenteDocumento ?? row?.prestadorDocumento ?? row?.cnpj_prestador ??
    row?.prestador?.cnpj ?? row?.cnpj_emit ?? row?.cnpjEmit ?? row?.cnpj_emitente ??
    row?.cnpj_fornecedor ?? "",
  );
  const nomeFor = String(
    row?.emitenteNome ?? row?.prestadorNome ?? row?.razao_social_prestador ??
    row?.prestador?.razao_social ?? row?.prestador?.nome ?? row?.nome_emit ??
    row?.nomeEmit ?? row?.razao_emit ?? row?.nome_fornecedor ?? "",
  );
  const dataEmissao = String(
    row?.dataEmissao ?? row?.data_emissao ?? row?.dhEmi ?? row?.emissao ?? "",
  ).slice(0, 10) || new Date().toISOString().slice(0, 10);
  const valorTotal = Number(
    row?.valor ?? row?.valor_total ?? row?.valor_servicos ?? row?.vNF ?? 0,
  ) || 0;

  return {
    chave_acesso: chave,
    numero_nf: numero,
    serie,
    cnpj_fornecedor: cnpjFor,
    nome_fornecedor: nomeFor,
    data_emissao: dataEmissao,
    valor_total: valorTotal,
    itens: Array.isArray(row?.itens) ? row.itens : [],
    impostos: typeof row?.impostos === "object" && row?.impostos ? row.impostos : {},
    xml_base64: typeof row?.xml === "string" ? row.xml : (typeof row?.xml_base64 === "string" ? row.xml_base64 : undefined),
    raw: row,
  };
}

const MAX_WINDOW_DAYS = 120;

function clampStart(sinceIso: string): string {
  const today = new Date();
  const minStart = new Date(today.getTime() - MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const since = new Date(sinceIso);
  const start = since > minStart ? since : minStart;
  return start.toISOString().slice(0, 10);
}

async function fetchInvoicesForEmpresa(
  creds: CompanyCreds,
  empresaId: string,
  sinceIso: string,
): Promise<{ invoices: MasterTaxInvoice[]; error?: string }> {
  const dataInicio = clampStart(sinceIso);
  const dataFim = new Date().toISOString().slice(0, 10);
  const invoices: MasterTaxInvoice[] = [];
  const authHeader = creds.token.toLowerCase().startsWith("bearer ")
    ? creds.token
    : `Bearer ${creds.token}`;
  const limite = 50;
  const errors: string[] = [];

  let pagina = 1;
  while (true) {
    const competencia = dataFim.slice(0, 7);
    const params = new URLSearchParams({
      empresa_id: empresaId,
      competencia,
      emissaoDe: dataInicio,
      emissaoAte: dataFim,
      dataArmazenamentoInicio: dataInicio,
      dataArmazenamentoFim: dataFim,
      pagina: String(pagina),
      quantidade: String(limite),
      ordenar: "dataEmissao",
      sentido: "desc",
      tipo: "Prestador",
      retencoes: "todas",
    });
    const target = `${creds.base_url}/api/notas-servico?${params.toString()}`;

    let resp: Response;
    try {
      resp = await fetch(target, {
        method: "GET",
        headers: { Authorization: authHeader, Accept: "application/json" },
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      errors.push(`[${empresaId}] rede: ${(e as Error).message}`);
      break;
    }
    const raw = await resp.text().catch(() => "");
    if (!resp.ok) {
      errors.push(`[${empresaId}] HTTP ${resp.status}: ${raw.slice(0, 160)}`);
      break;
    }
    let data: any = null;
    try { data = JSON.parse(raw); } catch { data = null; }

    const retorno = data?.retorno ?? data;
    const rows: any[] = Array.isArray(retorno?.data)
      ? retorno.data
      : Array.isArray(retorno?.notas)
        ? retorno.notas
        : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data)
            ? data
            : [];
    for (const r of rows) {
      const inv = parseNotaFromRow(r);
      if (inv) {
        (inv.raw as any) = { ...(inv.raw || {}), _empresa_id: empresaId };
        invoices.push(inv);
      }
    }
    const lastPage = Number(
      retorno?.last_page ?? retorno?.meta?.last_page ?? data?.meta?.last_page ??
      data?.last_page ?? data?.pagination?.last_page ?? 1,
    );
    if (!rows.length || rows.length < limite || pagina >= lastPage || pagina >= 50) break;
    pagina++;
  }

  return { invoices, error: errors.length ? errors.join(" | ") : undefined };
}

async function loadCompanyCredentials(
  supabase: ReturnType<typeof createClient>,
): Promise<CompanyCreds[]> {
  const { data, error } = await supabase
    .from("system_credentials")
    .select("company_db, credential_key, credential_value")
    .eq("system_name", "mastertax");
  if (error) throw error;

  const grouped = new Map<string, Record<string, string>>();
  for (const row of (data || []) as Array<{ company_db: string | null; credential_key: string; credential_value: string }>) {
    const key = row.company_db || "_global";
    const bucket = grouped.get(key) || {};
    bucket[row.credential_key] = row.credential_value ?? "";
    grouped.set(key, bucket);
  }

  const out: CompanyCreds[] = [];
  for (const [companyDb, kv] of grouped) {
    const token = (kv.token || "").trim();
    const empresaIds = parseEmpresaIds(kv.empresa_id || "");
    if (!token || empresaIds.length === 0) continue;
    out.push({
      company_db: companyDb,
      base_url: normalizeBaseUrl(kv.base_url || DEFAULT_BASE_URL),
      token,
      empresa_ids: empresaIds,
      cnpj: sanitizeCnpj(kv.cnpj || ""),
    });
  }
  return out;
}

// ============================================================
// SAP existing-PO matching (avoid duplicate ERP Flow approval)
// ============================================================

function buildSapBaseUrl(raw: string): string {
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
  const sess = sc.match(/B1SESSION=([^;]+)/)?.[1];
  const route = sc.match(/ROUTEID=([^;]+)/)?.[1];
  if (!sess) throw new Error("B1SESSION ausente");
  return `B1SESSION=${sess}${route ? `; ROUTEID=${route}` : ""}`;
}

async function loadSapCreds(
  supabase: ReturnType<typeof createClient>,
  companyDb: string,
): Promise<{ baseUrl: string; companyDB: string; username: string; password: string } | null> {
  const { data } = await supabase
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  const kv: Record<string, string> = {};
  for (const r of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
    kv[r.credential_key] = r.credential_value ?? "";
  }
  if (!kv.service_layer_url || !kv.username || !kv.password) return null;
  return {
    baseUrl: buildSapBaseUrl(kv.service_layer_url),
    companyDB: kv.company_db || companyDb,
    username: kv.username,
    password: kv.password,
  };
}

const escapeOData = (s: string) => (s || "").replace(/'/g, "''");

async function findSapSupplierCardCode(
  baseUrl: string,
  cookie: string,
  cnpj: string,
  nome: string,
): Promise<string | null> {
  const digits = (cnpj || "").replace(/\D/g, "");
  if (digits) {
    const r = await fetch(
      `${baseUrl}/BusinessPartners?$filter=CardType eq 'cSupplier' and FederalTaxID eq '${digits}'&$select=CardCode&$top=1`,
      { headers: { Cookie: cookie } },
    );
    if (r.ok) {
      const cc = (await r.json())?.value?.[0]?.CardCode;
      if (cc) return String(cc);
    }
  }
  const n = (nome || "").trim();
  if (n.length >= 4) {
    const r = await fetch(
      `${baseUrl}/BusinessPartners?$filter=CardType eq 'cSupplier' and contains(CardName,'${escapeOData(n)}')&$select=CardCode&$top=1`,
      { headers: { Cookie: cookie } },
    );
    if (r.ok) {
      const cc = (await r.json())?.value?.[0]?.CardCode;
      if (cc) return String(cc);
    }
  }
  return null;
}

async function findExistingPo(
  baseUrl: string, cookie: string, cardCode: string, valor: number,
): Promise<{ docEntry: string; isDraft: boolean } | null> {
  const v = Number(valor).toFixed(2);
  const poUrl = `${baseUrl}/PurchaseOrders?$filter=CardCode eq '${escapeOData(cardCode)}' and DocumentStatus eq 'bost_Open' and DocTotal eq ${v}&$select=DocEntry&$top=1`;
  const poR = await fetch(poUrl, { headers: { Cookie: cookie } });
  if (poR.ok) {
    const de = (await poR.json())?.value?.[0]?.DocEntry;
    if (de != null) return { docEntry: String(de), isDraft: false };
  }
  const drUrl = `${baseUrl}/Drafts?$filter=DocObjectCode eq 'oPurchaseOrders' and CardCode eq '${escapeOData(cardCode)}' and DocTotal eq ${v}&$select=DocEntry&$top=1`;
  const drR = await fetch(drUrl, { headers: { Cookie: cookie } });
  if (drR.ok) {
    const de = (await drR.json())?.value?.[0]?.DocEntry;
    if (de != null) return { docEntry: String(de), isDraft: true };
  }
  return null;
}

async function tryMatchExistingPo(
  supabase: ReturnType<typeof createClient>,
  companyDb: string,
  insertedIds: string[],
): Promise<{ matched: number; checked: number; error?: string }> {
  if (!insertedIds.length) return { matched: 0, checked: 0 };
  const sap = await loadSapCreds(supabase, companyDb);
  if (!sap) return { matched: 0, checked: 0, error: "SAP creds ausentes" };

  let cookie: string;
  try {
    cookie = await sapLogin(sap.baseUrl, sap.companyDB, sap.username, sap.password);
  } catch (e) {
    return { matched: 0, checked: 0, error: (e as Error).message };
  }

  let matched = 0;
  let checked = 0;
  try {
    const { data: rows } = await supabase
      .from("nf_entrada_imports")
      .select("id, cnpj_fornecedor, nome_fornecedor, valor_total")
      .in("id", insertedIds);
    for (const row of (rows || []) as Array<{ id: string; cnpj_fornecedor: string | null; nome_fornecedor: string | null; valor_total: number | null }>) {
      checked++;
      try {
        const cardCode = await findSapSupplierCardCode(
          sap.baseUrl, cookie, row.cnpj_fornecedor || "", row.nome_fornecedor || "",
        );
        if (!cardCode) continue;
        const match = await findExistingPo(sap.baseUrl, cookie, cardCode, Number(row.valor_total || 0));
        if (!match) continue;
        await supabase.from("nf_entrada_imports").update({
          status: "awaiting_sap",
          sap_company_db: companyDb,
          sap_matched_card_code: cardCode,
          sap_matched_po_doc_entry: match.docEntry,
          sap_matched_po_is_draft: match.isDraft,
          sap_po_draft_id: match.docEntry,
          sap_match_reason: `cnpj+valor (${match.isDraft ? "draft" : "PO"})`,
        }).eq("id", row.id);
        await supabase.from("nf_entrada_logs").insert({
          import_id: row.id,
          step: "match_existing_po",
          status_to: "awaiting_sap",
          message: `PC ${match.isDraft ? "esboço" : "efetiva"} já existente no SAP (DocEntry ${match.docEntry}, CardCode ${cardCode}) — aprovação ERP Flow ignorada`,
          actor: "mastertax-pull",
        });
        matched++;
      } catch (e) {
        console.error(`[mastertax-pull][${companyDb}] match err id=${row.id}:`, (e as Error).message);
      }
    }
  } finally {
    await fetch(`${sap.baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
  }
  return { matched, checked };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const _startedAt = Date.now();
  let _http = 200;
  let _err: string | null = null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const result = {
    companies: 0,
    fetched: 0,
    upserted: 0,
    skipped: 0,
    errors: 0,
    perCompany: [] as Array<{ company_db: string; fetched: number; upserted: number; skipped: number; errors: number; error?: string }>,
  };

  try {
    const { data: toggle } = await supabase
      .from("enabled_erp_types")
      .select("is_active")
      .eq("erp_type", "mastertax")
      .maybeSingle();
    if (!toggle?.is_active) {
      return new Response(JSON.stringify({ ok: true, skipped: "mastertax integration disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allCreds = await loadCompanyCredentials(supabase);
    result.companies = allCreds.length;

    for (const creds of allCreds) {
      const stats = { company_db: creds.company_db, fetched: 0, upserted: 0, skipped: 0, matched: 0, errors: 0, error: undefined as string | undefined };
      const insertedIdsForCompany: string[] = [];



      for (const empresaId of creds.empresa_ids) {
        const stateKey = `mastertax_last_pull:${empresaId}`;
        const { data: stateRow } = await supabase
          .from("nf_entrada_settings")
          .select("value")
          .eq("company_db", creds.company_db)
          .eq("key", stateKey)
          .maybeSingle();
        // Incremental: continue from last successful pull; clamp to last 120 days.
        const sinceIso = (stateRow?.value as { iso?: string })?.iso ||
          new Date(Date.now() - MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

        const { invoices, error: pullErr } = await fetchInvoicesForEmpresa(creds, empresaId, sinceIso);
        stats.fetched += invoices.length;
        result.fetched += invoices.length;
        if (pullErr) {
          stats.error = (stats.error ? stats.error + " | " : "") + pullErr;
          stats.errors++;
          result.errors++;
          console.error(`[mastertax-pull][${creds.company_db}][${empresaId}]`, pullErr);
          continue;
        }

        for (const inv of invoices) {
          try {
            const { data: existing } = await supabase
              .from("nf_entrada_imports")
              .select("id")
              .eq("chave_acesso", inv.chave_acesso)
              .maybeSingle();
            if (existing) {
              stats.skipped++;
              result.skipped++;
              continue;
            }

            let xmlPath: string | null = null;
            if (inv.xml_base64) {
              xmlPath = `xml/${inv.chave_acesso}.xml`;
              await supabase.storage.from("nf-entrada-files").upload(
                xmlPath,
                decodeBase64(inv.xml_base64),
                { contentType: "application/xml", upsert: true },
              );
            }

            const { data: inserted, error: insErr } = await supabase
              .from("nf_entrada_imports")
              .insert({
                chave_acesso: inv.chave_acesso,
                numero_nf: inv.numero_nf,
                serie: inv.serie,
                cnpj_fornecedor: inv.cnpj_fornecedor,
                nome_fornecedor: inv.nome_fornecedor,
                data_emissao: inv.data_emissao,
                valor_total: inv.valor_total,
                condicao_pagamento: inv.condicao_pagamento,
                itens: inv.itens,
                impostos: inv.impostos,
                raw_mastertax: inv.raw ?? null,
                xml_storage_path: xmlPath,
                pdf_storage_path: null,
                sap_company_db: creds.company_db,
                status: "awaiting_erpflow_approval",
              })
              .select()
              .single();
            if (insErr) throw insErr;

            insertedIdsForCompany.push(inserted.id);

            await supabase.from("nf_entrada_logs").insert({
              import_id: inserted.id,
              step: "mastertax_pull",
              status_to: "awaiting_erpflow_approval",
              message: "NF importada da Master Tax",
              payload: { chave_acesso: inv.chave_acesso, company_db: creds.company_db, empresa_id: empresaId },
              actor: "mastertax-pull",
            });

            stats.upserted++;
            result.upserted++;

          } catch (e) {
            console.error(`[mastertax-pull][${creds.company_db}][${empresaId}] erro item:`, (e as Error).message);
            stats.errors++;
            result.errors++;
          }
        }

        // Save per-empresa incremental cursor only when fetch succeeded.
        await supabase.from("nf_entrada_settings").upsert(
          { company_db: creds.company_db, key: stateKey, value: { iso: new Date().toISOString() } },
          { onConflict: "company_db,key" },
        );
      }

      // Keep aggregate cursor for backward compatibility.
      await supabase.from("nf_entrada_settings").upsert(
        { company_db: creds.company_db, key: "last_pull_iso", value: { iso: new Date().toISOString() } },
        { onConflict: "company_db,key" },
      );

      // Try to match new imports against existing SAP POs / PO drafts
      // to skip ERP Flow approval when the document already exists in the ERP.
      try {
        const m = await tryMatchExistingPo(supabase, creds.company_db, insertedIdsForCompany);
        stats.matched = m.matched;
        if (m.error) console.warn(`[mastertax-pull][${creds.company_db}] match: ${m.error}`);
      } catch (e) {
        console.error(`[mastertax-pull][${creds.company_db}] match falhou:`, (e as Error).message);
      }


      // Retention: drop mastertax imports with data_emissao older than 120 days
      // (only those still untouched — pending/awaiting/cancelled — to preserve audit trail of processed ones).
      const cutoff = new Date(Date.now() - MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      const { error: purgeErr } = await supabase
        .from("nf_entrada_imports")
        .delete()
        .lt("data_emissao", cutoff)
        .not("raw_mastertax", "is", null)
        .in("status", ["awaiting_erpflow_approval", "erpflow_rejected", "cancelled", "pending_expense"]);
      if (purgeErr) console.error(`[mastertax-pull][${creds.company_db}] purge:`, purgeErr.message);

      result.perCompany.push(stats);
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[mastertax-pull] falha geral:", (e as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message, ...result }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
