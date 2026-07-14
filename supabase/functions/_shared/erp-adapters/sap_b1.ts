// Adapter SAP B1 — traduz notas de fornecedor pagas em ContaPagaERP[].
// Reaproveita a sessão Service Layer usada em nf-entrada-rematch (Login/Logout com cookie B1SESSION).
//
// IMPORTANTE: este adapter cruza NOTA × PAGAMENTO (baixa financeira),
// diferente do fluxo existente de nota × Pedido de Compra. Aqui usamos
// PurchaseInvoices totalmente pagas (DocumentStatus='bost_Close' e
// PaidToDate ≈ DocTotal) como aproximação de "conta paga". Um refinamento
// futuro pode consultar VendorPayments/IncomingPayments diretamente.

import { normalizeCnpj } from "../fiscal-match.ts";
import type { AdapterContext, ContaPagaERP, ErpAdapter } from "./types.ts";

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
  if (!r.ok) throw new Error(`SAP Login falhou ${r.status}`);
  await r.json().catch(() => ({}));
  const sc = r.headers.get("set-cookie") || "";
  const sess = sc.match(/B1SESSION=([^;]+)/)?.[1];
  const route = sc.match(/ROUTEID=([^;]+)/)?.[1];
  if (!sess) throw new Error("B1SESSION ausente");
  return `B1SESSION=${sess}${route ? `; ROUTEID=${route}` : ""}`;
}

async function loadSapCreds(
  supabase: any, companyDb: string,
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
    username: kv.username, password: kv.password,
  };
}

async function fetchSupplierCnpjMap(baseUrl: string, cookie: string): Promise<Map<string, { cnpj: string; nome: string }>> {
  const map = new Map<string, { cnpj: string; nome: string }>();
  let skip = 0;
  for (let page = 0; page < 20; page++) {
    const r = await fetch(
      `${baseUrl}/BusinessPartners?$filter=CardType eq 'cSupplier'&$select=CardCode,CardName,FederalTaxID&$top=500&$skip=${skip}`,
      { headers: { Cookie: cookie, Prefer: "odata.maxpagesize=500" } },
    );
    if (!r.ok) break;
    const arr = ((await r.json())?.value || []) as Array<{ CardCode: string; CardName: string; FederalTaxID: string | null }>;
    for (const bp of arr) {
      map.set(bp.CardCode, { cnpj: normalizeCnpj(bp.FederalTaxID || ""), nome: bp.CardName || "" });
    }
    if (arr.length < 500) break;
    skip += 500;
  }
  return map;
}

interface SapPurchaseInvoice {
  DocEntry: number;
  DocNum: number;
  DocDate: string;
  DocDueDate: string | null;
  ClosingDate?: string | null;
  CardCode: string;
  CardName: string;
  DocTotal: number;
  PaidToDate: number;
  DocumentStatus: string;
  Cancelled?: string;
}

async function listPaidPurchaseInvoices(
  baseUrl: string, cookie: string, periodoInicio: string, periodoFim: string,
): Promise<SapPurchaseInvoice[]> {
  // Filtra por DocDueDate no período (aproximação da "data da baixa" quando o SAP não expõe a data da baixa
  // no próprio Invoice). O motor de auditoria tem tolerância de dias configurável.
  const filter =
    `DocumentStatus eq 'bost_Close' and Cancelled eq 'tNO' and DocDueDate ge '${periodoInicio}' and DocDueDate le '${periodoFim}'`;
  const select = "DocEntry,DocNum,DocDate,DocDueDate,ClosingDate,CardCode,CardName,DocTotal,PaidToDate,DocumentStatus,Cancelled";
  const out: SapPurchaseInvoice[] = [];
  let skip = 0;
  for (let page = 0; page < 20; page++) {
    const url = `${baseUrl}/PurchaseInvoices?$filter=${encodeURIComponent(filter)}&$select=${select}&$top=200&$skip=${skip}`;
    const r = await fetch(url, { headers: { Cookie: cookie, Prefer: "odata.maxpagesize=200" } });
    if (!r.ok) break;
    const arr = ((await r.json())?.value || []) as SapPurchaseInvoice[];
    out.push(...arr);
    if (arr.length < 200) break;
    skip += 200;
  }
  return out;
}

export const SapB1Adapter: ErpAdapter = {
  erp_origem: "sap_b1",
  async getContasPagas(ctx: AdapterContext): Promise<ContaPagaERP[]> {
    const sap = await loadSapCreds(ctx.supabase, ctx.company_db);
    if (!sap) return [];
    const cookie = await sapLogin(sap.baseUrl, sap.companyDB, sap.username, sap.password);
    try {
      const [supplierMap, invoices] = await Promise.all([
        fetchSupplierCnpjMap(sap.baseUrl, cookie),
        listPaidPurchaseInvoices(sap.baseUrl, cookie, ctx.periodo_inicio, ctx.periodo_fim),
      ]);
      const out: ContaPagaERP[] = [];
      for (const inv of invoices) {
        const sup = supplierMap.get(inv.CardCode) || { cnpj: "", nome: inv.CardName };
        if (!sup.cnpj) continue;
        out.push({
          erp_origem: "sap_b1",
          empresa_id: ctx.empresa_id,
          company_db: ctx.company_db,
          id_externo: String(inv.DocEntry),
          cnpj_fornecedor: sup.cnpj,
          razao_social_fornecedor: sup.nome || inv.CardName,
          valor_pago: Number(inv.PaidToDate || inv.DocTotal || 0),
          data_baixa: (inv.ClosingDate || inv.DocDueDate || inv.DocDate).slice(0, 10),
          forma_pagamento: null,
          referencia: String(inv.DocNum),
          link_origem: null, // deep-link do B1 Web Client depende da versão — deixar nulo por enquanto
        });
      }
      return out;
    } finally {
      await fetch(`${sap.baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
    }
  },
};
