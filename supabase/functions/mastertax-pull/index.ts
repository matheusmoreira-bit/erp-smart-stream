// Edge function: mastertax-pull
// Busca NFs novas na Master Tax (https://apidocs.mastertax.app/), baixa XML,
// faz upsert idempotente em public.nf_entrada_imports.
//
// Por empresa, lê as credenciais em system_credentials (base_url, token, cnpj)
// e chama:
//   POST {base_url}/api/gestor/retornaNotasPaginado  -> lista de notas
//   POST {base_url}/api/gestor/retornaNota           -> XML completo (base64)
//
// Autenticação: Authorization: Bearer {token}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

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
  cnpj: string;
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = (raw || "").trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_BASE_URL;
}

function sanitizeCnpj(raw: string): string {
  return (raw || "").replace(/\D+/g, "");
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function mtFetch(
  baseUrl: string,
  token: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: any; raw: string }> {
  const auth = token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
  const r = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const raw = await r.text().catch(() => "");
  let data: any = null;
  try { data = JSON.parse(raw); } catch { /* not json */ }
  return { ok: r.ok && data?.sucesso !== false, status: r.status, data, raw };
}

function parseNotaFromRow(row: any): MasterTaxInvoice | null {
  // O retorno do retornaNotasPaginado traz cada nota com pelo menos:
  //   chave, numero, serie, dhEmi/data_emissao, valor_total, cnpj_emit, nome_emit, ...
  // Como o schema oficial não detalha o item de array em "data", aceitamos vários nomes.
  const chave: string | undefined =
    row?.chave || row?.chaveAcesso || row?.chave_acesso || row?.chNFe;
  if (!chave || typeof chave !== "string") return null;

  const numero = String(row?.numero ?? row?.nNF ?? row?.numero_nf ?? "");
  const serie = String(row?.serie ?? row?.serie_nf ?? "");
  const cnpjFor = String(row?.cnpj_emit ?? row?.cnpjEmit ?? row?.cnpj_emitente ?? row?.cnpj_fornecedor ?? "");
  const nomeFor = String(row?.nome_emit ?? row?.nomeEmit ?? row?.razao_emit ?? row?.nome_fornecedor ?? "");
  const dataEmissao = String(row?.dhEmi ?? row?.data_emissao ?? row?.dataEmissao ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const valorTotal = Number(row?.valor_total ?? row?.vNF ?? row?.valor ?? 0) || 0;

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
    raw: row,
  };
}

async function fetchInvoicesForCompany(
  creds: CompanyCreds,
  sinceIso: string,
): Promise<{ invoices: MasterTaxInvoice[]; error?: string }> {
  const dataInicio = sinceIso.slice(0, 10);
  const dataFim = new Date().toISOString().slice(0, 10);
  const invoices: MasterTaxInvoice[] = [];
  let pagina = 1;
  const limite = 100;

  while (true) {
    const body: Record<string, unknown> = {
      pagina,
      limite,
      cnpj: creds.cnpj,
      data_inicio: dataInicio,
      data_fim: dataFim,
    };
    const { ok, status, data, raw } = await mtFetch(
      creds.base_url,
      creds.token,
      "/api/gestor/retornaNotasPaginado",
      body,
    );
    if (!ok) {
      return {
        invoices,
        error: `retornaNotasPaginado HTTP ${status}: ${data?.mensagem || raw.slice(0, 200)}`,
      };
    }
    const retorno = data?.retorno || {};
    const rows: any[] = Array.isArray(retorno.data) ? retorno.data : [];
    for (const r of rows) {
      const inv = parseNotaFromRow(r);
      if (inv) invoices.push(inv);
    }
    const lastPage = Number(retorno.last_page ?? retorno.lastPage ?? 1);
    if (!rows.length || pagina >= lastPage || pagina >= 50) break; // hard safety cap
    pagina++;
  }

  // Hidrata XML por nota via retornaNota (comXml=1)
  for (const inv of invoices) {
    try {
      const { ok, data } = await mtFetch(creds.base_url, creds.token, "/api/gestor/retornaNota", {
        cnpj: creds.cnpj,
        chave: inv.chave_acesso,
        comXml: 1,
        tipoXml: "nfe",
      });
      if (ok) {
        const ret = data?.retorno || {};
        const xmlB64: string | undefined = ret?.xml || ret?.xml_base64 || ret?.conteudo;
        if (xmlB64 && typeof xmlB64 === "string") inv.xml_base64 = xmlB64;
      }
    } catch (e) {
      console.warn("[mastertax-pull] retornaNota falhou:", inv.chave_acesso, (e as Error).message);
    }
  }

  return { invoices };
}

async function loadCompanyCredentials(supabase: ReturnType<typeof createClient>): Promise<CompanyCreds[]> {
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
    const cnpj = sanitizeCnpj(kv.cnpj || "");
    if (!token || !cnpj) continue;
    out.push({
      company_db: companyDb,
      base_url: normalizeBaseUrl(kv.base_url || DEFAULT_BASE_URL),
      token,
      cnpj,
    });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
      const stats = { company_db: creds.company_db, fetched: 0, upserted: 0, skipped: 0, errors: 0, error: undefined as string | undefined };

      const { data: stateRow } = await supabase
        .from("nf_entrada_settings")
        .select("value")
        .eq("company_db", creds.company_db)
        .eq("key", "last_pull_iso")
        .maybeSingle();
      const sinceIso = (stateRow?.value as { iso?: string })?.iso ||
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const { invoices, error: pullErr } = await fetchInvoicesForCompany(creds, sinceIso);
      stats.fetched = invoices.length;
      result.fetched += invoices.length;
      if (pullErr) {
        stats.error = pullErr;
        stats.errors++;
        result.errors++;
        result.perCompany.push(stats);
        console.error(`[mastertax-pull][${creds.company_db}]`, pullErr);
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
              status: "awaiting_erpflow_approval",
            })
            .select()
            .single();
          if (insErr) throw insErr;

          await supabase.from("nf_entrada_logs").insert({
            import_id: inserted.id,
            step: "mastertax_pull",
            status_to: "awaiting_erpflow_approval",
            message: "NF importada da Master Tax",
            payload: { chave_acesso: inv.chave_acesso, company_db: creds.company_db, cnpj: creds.cnpj },
            actor: "mastertax-pull",
          });

          stats.upserted++;
          result.upserted++;
        } catch (e) {
          console.error(`[mastertax-pull][${creds.company_db}] erro item:`, (e as Error).message);
          stats.errors++;
          result.errors++;
        }
      }

      await supabase.from("nf_entrada_settings").upsert(
        { company_db: creds.company_db, key: "last_pull_iso", value: { iso: new Date().toISOString() } },
        { onConflict: "company_db,key" },
      );

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
