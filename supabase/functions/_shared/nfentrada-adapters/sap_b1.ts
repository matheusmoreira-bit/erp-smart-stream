// Implementação SAP B1 (Service Layer) do contrato de NF de Entrada.
// Nenhuma regra de negócio do módulo vive aqui — só a tradução para o ERP.

import { sapFetch } from "../sap-fetch.ts";
import type {
  AdapterContext,
  BuscarPedidoCriterio,
  CriarPedidoPayload,
  ErpWriteResult,
  NFEntradaERP,
  NfEntradaErpAdapter,
  PedidoCompraERP,
  ProvisionarEsbocoPayload,
} from "./types.ts";

function buildBaseUrl(raw: string): string {
  let url = (raw || "").replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

interface Session {
  baseUrl: string;
  cookie: string;
}

const sessions = new Map<string, Session>();

async function getSession(ctx: AdapterContext): Promise<Session> {
  const cached = sessions.get(ctx.company_db);
  if (cached) return cached;

  const { data, error } = await ctx.supabase
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", ctx.company_db);
  if (error) throw new Error(`Credenciais SAP erro: ${error.message}`);

  const kv: Record<string, string> = {};
  for (const r of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
    kv[r.credential_key] = r.credential_value ?? "";
  }
  if (!kv.service_layer_url || !kv.username || !kv.password) {
    throw new Error(`Credenciais SAP ausentes para ${ctx.company_db}`);
  }

  const baseUrl = buildBaseUrl(kv.service_layer_url);
  const r = await sapFetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      UserName: kv.username,
      Password: kv.password,
      CompanyDB: kv.company_db || ctx.company_db,
    }),
    timeoutMs: 20_000,
  });
  if (!r.ok) throw new Error(`Login SAP falhou ${r.status}`);
  await r.json().catch(() => null);
  const sc = r.headers.get("set-cookie") || "";
  const s = sc.match(/B1SESSION=([^;]+)/)?.[1];
  const rt = sc.match(/ROUTEID=([^;]+)/)?.[1];
  if (!s) throw new Error("B1SESSION ausente");

  const session = { baseUrl, cookie: `B1SESSION=${s}${rt ? `; ROUTEID=${rt}` : ""}` };
  sessions.set(ctx.company_db, session);
  return session;
}

async function sapGet(ctx: AdapterContext, path: string): Promise<any> {
  const { baseUrl, cookie } = await getSession(ctx);
  const res = await sapFetch(`${baseUrl}${path}`, { headers: { Cookie: cookie }, timeoutMs: 25_000 });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SAP GET ${path} falhou ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function sapPost(ctx: AdapterContext, path: string, body: unknown): Promise<any> {
  const { baseUrl, cookie } = await getSession(ctx);
  const res = await sapFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // Escrita nunca é reexecutada automaticamente: a idempotência vive na fila.
    maxAttempts: 1,
    timeoutMs: 45_000,
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let msg = raw.slice(0, 400);
    try {
      const j = JSON.parse(raw);
      msg = j?.error?.message?.value || j?.error?.message || msg;
    } catch { /* mantém texto bruto */ }
    throw new Error(`SAP ${res.status}: ${msg}`);
  }
  return res.json();
}

function mapPedido(po: any): PedidoCompraERP {
  return {
    id: String(po.DocEntry),
    numero: po.DocNum != null ? String(po.DocNum) : null,
    is_draft: false,
    fornecedor_id: po.CardCode ?? null,
    fornecedor_nome: po.CardName ?? null,
    fornecedor_cnpj: po.FederalTaxID ?? null,
    valor_total: po.DocTotal != null ? Number(po.DocTotal) : null,
    status: po.DocumentStatus ?? null,
    linhas: (Array.isArray(po.DocumentLines) ? po.DocumentLines : []).map((l: any) => ({
      line_num: Number(l.LineNum ?? 0),
      item_code: l.ItemCode ?? null,
      descricao: l.ItemDescription ?? null,
      centro_custo: l.CostingCode ?? null,
      projeto: l.ProjectCode ?? l.Project ?? null,
      quantidade: l.Quantity != null ? Number(l.Quantity) : null,
      valor_unitario: l.UnitPrice != null ? Number(l.UnitPrice) : null,
      valor_total: l.LineTotal != null ? Number(l.LineTotal) : null,
    })),
  };
}

const SELECT_PO =
  "$select=DocEntry,DocNum,CardCode,CardName,DocTotal,DocumentStatus,DocDate,DocumentLines";

