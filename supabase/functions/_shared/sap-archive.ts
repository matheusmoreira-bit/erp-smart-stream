// Helpers compartilhados da base de backup de documentos do SAP.
//
// A base de backup guarda o documento inteiro (JSON do Service Layer) em
// `public.sap_archive_documents`, e os arquivos de anexo no bucket privado
// `sap-archive`, de forma que os dados possam ser devolvidos ao SAP depois de
// um wipe da base.

import { sapFetch } from "./sap-fetch.ts";

export interface ArchiveDocSpec {
  /** chave usada nas tabelas e na tela */
  key: string;
  /** rótulo em português */
  label: string;
  /** endpoint do Service Layer */
  endpoint: string;
  /** ordem de dependência na restauração (menor primeiro) */
  restoreOrder: number;
  /** campos removidos antes de reenviar ao SAP na restauração */
  stripOnRestore?: string[];
}

export const ARCHIVE_DOC_SPECS: ArchiveDocSpec[] = [
  { key: "purchase_orders", label: "Pedidos de compra", endpoint: "PurchaseOrders", restoreOrder: 10 },
  { key: "purchase_down_payments", label: "Adiantamentos a fornecedor", endpoint: "PurchaseDownPayments", restoreOrder: 20 },
  { key: "down_payments", label: "Adiantamentos de cliente", endpoint: "DownPayments", restoreOrder: 21 },
  { key: "purchase_invoices", label: "NF de entrada", endpoint: "PurchaseInvoices", restoreOrder: 30 },
  { key: "vendor_payments", label: "Contas a pagar (pagamentos)", endpoint: "VendorPayments", restoreOrder: 40 },
  { key: "sales_orders", label: "Pedidos de venda", endpoint: "Orders", restoreOrder: 50 },
  { key: "sales_invoices", label: "NF de saída", endpoint: "Invoices", restoreOrder: 60 },
  { key: "incoming_payments", label: "Contas a receber (recebimentos)", endpoint: "IncomingPayments", restoreOrder: 70 },
];

export function specByKey(key: string): ArchiveDocSpec | undefined {
  return ARCHIVE_DOC_SPECS.find((s) => s.key === key);
}

export const ARCHIVE_BUCKET = "sap-archive";

// ---------------------------------------------------------------------------
// Sessão SAP (mesmas credenciais Apiuser usadas pelo sap-list-service)
// ---------------------------------------------------------------------------

export interface SapSession {
  baseUrl: string;
  cookies: string;
  sessionId: string;
}

export function buildBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (!/\/b1s\/v\d+/.test(url)) url = `${url}/b1s/v1`;
  return url;
}

export async function loadApiuserCreds(
  sb: any,
  companyDb: string,
): Promise<Record<string, string> | null> {
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
  if (!kv.service_layer_url || !kv.username || !kv.password) return null;
  return kv;
}

export async function sapLogin(sb: any, companyDb: string): Promise<SapSession> {
  const creds = await loadApiuserCreds(sb, companyDb);
  if (!creds) throw new Error(`Credenciais SAP (Apiuser) não configuradas para ${companyDb}.`);
  const baseUrl = buildBaseUrl(creds.service_layer_url);
  const r = await sapFetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // O nome da base no SAP pode diferir da chave usada no Flow (credencial `company_db`).
    body: JSON.stringify({
      UserName: creds.username,
      Password: creds.password,
      CompanyDB: creds.company_db || companyDb,
    }),
    timeoutMs: 25_000,
  });
  if (!r.ok) {
    throw new Error(`Login SAP falhou (${r.status}): ${await r.text().catch(() => "")}`);
  }
  const json = await r.json();
  const setCookie = r.headers.get("set-cookie") || "";
  const routeId = setCookie.match(/B1ROUTEID=([^;]+)/)?.[1] ?? "";
  const sessionId = String(json.SessionId || "");
  return {
    baseUrl,
    sessionId,
    cookies: `B1SESSION=${sessionId}${routeId ? `; B1ROUTEID=${routeId}` : ""}`,
  };
}

export async function sapLogout(s: SapSession): Promise<void> {
  try {
    await sapFetch(`${s.baseUrl}/Logout`, {
      method: "POST",
      headers: { Cookie: s.cookies },
      timeoutMs: 10_000,
      maxAttempts: 1,
    });
  } catch { /* ignore */ }
}

export function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function sapGet(s: SapSession, path: string, maxPageSize?: number): Promise<any> {
  const headers: Record<string, string> = { Cookie: s.cookies, "Content-Type": "application/json" };
  if (maxPageSize) headers["Prefer"] = `odata.maxpagesize=${maxPageSize}`;
  const res = await sapFetch(`${s.baseUrl}/${path}`, { method: "GET", headers, timeoutMs: 45_000 });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`SAP GET ${path} falhou (${res.status}): ${txt.slice(0, 400)}`);
  }
  return await res.json();
}

/** Campos que o Service Layer não aceita de volta num POST de criação. */
const READONLY_FIELDS = new Set([
  "DocEntry", "DocNum", "DocumentStatus", "Cancelled", "CreationDate", "UpdateDate", "UpdateTime",
  "CreateTime", "Printed", "DocTime", "Period", "PeriodIndicator", "AttachmentEntry",
  "DocumentAdditionalExpenses", "DocumentSpecialLines", "DocumentInstallments",
]);

/** Remove campos de controle antes de recriar o documento no SAP. */
export function sanitizeForRestore(payload: Record<string, any>, extraStrip: string[] = []): Record<string, any> {
  const out: Record<string, any> = {};
  const strip = new Set([...READONLY_FIELDS, ...extraStrip]);
  for (const [k, v] of Object.entries(payload)) {
    if (k.startsWith("odata.")) continue;
    if (k.startsWith("@odata")) continue;
    if (strip.has(k)) continue;
    if (v === null) continue;
    out[k] = v;
  }
  if (Array.isArray(out.DocumentLines)) {
    out.DocumentLines = out.DocumentLines.map((line: Record<string, any>) => {
      const l: Record<string, any> = {};
      for (const [k, v] of Object.entries(line)) {
        if (k.startsWith("@odata") || v === null) continue;
        if (["DocEntry", "LineStatus", "RemainingOpenQuantity", "RemainingOpenInventoryQuantity"].includes(k)) continue;
        l[k] = v;
      }
      return l;
    });
  }
  return out;
}

/** POST no Service Layer (usado na restauração). */
export async function sapPost(s: SapSession, path: string, body: unknown): Promise<any> {
  const res = await sapFetch(`${s.baseUrl}/${path}`, {
    method: "POST",
    headers: { Cookie: s.cookies, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 60_000,
    maxAttempts: 1,
  });
  const txt = await res.text().catch(() => "");
  if (!res.ok) {
    let msg = txt.slice(0, 500);
    try { msg = JSON.parse(txt)?.error?.message?.value || msg; } catch { /* texto cru */ }
    throw new Error(`SAP POST ${path} falhou (${res.status}): ${msg}`);
  }
  try { return JSON.parse(txt); } catch { return {}; }
}

/** Baixa o conteúdo binário de uma linha de anexo do SAP. */
export async function sapFetchFile(
  s: SapSession,
  attachmentEntry: number,
  fileName: string,
): Promise<Uint8Array> {
  const url = `${s.baseUrl}/Attachments2(${attachmentEntry})/$value?filename='${encodeURIComponent(fileName)}'`;
  const res = await sapFetch(url, {
    method: "GET",
    headers: { Cookie: s.cookies },
    timeoutMs: 60_000,
    maxAttempts: 2,
  });
  if (!res.ok) {
    throw new Error(`Download do anexo falhou (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
