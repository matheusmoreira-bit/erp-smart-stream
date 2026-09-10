// Edge function: mastertax-po-nf-search
//
// A partir de um Pedido de Compra JÁ EXISTENTE no SAP, procura na Master Tax
// (e nas notas já importadas) a NF correspondente, deixa o usuário escolher
// entre os candidatos e lança a NF de Entrada (efetiva) ou apenas o esboço.
//
// Autorização: admin Cloud, admin SAP ou grupo com o módulo "nf_entrada"
// (Contábil & Fiscal / Admins). Nenhuma regra depende do NOME do grupo.
// Credenciais Master Tax e SAP são lidas server-side em system_credentials.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsFor, rejectForeignOrigin } from "../_shared/cors-allowlist.ts";

// CORS restrito por allowlist; inclui os cabeçalhos de sessão SAP usados pelo app.
let corsHeaders: Record<string, string> = corsFor(new Request("http://localhost"));
import { requireAdminOrSapModule, authErrorResponse } from "../_shared/auth.ts";
import { getIntegrationPause, pauseResponse } from "../_shared/integration-pause.ts";

const DEFAULT_MASTERTAX_URL = "https://api.mastertax.app";
const MAX_WINDOW_DAYS = 180;
const DEFAULT_WINDOW_DAYS = 90;
const MAX_CANDIDATES = 20;

type Sb = ReturnType<typeof createClient>;