export const SapB1NfEntradaAdapter: NfEntradaErpAdapter = {
  erp_type: "sap_b1",

  async buscarPedidoCompra(ctx, criterio: BuscarPedidoCriterio): Promise<PedidoCompraERP[]> {
    if (criterio.pedido_id) {
      const po = await sapGet(ctx, `/PurchaseOrders(${Number(criterio.pedido_id)})?${SELECT_PO}`);
      return po ? [mapPedido(po)] : [];
    }

    const filters: string[] = ["DocumentStatus eq 'bost_Open'"];
    if (criterio.fornecedor_id) filters.push(`CardCode eq '${criterio.fornecedor_id.replace(/'/g, "''")}'`);
    if (criterio.data_referencia) {
      const ref = new Date(`${criterio.data_referencia}T00:00:00Z`);
      const from = new Date(ref); from.setUTCDate(from.getUTCDate() - 90);
      const to = new Date(ref); to.setUTCDate(to.getUTCDate() + 30);
      filters.push(`DocDate ge '${from.toISOString().slice(0, 10)}'`);
      filters.push(`DocDate le '${to.toISOString().slice(0, 10)}'`);
    }
    const res = await sapGet(
      ctx,
      `/PurchaseOrders?${SELECT_PO}&$filter=${encodeURIComponent(filters.join(" and "))}&$orderby=DocEntry desc&$top=50`,
    );
    return (res?.value || []).map(mapPedido);
  },

  async nfEntradaJaLancada(ctx, pedidoId): Promise<NFEntradaERP | null> {
    const entry = Number(pedidoId);
    if (!Number.isFinite(entry)) return null;

    const build = (docEntry: number, docNum: unknown, total: unknown): NFEntradaERP => ({
      id: String(docEntry),
      numero: docNum != null ? String(docNum) : null,
      tipo: "lancada",
      pedido_id: String(entry),
      valor_total: total != null ? Number(total) : null,
    });

    // 1) Cache local (alimentado pelo sync incremental) — barato e sem filtro OData complexo.
    try {
      const { data } = await ctx.supabase
        .from("sap_nf_entrada_cache")
        .select("doc_entry, doc_num, doc_total, cancelled")
        .eq("company_db", ctx.company_db)
        .eq("base_po_doc_entry", entry)
        .limit(5);
      const hit = (data || []).find((d: any) => d.cancelled !== "tYES" && d.cancelled !== "Y");
      if (hit) return build(Number(hit.doc_entry), hit.doc_num, hit.doc_total);
    } catch { /* cache indisponível: cai para o ERP */ }

    // 2) Fallback no ERP: o Service Layer não aceita lambda `any()` sobre DocumentLines,
    // então lemos as NFs recentes do fornecedor do PC e conferimos as linhas localmente.
    let cardCode: string | null = null;
    try {
      const po = await sapGet(ctx, `/PurchaseOrders(${entry})?$select=CardCode`);
      cardCode = po?.CardCode ?? null;
    } catch { /* segue sem filtro de fornecedor */ }

    const filter = cardCode ? `&$filter=${encodeURIComponent(`CardCode eq '${cardCode.replace(/'/g, "''")}'`)}` : "";
    const res = await sapGet(
      ctx,
      `/PurchaseInvoices?$select=DocEntry,DocNum,DocTotal,Cancelled,DocumentLines${filter}&$orderby=DocEntry desc&$top=100`,
    );
    for (const inv of res?.value || []) {
      if (inv.Cancelled === "tYES") continue;
      const linked = (Array.isArray(inv.DocumentLines) ? inv.DocumentLines : []).some(
        (l: any) => Number(l?.BaseType) === 22 && Number(l?.BaseEntry) === entry,
      );
      if (linked) return build(Number(inv.DocEntry), inv.DocNum, inv.DocTotal);
    }
    return null;
  },


  async provisionarEsbocoNFEntrada(ctx, payload: ProvisionarEsbocoPayload): Promise<ErpWriteResult> {
    const entry = Number(payload.pedido_id);
    if (!Number.isFinite(entry)) throw new Error("Pedido de compra inválido para o SAP B1");

    const lines = payload.linhas.map((l) => {
      const line: Record<string, unknown> = { BaseType: 22, BaseEntry: entry, BaseLine: l.line_num };
      if (l.quantidade != null) line.Quantity = l.quantidade;
      return line;
    });

    const doc: Record<string, unknown> = {
      DocObjectCode: "oPurchaseInvoices",
      CardCode: payload.fornecedor_id,
      Comments: (payload.comentario || `NF Entrada chave ${payload.chave_nf} (PC #${entry})`).slice(0, 254),
      DocumentLines: lines.length ? lines : [{ BaseType: 22, BaseEntry: entry, BaseLine: 0 }],
    };
    if (payload.data_documento) doc.DocDate = payload.data_documento;

    const created = await sapPost(ctx, "/Drafts", doc);
    return {
      document_id: String(created.DocEntry),
      document_type: "oPurchaseInvoices:draft",
      numero: created.DocNum != null ? String(created.DocNum) : null,
    };
  },

  async criarPedidoCompra(ctx, payload: CriarPedidoPayload): Promise<ErpWriteResult> {
    const doc: Record<string, unknown> = {
      CardCode: payload.fornecedor_id,
      Comments: (payload.comentario || "").slice(0, 254),
      DocumentLines: payload.linhas.map((l) => {
        const line: Record<string, unknown> = {
          Quantity: l.quantidade,
          UnitPrice: l.valor_unitario,
        };
        if (l.item_code) line.ItemCode = l.item_code;
        else line.ItemDescription = (l.descricao || "Item da NF capturada").slice(0, 100);
        if (l.centro_custo) line.CostingCode = l.centro_custo;
        if (l.projeto) line.ProjectCode = l.projeto;
        return line;
      }),
    };
    if (payload.data_documento) {
      doc.DocDate = payload.data_documento;
      doc.DocDueDate = payload.data_documento;
    }

    const created = await sapPost(ctx, "/PurchaseOrders", doc);
    return {
      document_id: String(created.DocEntry),
      document_type: "oPurchaseOrders",
      numero: created.DocNum != null ? String(created.DocNum) : null,
    };
  },
};
