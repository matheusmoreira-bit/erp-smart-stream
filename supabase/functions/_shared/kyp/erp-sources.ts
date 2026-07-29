// Fontes de fornecedores por ERP + ações de bloqueio, para o módulo KYP.
// Toda credencial vem de public.system_credentials (server-side, service role).

import {
  buildSapBaseUrl,
  loadSapCreds,
  sapCookieLogin,
  sapLogout,
  type Sb,
} from "../sap-cache.ts";
import { classificarDocumento, onlyDigits, type TipoPessoa } from "./types.ts";

export interface FornecedorERP {
  companyDb: string;
  erp: "SAP" | "OMIE";
  codigo: string;
  nome: string;
  documento: string;
  tipoPessoa: TipoPessoa;
  detalhes: Record<string, unknown>;
}

/* --------------------------------- SAP B1 --------------------------------- */

const SAP_SELECT =
  "CardName,CardCode,CardType,CreateDate,BPFiscalTaxIDCollection,Valid,Frozen,U_FGR_TAXID0";
const SAP_SELECT_FALLBACK =
  "CardName,CardCode,CardType,CreateDate,BPFiscalTaxIDCollection,Valid,Frozen";

interface SapBP {
  CardCode?: string;
  CardName?: string;
  Valid?: string;
  Frozen?: string;
  U_FGR_TAXID0?: string | null;
  BPFiscalTaxIDCollection?: Array<{ TaxId0?: string | null; TaxId4?: string | null }>;
}

function sapDocumento(bp: SapBP): string {
  const custom = onlyDigits(bp.U_FGR_TAXID0 ?? "");
  if (custom) return custom;
  const coll = bp.BPFiscalTaxIDCollection?.[0];
  return onlyDigits(coll?.TaxId0 ?? coll?.TaxId4 ?? "");
}

export async function sapSession(sb: Sb, companyDb: string) {
  const creds = await loadSapCreds(sb, companyDb);
  if (!creds) return null;
  const baseUrl = buildSapBaseUrl(creds.service_layer_url);
  const cookie = await sapCookieLogin(baseUrl, creds.company_db || companyDb, creds.username, creds.password);
  return { baseUrl, cookie };
}

export async function sapListSuppliers(
  session: { baseUrl: string; cookie: string },
  companyDb: string,
  maxPages = 60,
): Promise<FornecedorERP[]> {
  const out: FornecedorERP[] = [];
  let select = SAP_SELECT;
  let url =
    `${session.baseUrl}/BusinessPartners?$select=${select}&$filter=CardType eq 'S'&$top=100`;
  let pages = 0;

  while (url && pages < maxPages) {
    const res = await fetch(url, {
      headers: { Cookie: session.cookie, Prefer: "odata.maxpagesize=100" },
    });
    if (!res.ok) {
      // U_FGR_TAXID0 pode não existir na base — refaz sem o campo customizado
      if (select === SAP_SELECT && pages === 0) {
        select = SAP_SELECT_FALLBACK;
        url = `${session.baseUrl}/BusinessPartners?$select=${select}&$filter=CardType eq 'S'&$top=100`;
        continue;
      }
      throw new Error(`SAP BusinessPartners falhou (HTTP ${res.status}) em ${companyDb}`);
    }
    const payload = await res.json() as { value?: SapBP[]; "@odata.nextLink"?: string };
    for (const bp of payload.value ?? []) {
      const doc = classificarDocumento(sapDocumento(bp));
      if (!doc || !bp.CardCode) continue;
      out.push({
        companyDb,
        erp: "SAP",
        codigo: bp.CardCode,
        nome: bp.CardName ?? "",
        documento: doc.documento,
        tipoPessoa: doc.tipoPessoa,
        detalhes: { valid: bp.Valid ?? null, frozen: bp.Frozen ?? null },
      });
    }
    const next = payload["@odata.nextLink"];
    url = next ? (next.startsWith("http") ? next : `${session.baseUrl}/${next.replace(/^\/+/, "")}`) : "";
    pages++;
  }
  return out;
}

/** Bloqueio no SAP: escopo restrito a Frozen/Valid/FrozenFrom. */
export async function sapBlockSupplier(
  session: { baseUrl: string; cookie: string },
  cardCode: string,
): Promise<void> {
  const res = await fetch(`${session.baseUrl}/BusinessPartners('${encodeURIComponent(cardCode)}')`, {
    method: "PATCH",
    headers: { Cookie: session.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      Frozen: "tYES",
      Valid: "tNO",
      FrozenFrom: new Date().toISOString().slice(0, 10),
    }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`SAP bloqueio de ${cardCode} falhou (HTTP ${res.status})`);
  }
}

export async function sapClose(session: { baseUrl: string; cookie: string }) {
  try {
    await sapLogout(session.baseUrl, session.cookie);
  } catch { /* best-effort */ }
}

/* ---------------------------------- OMIE ---------------------------------- */

const OMIE_CLIENTES_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

export async function omieCreds(sb: Sb, companyDb: string) {
  const { data } = await sb
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "omie")
    .eq("company_db", companyDb);
  const kv: Record<string, string> = {};
  for (const r of (data ?? []) as Array<{ credential_key: string; credential_value: string }>) {
    kv[r.credential_key] = r.credential_value ?? "";
  }
  if (!kv.app_key || !kv.app_secret) return null;
  return { appKey: kv.app_key, appSecret: kv.app_secret };
}

async function omieCall(
  creds: { appKey: string; appSecret: string },
  call: string,
  param: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(OMIE_CLIENTES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      call,
      app_key: creds.appKey,
      app_secret: creds.appSecret,
      param: [param],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { faultstring?: string })?.faultstring || `HTTP ${res.status}`;
    throw new Error(`Omie ${call} falhou: ${msg}`);
  }
  return body as Record<string, unknown>;
}

export async function omieListSuppliers(
  creds: { appKey: string; appSecret: string },
  companyDb: string,
  maxPages = 100,
): Promise<FornecedorERP[]> {
  const out: FornecedorERP[] = [];
  let pagina = 1;
  let total = 1;
  while (pagina <= total && pagina <= maxPages) {
    const body = await omieCall(creds, "ListarClientes", {
      pagina,
      registros_por_pagina: 500,
      apenas_importado_api: "N",
    });
    total = Number(body.total_de_paginas ?? 1);
    const rows = (body.clientes_cadastro ?? []) as Array<Record<string, unknown>>;
    for (const c of rows) {
      const doc = classificarDocumento(c.cnpj_cpf);
      const codigo = String(c.codigo_cliente_omie ?? "");
      if (!doc || !codigo) continue;
      out.push({
        companyDb,
        erp: "OMIE",
        codigo,
        nome: String(c.nome_fantasia || c.razao_social || ""),
        documento: doc.documento,
        tipoPessoa: doc.tipoPessoa,
        detalhes: { inativo: c.inativo ?? null },
      });
    }
    pagina++;
  }
  return out;
}

export async function omieBlockSupplier(
  creds: { appKey: string; appSecret: string },
  codigoClienteOmie: string,
): Promise<void> {
  await omieCall(creds, "AlterarCliente", {
    codigo_cliente_omie: Number(codigoClienteOmie),
    inativo: "S",
  });
}
