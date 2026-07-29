// Edge function: sales-nfse-reconcile
// Conferência das NFS-e EMITIDAS (notas de saída).
//
// Fonte de verdade: SAP B1 / addon fiscal TaxOne (Invoices + sap-nfse-lookup).
// Fonte de conferência: Master Tax (`/api/notas-servico` com tipo=Prestador).
//
// A Master Tax NÃO substitui o ERP aqui — ela só serve para apontar divergências:
//   • somente_erp        → nota emitida no ERP que a Master Tax não capturou
//   • somente_mastertax  → nota capturada na prefeitura que não existe no ERP
//   • conciliado         → casada por número da NFS-e (ou valor + data na tolerância)
//
// Body: { company_db: string, periodo_inicio: "YYYY-MM-DD", periodo_fim: "YYYY-MM-DD" }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireUserOrSapSession } from "../_shared/auth.ts";
import { DEFAULT_TOLERANCE, dataDentroJanela, valorDentroTolerancia } from "../_shared/fiscal-match.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
};

const MASTERTAX_DEFAULT_BASE = "https://api.mastertax.app";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildBaseUrl(raw: string): string {
  let url = String(raw || "").replace(/\/+$/, "");
  if (!url) throw new Error("URL do SAP B1 não configurada");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

// deno-lint-ignore no-explicit-any
async function loadCreds(sb: any, systemName: string, companyDb: string) {
  const { data, error } = await sb
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", systemName)
    .eq("company_db", companyDb);
  if (error) throw new Error(`Erro credenciais ${systemName}: ${error.message}`);
  const kv: Record<string, string> = {};
  for (const r of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
    kv[r.credential_key] = r.credential_value ?? "";
  }
  return kv;
}

async function sapLogin(baseUrl: string, u: string, p: string, db: string) {
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: u, Password: p, CompanyDB: db }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Falha no login SAP [${r.status}]: ${t.slice(0, 200)}`);
  }
  const j = await r.json().catch(() => ({}));
  const setCookie = r.headers.get("set-cookie") || "";
  const sid = j?.SessionId || setCookie.match(/B1SESSION=([^;]+)/)?.[1];
  const rid = setCookie.match(/(?:B1)?ROUTEID=([^;]+)/)?.[1] || "";
  if (!sid) throw new Error("SAP não retornou SessionId.");
  return { cookies: `B1SESSION=${sid}${rid ? `; ROUTEID=${rid}` : ""}` };
}

interface ErpNota {
  doc_entry: number;
  doc_num: number | null;
  nfse: string | null;
  rps: string | null;
  serie: string | null;
  data_emissao: string;
  valor: number;
  cliente_codigo: string | null;
  cliente_nome: string | null;
  cancelada: boolean;
}

async function fetchErpInvoices(
  baseUrl: string,
  cookies: string,
  inicio: string,
  fim: string,
): Promise<ErpNota[]> {
  const out: ErpNota[] = [];
  const select =
    "DocEntry,DocNum,DocDate,DocTotal,CardCode,CardName,Cancelled,SequenceSerial,SeriesString";
  const filter = `DocDate ge '${inicio}' and DocDate le '${fim}'`;
  let skip = 0;
  while (skip < 2000) {
    const path =
      `Invoices?$select=${select}&$filter=${encodeURIComponent(filter)}&$orderby=DocEntry&$top=100&$skip=${skip}`;
    const r = await fetch(`${baseUrl}/${path}`, { headers: { Cookie: cookies } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = body?.error?.message?.value || JSON.stringify(body);
      throw new Error(`SAP Invoices falhou [${r.status}]: ${String(msg).slice(0, 300)}`);
    }
    // deno-lint-ignore no-explicit-any
    const rows = (body?.value || []) as any[];
    for (const row of rows) {
      out.push({
        doc_entry: Number(row.DocEntry),
        doc_num: row.DocNum != null ? Number(row.DocNum) : null,
        nfse: null,
        rps: row.SequenceSerial != null ? String(row.SequenceSerial) : null,
        serie: row.SeriesString ? String(row.SeriesString) : null,
        data_emissao: String(row.DocDate || "").slice(0, 10),
        valor: Number(row.DocTotal || 0),
        cliente_codigo: row.CardCode ? String(row.CardCode) : null,
        cliente_nome: row.CardName ? String(row.CardName) : null,
        cancelada: String(row.Cancelled || "tNO") === "tYES",
      });
    }
    if (rows.length < 100) break;
    skip += 100;
  }
  return out;
}

interface MtNota {
  numero: string;
  serie: string | null;
  valor: number;
  data_emissao: string;
  tomador_documento: string | null;
  tomador_nome: string | null;
  chave: string | null;
}

// deno-lint-ignore no-explicit-any
function parseMtRow(row: any): MtNota | null {
  const numero = String(
    row?.numero ?? row?.numero_nfse ?? row?.numeroNfse ?? row?.numero_nf ?? "",
  ).trim();
  if (!numero) return null;
  return {
    numero,
    serie: row?.serie != null ? String(row.serie) : null,
    valor: Number(row?.valor ?? row?.valor_total ?? row?.valor_servicos ?? 0) || 0,
    data_emissao: String(row?.dataEmissao ?? row?.data_emissao ?? row?.emissao ?? "").slice(0, 10),
    tomador_documento: String(
      row?.tomadorDocumento ?? row?.cnpj_tomador ?? row?.tomador?.cnpj ?? "",
    ) || null,
    tomador_nome: String(row?.tomadorNome ?? row?.razao_social_tomador ?? row?.tomador?.nome ?? "") ||
      null,
    chave: row?.chave ?? row?.chave_acesso ?? row?.chaveAcesso ?? null,
  };
}

async function fetchMasterTaxEmitidas(
  creds: Record<string, string>,
  inicio: string,
  fim: string,
): Promise<{ notas: MtNota[]; disponivel: boolean; aviso?: string }> {
  const token = (creds.token || "").trim();
  const empresaIds = (creds.empresa_id || "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!token || empresaIds.length === 0) {
    return { notas: [], disponivel: false, aviso: "Master Tax não configurada para esta empresa." };
  }
  const baseUrl = (creds.base_url || MASTERTAX_DEFAULT_BASE).trim().replace(/\/+$/, "");
  const authHeader = token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
  const notas: MtNota[] = [];
  const avisos: string[] = [];

  for (const empresaId of empresaIds) {
    let pagina = 1;
    while (pagina <= 40) {
      const params = new URLSearchParams({
        empresa_id: empresaId,
        emissaoDe: inicio,
        emissaoAte: fim,
        pagina: String(pagina),
        quantidade: "50",
        ordenar: "dataEmissao",
        sentido: "desc",
        tipo: "Prestador",
        retencoes: "todas",
      });
      let resp: Response;
      try {
        resp = await fetch(`${baseUrl}/api/notas-servico?${params.toString()}`, {
          headers: { Authorization: authHeader, Accept: "application/json" },
          signal: AbortSignal.timeout(30000),
        });
      } catch (e) {
        avisos.push(`[${empresaId}] rede: ${(e as Error).message}`);
        break;
      }
      const raw = await resp.text().catch(() => "");
      if (!resp.ok) {
        avisos.push(`[${empresaId}] HTTP ${resp.status}: ${raw.slice(0, 160)}`);
        break;
      }
      // deno-lint-ignore no-explicit-any
      let data: any = null;
      try { data = JSON.parse(raw); } catch { data = null; }
      const retorno = data?.retorno ?? data;
      // deno-lint-ignore no-explicit-any
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
        const n = parseMtRow(r);
        if (n) notas.push(n);
      }
      const lastPage = Number(retorno?.last_page ?? retorno?.meta?.last_page ?? data?.last_page ?? 1);
      if (!rows.length || rows.length < 50 || pagina >= lastPage) break;
      pagina++;
    }
  }
  return { notas, disponivel: true, aviso: avisos.length ? avisos.join(" | ") : undefined };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await requireUserOrSapSession(req).catch(() => null);
    if (!auth) return json({ error: "Não autenticado" }, 401);

    const body = await req.json().catch(() => ({}));
    const companyDb = String(body?.company_db || "").trim();
    const inicio = String(body?.periodo_inicio || "").trim();
    const fim = String(body?.periodo_fim || "").trim();
    if (!companyDb) return json({ error: "company_db obrigatório" }, 400);
    if (!DATE_RE.test(inicio) || !DATE_RE.test(fim)) {
      return json({ error: "periodo_inicio e periodo_fim devem estar no formato YYYY-MM-DD" }, 400);
    }
    if (inicio > fim) return json({ error: "Período inválido" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    /* ── 1. ERP (fonte de verdade) ─────────────────────────── */
    const sapCreds = await loadCreds(supabase, "sap", companyDb);
    if (!sapCreds.service_layer_url || !sapCreds.username || !sapCreds.password) {
      return json({ error: "Credenciais de integração SAP não configuradas para esta empresa." }, 400);
    }
    const baseUrl = buildBaseUrl(sapCreds.service_layer_url);
    const session = await sapLogin(
      baseUrl,
      sapCreds.username,
      sapCreds.password,
      sapCreds.company_db || companyDb,
    );
    const erpNotas = (await fetchErpInvoices(baseUrl, session.cookies, inicio, fim))
      .filter((n) => !n.cancelada);

    // número real da NFS-e (TaxOne) — o RPS do Service Layer não serve para casar
    let lookupIndisponivel = false;
    if (erpNotas.length > 0) {
      const { data: lookup, error: fnErr } = await supabase.functions.invoke("sap-nfse-lookup", {
        body: { company_db: companyDb, doc_entries: erpNotas.map((n) => n.doc_entry) },
      });
      if (fnErr) lookupIndisponivel = true;
      else if (lookup?.unavailable) lookupIndisponivel = true;
      const map = (lookup?.map || {}) as Record<string, { nfse?: string | null; rps?: string | null; serie?: string | null }>;
      for (const n of erpNotas) {
        const info = map[String(n.doc_entry)];
        if (info?.nfse) n.nfse = String(info.nfse);
        if (info?.rps) n.rps = String(info.rps);
        if (info?.serie) n.serie = String(info.serie);
      }
    }

    /* ── 2. Master Tax (conferência) ───────────────────────── */
    const mtCreds = await loadCreds(supabase, "mastertax", companyDb);
    const mt = await fetchMasterTaxEmitidas(mtCreds, inicio, fim);

    /* ── 3. Cruzamento ─────────────────────────────────────── */
    const norm = (v: string | null | undefined) => String(v ?? "").replace(/^0+/, "").trim();
    const mtRestantes = [...mt.notas];
    const conciliado: unknown[] = [];
    const somenteErp: unknown[] = [];

    for (const n of erpNotas) {
      let idx = -1;
      let criterio = "";
      if (n.nfse) {
        idx = mtRestantes.findIndex((m) => norm(m.numero) === norm(n.nfse));
        if (idx >= 0) criterio = "numero_nfse";
      }
      if (idx < 0) {
        idx = mtRestantes.findIndex((m) => {
          const v = valorDentroTolerancia(m.valor, n.valor, DEFAULT_TOLERANCE);
          const d = m.data_emissao && n.data_emissao
            ? dataDentroJanela(n.data_emissao, m.data_emissao, DEFAULT_TOLERANCE)
            : { ok: false, diff: 0 };
          return v.ok && d.ok;
        });
        if (idx >= 0) criterio = "valor_data";
      }
      if (idx >= 0) {
        const m = mtRestantes.splice(idx, 1)[0];
        conciliado.push({ erp: n, mastertax: m, criterio });
      } else {
        somenteErp.push(n);
      }
    }

    return json({
      ok: true,
      company_db: companyDb,
      periodo: { inicio, fim },
      fonte_verdade: "sap_taxone",
      mastertax_disponivel: mt.disponivel,
      mastertax_aviso: mt.aviso ?? null,
      nfse_lookup_indisponivel: lookupIndisponivel,
      totais: {
        erp: erpNotas.length,
        mastertax: mt.notas.length,
        conciliado: conciliado.length,
        somente_erp: somenteErp.length,
        somente_mastertax: mtRestantes.length,
      },
      conciliado,
      somente_erp: somenteErp,
      somente_mastertax: mtRestantes,
    });
  } catch (e) {
    console.error("sales-nfse-reconcile error", e);
    return json({ error: (e as Error).message || "Erro inesperado" }, 500);
  }
});