interface Candidate {
  chave_acesso: string;
  numero_nf: string;
  serie: string;
  cnpj_fornecedor: string;
  nome_fornecedor: string;
  data_emissao: string;
  valor_total: number;
  source: "mastertax" | "importada";
  import_id?: string;
  alreadyLinkedPoDocEntry?: string | null;
  alreadyPosted?: boolean;
  score: number;
  confidence: number;
  reasons: string[];
  valorDiff: number;
  diasDiff: number | null;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function onlyDigits(v: unknown): string {
  return String(v ?? "").replace(/\D+/g, "");
}

function normalizeName(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.round(Math.abs(ta - tb) / 86_400_000);
}

/* ─────────── SAP ─────────── */

function buildSapBaseUrl(raw: string): string {
  let url = (raw || "").replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function loadSapCreds(sb: Sb, companyDb: string) {
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
  return {
    baseUrl: buildSapBaseUrl(kv.service_layer_url),
    companyDB: kv.company_db || companyDb,
    username: kv.username,
    password: kv.password,
  };
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

interface PoInfo {
  DocEntry: number;
  DocNum: number | null;
  CardCode: string;
  CardName: string | null;
  DocDate: string | null;
  DocTotal: number;
  DocumentStatus: string | null;
  DocumentLines: Array<Record<string, unknown>>;
  supplierTaxId: string;
  supplierCountry: string;
  supplierInternational: boolean;
  DocCurrency: string | null;
}

async function loadPurchaseOrder(baseUrl: string, cookie: string, docEntry: number): Promise<PoInfo | null> {
  const r = await fetch(
    `${baseUrl}/PurchaseOrders(${docEntry})?$select=DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,DocCurrency,DocumentStatus,DocumentLines`,
    { headers: { Cookie: cookie } },
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Consulta do PC ${docEntry} falhou ${r.status}`);
  const po = await r.json();

  let supplierTaxId = "";
  let supplierCountry = "";
  if (po.CardCode) {
    try {
      const bp = await fetch(
        `${baseUrl}/BusinessPartners('${encodeURIComponent(po.CardCode)}')?$select=CardCode,CardName,FederalTaxID,Country`,
        { headers: { Cookie: cookie } },
      );
      if (bp.ok) {
        const bpj = await bp.json();
        supplierTaxId = onlyDigits(bpj?.FederalTaxID);
        supplierCountry = String(bpj?.Country ?? "").toUpperCase();
      }
    } catch { /* fornecedor sem CNPJ cadastrado — segue por nome/valor */ }
  }

  // Fornecedor internacional: país diferente de BR, ou sem CNPJ/CPF válido.
  const supplierInternational =
    (!!supplierCountry && supplierCountry !== "BR") ||
    (!supplierCountry && supplierTaxId.length !== 14 && supplierTaxId.length !== 11);

  return {
    DocEntry: Number(po.DocEntry),
    DocNum: po.DocNum ?? null,
    CardCode: String(po.CardCode ?? ""),
    CardName: po.CardName ?? null,
    DocDate: po.DocDate ? String(po.DocDate).slice(0, 10) : null,
    DocTotal: Number(po.DocTotal ?? 0),
    DocumentStatus: po.DocumentStatus ?? null,
    DocumentLines: Array.isArray(po.DocumentLines) ? po.DocumentLines : [],
    supplierTaxId,
    supplierCountry,
    supplierInternational,
    DocCurrency: po.DocCurrency ?? null,
  };
}

/* ─────────── Master Tax ─────────── */

interface MtCreds {
  base_url: string;
  token: string;
  empresa_ids: string[];
  cnpj: string;
}

async function loadMasterTaxCreds(sb: Sb, companyDb: string): Promise<MtCreds | null> {
  const { data } = await sb
    .from("system_credentials")
    .select("company_db, credential_key, credential_value")
    .eq("system_name", "mastertax");
  const rows = (data || []) as Array<{ company_db: string | null; credential_key: string; credential_value: string }>;
  const pick = (scope: string | null) => {
    const kv: Record<string, string> = {};
    for (const r of rows) {
      if ((r.company_db || null) === scope) kv[r.credential_key] = r.credential_value ?? "";
    }
    return kv;
  };
  const kv = Object.keys(pick(companyDb)).length ? pick(companyDb) : pick(null);
  const token = (kv.token || "").trim();
  const empresaIds = (kv.empresa_id || "")
    .split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!token || !empresaIds.length) return null;
  return {
    base_url: (kv.base_url || DEFAULT_MASTERTAX_URL).trim().replace(/\/+$/, "") || DEFAULT_MASTERTAX_URL,
    token,
    empresa_ids: empresaIds,
    cnpj: onlyDigits(kv.cnpj),
  };
}

interface MtNota {
  chave_acesso: string;
  numero_nf: string;
  serie: string;
  cnpj_fornecedor: string;
  nome_fornecedor: string;
  cnpj_destinatario: string;
  data_emissao: string;
  valor_total: number;
  itens: Array<Record<string, unknown>>;
  impostos: Record<string, unknown>;
  raw: Record<string, unknown>;
}

// deno-lint-ignore no-explicit-any
function parseNota(row: any): MtNota | null {
  const chave: string | undefined =
    row?.chave || row?.chave_acesso || row?.chaveAcesso || row?.chNFe ||
    row?.codigo_verificacao || row?.id;
  if (!chave || typeof chave !== "string") return null;
  return {
    chave_acesso: chave,
    numero_nf: String(row?.numero ?? row?.nNF ?? row?.numero_nf ?? row?.numero_nfse ?? ""),
    serie: String(row?.serie ?? row?.serie_nf ?? ""),
    cnpj_fornecedor: onlyDigits(
      row?.emitenteDocumento ?? row?.prestadorDocumento ?? row?.cnpj_prestador ??
      row?.prestador?.cnpj ?? row?.cnpj_emit ?? row?.cnpjEmit ?? row?.cnpj_emitente ??
      row?.cnpj_fornecedor ?? "",
    ),
    nome_fornecedor: String(
      row?.emitenteNome ?? row?.prestadorNome ?? row?.razao_social_prestador ??
      row?.prestador?.razao_social ?? row?.prestador?.nome ?? row?.nome_emit ??
      row?.nomeEmit ?? row?.razao_emit ?? row?.nome_fornecedor ?? "",
    ),
    cnpj_destinatario: onlyDigits(
      row?.tomadorDocumento ?? row?.destinatarioDocumento ?? row?.cnpj_tomador ??
      row?.tomador?.cnpj ?? row?.cnpj_dest ?? "",
    ),
    data_emissao: (String(row?.dataEmissao ?? row?.data_emissao ?? row?.dhEmi ?? row?.emissao ?? "").slice(0, 10)) || "",
    valor_total: Number(row?.valor ?? row?.valor_total ?? row?.valor_servicos ?? row?.vNF ?? 0) || 0,
    itens: Array.isArray(row?.itens) ? row.itens : [],
    impostos: (typeof row?.impostos === "object" && row?.impostos) ? row.impostos : {},
    raw: row,
  };
}

async function fetchMasterTaxRange(
  creds: MtCreds,
  empresaId: string,
  de: string,
  ate: string,
): Promise<{ notas: MtNota[]; error?: string }> {
  const notas: MtNota[] = [];
  const authHeader = creds.token.toLowerCase().startsWith("bearer ") ? creds.token : `Bearer ${creds.token}`;
  const limite = 50;
  let pagina = 1;
  let error: string | undefined;

  while (true) {
    const params = new URLSearchParams({
      empresa_id: empresaId,
      emissaoDe: de,
      emissaoAte: ate,
      pagina: String(pagina),
      quantidade: String(limite),
      ordenar: "dataEmissao",
      sentido: "desc",
      tipo: "Tomador",
      retencoes: "todas",
    });
    let resp: Response;
    try {
      resp = await fetch(`${creds.base_url}/api/notas-servico?${params.toString()}`, {
        headers: { Authorization: authHeader, Accept: "application/json" },
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      error = `Master Tax indisponível: ${(e as Error).message}`;
      break;
    }
    const raw = await resp.text().catch(() => "");
    if (!resp.ok) {
      error = `Master Tax HTTP ${resp.status}`;
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
          : Array.isArray(data) ? data : [];
    for (const r of rows) {
      const n = parseNota(r);
      if (n) notas.push(n);
    }
    const lastPage = Number(
      retorno?.last_page ?? retorno?.meta?.last_page ?? data?.meta?.last_page ??
      data?.last_page ?? data?.pagination?.last_page ?? 1,
    );
    if (!rows.length || rows.length < limite || pagina >= lastPage || pagina >= 20) break;
    pagina++;
  }
  return { notas, error };
}

/* ─────────── Score ─────────── */

function scoreCandidate(po: PoInfo, n: {
  cnpj_fornecedor: string;
  nome_fornecedor: string;
  valor_total: number;
  data_emissao: string | null;
}): { score: number; confidence: number; reasons: string[]; valorDiff: number; diasDiff: number | null } {
  const reasons: string[] = [];
  let score = 0;

  const cnpj = onlyDigits(n.cnpj_fornecedor);
  if (po.supplierTaxId && cnpj && cnpj === po.supplierTaxId) {
    score += 50;
    reasons.push("CNPJ do fornecedor confere");
  } else if (po.CardName && normalizeName(n.nome_fornecedor) &&
    (normalizeName(n.nome_fornecedor).includes(normalizeName(po.CardName).split(" ")[0]) ||
      normalizeName(po.CardName).includes(normalizeName(n.nome_fornecedor).split(" ")[0]))) {
    score += 20;
    reasons.push("Nome do fornecedor parecido");
  }

  const total = Math.abs(Number(po.DocTotal || 0));
  const valor = Math.abs(Number(n.valor_total || 0));
  const valorDiff = Number((valor - total).toFixed(2));
  const rel = total > 0 ? Math.abs(valorDiff) / total : 1;
  if (Math.abs(valorDiff) < 0.01) { score += 40; reasons.push("Valor idêntico"); }
  else if (rel <= 0.01) { score += 30; reasons.push("Valor até 1% de diferença"); }
  else if (rel <= 0.05) { score += 15; reasons.push("Valor até 5% de diferença"); }

  const diasDiff = daysBetween(po.DocDate, n.data_emissao || null);
  if (diasDiff != null) {
    if (diasDiff <= 15) { score += 15; reasons.push("Emitida perto da data do pedido"); }
    else if (diasDiff <= 45) { score += 8; reasons.push("Emitida no mesmo período"); }
  }

  // Confiança em % (máximo teórico 105 pontos → limitado a 100).
  return { score, confidence: Math.max(0, Math.min(100, score)), reasons, valorDiff, diasDiff };
}

/* ─────────── Handler ─────────── */

Deno.serve(async (req) => {
  corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;

  let caller: { email?: string | null; userName?: string | null } & Record<string, unknown>;
  try {
    caller = await requireAdminOrSapModule(req, "nf_entrada") as never;
  } catch (err) {
    return authErrorResponse(err, corsHeaders);
  }

  const actor = String(caller.userName || caller.email || "mastertax-po-nf-search");

  let body: {
    action?: string;
    company_db?: string;
    po_doc_entry?: number | string;
    window_days?: number;
    chave_acesso?: string;
    mode?: string;
  } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const action = String(body.action || "search");
  const companyDb = String(body.company_db || "").trim();
  const poEntry = Number(body.po_doc_entry);
  if (!companyDb) return json(400, { error: "company_db é obrigatório" });
  if (!Number.isFinite(poEntry) || poEntry <= 0) return json(400, { error: "po_doc_entry inválido" });

  // A empresa do chamador (quando há sessão SAP) precisa bater com a informada.
  const headerCompany = req.headers.get("x-company-db");
  if (headerCompany && headerCompany !== companyDb) {
    return json(403, { error: "Empresa da sessão diferente da solicitada" });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (action !== "search") {
    const pause = await getIntegrationPause("sap_b1");
    if (pause) return pauseResponse(pause, corsHeaders);
  }

  let baseUrl = "";
  let cookie = "";
  try {
    const creds = await loadSapCreds(sb, companyDb);
    baseUrl = creds.baseUrl;
    cookie = await sapLogin(baseUrl, creds.companyDB, creds.username, creds.password);
  } catch (e) {
    return json(502, { error: (e as Error).message });
  }

  try {
    const po = await loadPurchaseOrder(baseUrl, cookie, poEntry);
    if (!po) return json(404, { error: `Pedido de compra ${poEntry} não encontrado no ERP` });

    if (action === "search") {
      const windowDays = Math.min(
        Math.max(Number(body.window_days) || DEFAULT_WINDOW_DAYS, 15),
        MAX_WINDOW_DAYS,
      );
      const ref = po.DocDate ? new Date(po.DocDate) : new Date();
      const de = isoDay(new Date(ref.getTime() - windowDays * 86_400_000));
      const ateRaw = new Date(ref.getTime() + windowDays * 86_400_000);
      const today = new Date();
      const ate = isoDay(ateRaw > today ? today : ateRaw);

      // Notas já importadas na base (mesma empresa, dentro da janela).
      const { data: localRows } = await sb
        .from("nf_entrada_imports")
        .select("id, chave_acesso, numero_nf, serie, cnpj_fornecedor, nome_fornecedor, data_emissao, valor_total, sap_matched_po_doc_entry, erp_invoice_posted, status")
        .eq("sap_company_db", companyDb)
        .gte("data_emissao", de)
        .lte("data_emissao", ate)
        .limit(500);

      const byChave = new Map<string, Candidate>();
      for (const r of (localRows || []) as Array<Record<string, string | number | boolean | null>>) {
        const chave = String(r.chave_acesso || "");
        if (!chave || r.status === "cancelled") continue;
        const s = scoreCandidate(po, {
          cnpj_fornecedor: String(r.cnpj_fornecedor || ""),
          nome_fornecedor: String(r.nome_fornecedor || ""),
          valor_total: Number(r.valor_total || 0),
          data_emissao: r.data_emissao ? String(r.data_emissao) : null,
        });
        byChave.set(chave, {
          chave_acesso: chave,
          numero_nf: String(r.numero_nf || ""),
          serie: String(r.serie || ""),
          cnpj_fornecedor: String(r.cnpj_fornecedor || ""),
          nome_fornecedor: String(r.nome_fornecedor || ""),
          data_emissao: String(r.data_emissao || ""),
          valor_total: Number(r.valor_total || 0),
          source: "importada",
          import_id: String(r.id),
          alreadyLinkedPoDocEntry: r.sap_matched_po_doc_entry ? String(r.sap_matched_po_doc_entry) : null,
          alreadyPosted: r.erp_invoice_posted === true,
          ...s,
        });
      }

      // Master Tax (opcional: se não houver credencial, só usamos as importadas).
      let mtError: string | undefined;
      const mt = await loadMasterTaxCreds(sb, companyDb);
      if (mt) {
        for (const empresaId of mt.empresa_ids) {
          const { notas, error } = await fetchMasterTaxRange(mt, empresaId, de, ate);
          if (error) mtError = error;
          for (const n of notas) {
            if (mt.cnpj && n.cnpj_destinatario && n.cnpj_destinatario !== mt.cnpj) continue;
            if (byChave.has(n.chave_acesso)) continue;
            const s = scoreCandidate(po, n);
            byChave.set(n.chave_acesso, {
              chave_acesso: n.chave_acesso,
              numero_nf: n.numero_nf,
              serie: n.serie,
              cnpj_fornecedor: n.cnpj_fornecedor,
              nome_fornecedor: n.nome_fornecedor,
              data_emissao: n.data_emissao,
              valor_total: n.valor_total,
              source: "mastertax",
              alreadyLinkedPoDocEntry: null,
              alreadyPosted: false,
              ...s,
            });
          }
        }
      }

      const candidates = Array.from(byChave.values())
        .filter((c) => c.score >= 15)
        .sort((a, b) => b.score - a.score || Math.abs(a.valorDiff) - Math.abs(b.valorDiff))
        .slice(0, MAX_CANDIDATES);

      return json(200, {
        ok: true,
        purchaseOrder: {
          docEntry: po.DocEntry,
          docNum: po.DocNum,
          cardCode: po.CardCode,
          cardName: po.CardName,
          docDate: po.DocDate,
          docTotal: po.DocTotal,
          documentStatus: po.DocumentStatus,
        },
        window: { de, ate },
        candidates,
        masterTaxConfigured: !!mt,
        warning: mtError || null,
      });
    }

    if (action !== "link") return json(400, { error: "Ação inválida" });

    const mode = body.mode === "post" ? "post" : "draft";
    const chave = String(body.chave_acesso || "").trim();
    if (!chave) return json(400, { error: "chave_acesso é obrigatória" });
    if (po.DocumentStatus === "bost_Close") {
      return json(409, { error: "Pedido de compra já está fechado no ERP." });
    }

    // 1) Garantir o registro local da NF (idempotente por chave de acesso).
    const { data: existing } = await sb
      .from("nf_entrada_imports")
      .select("*")
      .eq("chave_acesso", chave)
      .maybeSingle();

    // deno-lint-ignore no-explicit-any
    let row: any = existing;

    if (!row) {
      const mt = await loadMasterTaxCreds(sb, companyDb);
      if (!mt) return json(409, { error: "Nota não importada e Master Tax não configurada para esta empresa." });
      const ref = po.DocDate ? new Date(po.DocDate) : new Date();
      const de = isoDay(new Date(ref.getTime() - MAX_WINDOW_DAYS * 86_400_000));
      const today = new Date();
      const ateRaw = new Date(ref.getTime() + MAX_WINDOW_DAYS * 86_400_000);
      const ate = isoDay(ateRaw > today ? today : ateRaw);
      let found: MtNota | null = null;
      for (const empresaId of mt.empresa_ids) {
        const { notas } = await fetchMasterTaxRange(mt, empresaId, de, ate);
        found = notas.find((n) => n.chave_acesso === chave) || null;
        if (found) break;
      }
      if (!found) return json(404, { error: "Nota não encontrada na Master Tax." });
      if (mt.cnpj && found.cnpj_destinatario && found.cnpj_destinatario !== mt.cnpj) {
        return json(403, { error: "Nota pertence a outra empresa." });
      }
      const { data: inserted, error: insErr } = await sb
        .from("nf_entrada_imports")
        .upsert({
          chave_acesso: found.chave_acesso,
          numero_nf: found.numero_nf,
          serie: found.serie,
          cnpj_fornecedor: found.cnpj_fornecedor,
          nome_fornecedor: found.nome_fornecedor,
          cnpj_destinatario: found.cnpj_destinatario || mt.cnpj || null,
          data_emissao: found.data_emissao || null,
          valor_total: found.valor_total,
          itens: found.itens,
          impostos: found.impostos,
          raw_mastertax: found.raw,
          sap_company_db: companyDb,
          status: "awaiting_sap",
        }, { onConflict: "chave_acesso" })
        .select("*")
        .maybeSingle();
      if (insErr) return json(500, { error: insErr.message });
      row = inserted;
    }

    if (!row) return json(500, { error: "Falha ao registrar a nota." });
    if (row.status === "cancelled") return json(409, { error: "Nota cancelada — não é possível lançar." });
    if (row.sap_company_db && row.sap_company_db !== companyDb) {
      return json(403, { error: "Nota pertence a outra empresa." });
    }
    if (row.sap_matched_po_doc_entry && String(row.sap_matched_po_doc_entry) !== String(poEntry)) {
      return json(409, {
        error: `Nota já vinculada ao pedido #${row.sap_matched_po_doc_num || row.sap_matched_po_doc_entry}.`,
      });
    }

    // 2) Vincular ao pedido escolhido.
    await sb.from("nf_entrada_imports").update({
      sap_company_db: companyDb,
      sap_matched_po_doc_entry: String(po.DocEntry),
      sap_matched_po_doc_num: po.DocNum != null ? String(po.DocNum) : null,
      sap_matched_card_code: po.CardCode,
      sap_matched_po_is_draft: false,
      sap_match_reason: "manual_po_search",
      match_resolved_at: new Date().toISOString(),
      match_resolved_by: actor,
      last_error: null,
    }).eq("id", row.id);

    const lines = po.DocumentLines.length
      ? po.DocumentLines.map((l) => ({ BaseType: 22, BaseEntry: po.DocEntry, BaseLine: l.LineNum ?? 0 }))
      : [{ BaseType: 22, BaseEntry: po.DocEntry, BaseLine: 0 }];

    // 3) Esboço ou lançamento efetivo (ambos idempotentes).
    if (mode === "draft") {
      if (row.sap_invoice_draft_id) {
        return json(200, { ok: true, alreadyExists: true, mode, draftId: row.sap_invoice_draft_id, importId: row.id });
      }
      const resp = await fetch(`${baseUrl}/Drafts`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          DocObjectCode: "oPurchaseInvoices",
          CardCode: po.CardCode,
          Comments: `NF Entrada chave ${chave} (vinculada ao PC #${po.DocNum ?? po.DocEntry})`,
          DocumentLines: lines,
        }),
      });
      if (!resp.ok) {
        const msg = `Esboço da NF de entrada falhou ${resp.status}: ${(await resp.text()).slice(0, 300)}`;
        await sb.from("nf_entrada_imports").update({ last_error: msg }).eq("id", row.id);
        await sb.from("nf_entrada_logs").insert({
          import_id: row.id, step: "manual_po_link", message: msg, actor,
        });
        return json(502, { error: msg });
      }
      const draftId = String((await resp.json()).DocEntry);
      await sb.from("nf_entrada_imports").update({
        sap_invoice_draft_id: draftId,
        status: "completed",
        last_error: null,
      }).eq("id", row.id);
      await sb.from("nf_entrada_logs").insert({
        import_id: row.id,
        step: "manual_po_link",
        status_from: row.status,
        status_to: "completed",
        message: `Esboço de NF de Entrada criado a partir da busca manual na Master Tax — PC ${po.DocNum ?? po.DocEntry}, Draft ${draftId}`,
        actor,
      });
      return json(200, { ok: true, mode, draftId, importId: row.id, poDocNum: po.DocNum });
    }

    // mode === "post"
    if (row.erp_invoice_posted && row.erp_invoice_doc_entry) {
      return json(200, {
        ok: true, alreadyExists: true, mode,
        invoiceDocEntry: row.erp_invoice_doc_entry,
        invoiceDocNum: row.erp_invoice_doc_num,
        importId: row.id,
      });
    }
    const invResp = await fetch(`${baseUrl}/PurchaseInvoices`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        CardCode: po.CardCode,
        DocDate: row.data_emissao || undefined,
        TaxDate: row.data_emissao || undefined,
        Comments: `NF Entrada chave ${chave} (vinculada ao PC #${po.DocNum ?? po.DocEntry})`,
        DocumentLines: lines,
      }),
    });
    if (!invResp.ok) {
      const msg = `Lançamento da NF de entrada falhou ${invResp.status}: ${(await invResp.text()).slice(0, 300)}`;
      await sb.from("nf_entrada_imports").update({ last_error: msg }).eq("id", row.id);
      await sb.from("nf_entrada_logs").insert({
        import_id: row.id, step: "manual_po_link", message: msg, actor,
      });
      return json(502, { error: msg });
    }
    const inv = await invResp.json();
    await sb.from("nf_entrada_imports").update({
      erp_invoice_doc_entry: String(inv.DocEntry),
      erp_invoice_doc_num: inv.DocNum != null ? String(inv.DocNum) : null,
      erp_invoice_posted: true,
      erp_invoice_checked_at: new Date().toISOString(),
      status: "completed",
      last_error: null,
    }).eq("id", row.id);
    await sb.from("nf_entrada_logs").insert({
      import_id: row.id,
      step: "manual_po_link",
      status_from: row.status,
      status_to: "completed",
      message: `NF de Entrada lançada a partir da busca manual na Master Tax — PC ${po.DocNum ?? po.DocEntry}, NF ERP #${inv.DocNum ?? inv.DocEntry}`,
      actor,
    });
    return json(200, {
      ok: true, mode,
      invoiceDocEntry: String(inv.DocEntry),
      invoiceDocNum: inv.DocNum != null ? String(inv.DocNum) : null,
      importId: row.id,
      poDocNum: po.DocNum,
    });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  } finally {
    await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
  }
});
