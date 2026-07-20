// Helper compartilhado para consumir views HANA — SEMPRE V2.
//
// V2 (direto no servidor de origem): GET {hanaApiUrl}/data/{SCHEMA}.{VIEW}
// com headers `dynamictoken` e `sessionid` (lowercase).
//
// V1 (middleware n8n) foi descontinuado — todas as bases estão migradas.
// Se `hanaApiUrl` não vier setado, usa o IP primário conhecido do HanaAPI.

import { generateDynamicToken } from "./sap-middleware-token.ts";

const DEFAULT_HANA_API_URL = "http://201.48.79.205:8001";

/**
 * Overrides de schema HANA por companyDB do Service Layer.
 * Mantido aqui para ser reutilizado por todas as edge functions que consultam
 * a HanaAPI V2 (todas as bases estão migradas — V1 descontinuada).
 */
export const HANA_SCHEMA_OVERRIDES: Record<string, string> = {
  open_gaming_sa: "SBO_OPENGAMING",
};

/** Resolve o schema HANA para um companyDB. */
export function resolveHanaSchema(companyDb: string, dbName?: string | null): string {
  return HANA_SCHEMA_OVERRIDES[companyDb] || dbName || companyDb;
}

/**
 * Carrega as credenciais SAP + HanaAPI (V2) de uma empresa em um formato
 * simples de key/value. Retorna null quando a HanaAPI não está habilitada
 * (falta credencial, `use_hana_db=false` ou usuário SAP diferente de Apiuser).
 */
export async function loadHanaCreds(
  sb: { from: (t: string) => any },
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
  if (kv.use_hana_db === "false") return null;
  if ((kv.username || "").trim().toLowerCase() !== "apiuser") return null;
  return kv;
}

export interface FetchHanaViewParams {
  /** Schema HANA onde a view está publicada (ex.: "SBO_OPENGAMING"). */
  schema: string;
  /** Nome da view (ex.: "VW_FORNECEDORES"). */
  view: string;
  /** SessionId obtido no Login do Service Layer. */
  sessionId: string;
  /** URL base do servidor HANA direto (V2). Se omitida, usa o IP primário conhecido. */
  hanaApiUrl?: string | null;
  /** @deprecated V1 foi descontinuada; o helper sempre usa V2. Mantido para compat. */
  useV2?: boolean;
  /** @deprecated V1 (middleware n8n) foi descontinuada. Mantido para compat. */
  middlewareUrl?: string;
  /** Paginação (V2 apenas): limita nº de linhas retornadas. Inteiro >= 1. */
  limit?: number;
  /** Paginação (V2 apenas): pula N linhas. Inteiro >= 0. */
  offset?: number;
  /**
   * Filtros de consulta (V2 apenas). Cada chave deve estar no formato
   * `Campo__op` (ex.: `DocNum__eq`, `CardName__ilike`, `DocDate__gte`).
   * Operadores suportados pelo HanaAPI V2:
   *   eq, like, ilike, contains, startswith, endswith, gt, gte, lt, lte, in.
   * Para `in`, passe uma string com valores separados por vírgula
   * (`"A,B,C"`) ou um array (`["A","B","C"]`) que será serializado.
   */
  filters?: Record<string, string | number | boolean | Array<string | number>>;
}


function parsePayload(text: string): Record<string, unknown>[] {
  if (!text) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return [];
  }
  const groups = Array.isArray(payload) ? payload : [payload];
  const rows: Record<string, unknown>[] = [];
  for (const g of groups) {
    if (g && typeof g === "object" && Array.isArray((g as { data?: unknown }).data)) {
      rows.push(...((g as { data: Record<string, unknown>[] }).data));
    } else if (Array.isArray(g)) {
      rows.push(...(g as Record<string, unknown>[]));
    }
  }
  if (
    rows.length === 0 &&
    !Array.isArray(payload) &&
    payload &&
    typeof payload === "object" &&
    !Array.isArray((payload as { data?: unknown }).data)
  ) {
    // Objeto único no topo — improvável, mas mantemos como no parser antigo.
  }
  return rows;
}

/**
 * Executa a chamada da view HANA sempre via V2 (direto no servidor de origem).
 * Tenta o `hanaApiUrl` da empresa primeiro e faz fallback para o IP secundário.
 */
export async function fetchHanaView(
  params: FetchHanaViewParams,
): Promise<Record<string, unknown>[]> {
  const { schema, view, sessionId } = params;
  const dynamicToken = await generateDynamicToken();

  const primaryBase = (params.hanaApiUrl && params.hanaApiUrl.trim()
    ? params.hanaApiUrl
    : DEFAULT_HANA_API_URL
  ).replace(/\/+$/, "");
  // Fallback secundário: IP alternativo, mesma porta/path.
  const FALLBACK_BASE = "http://189.91.68.202:8001";
  const bases: string[] = [primaryBase];
  try {
    const primaryHost = new URL(primaryBase).host;
    const fallbackHost = new URL(FALLBACK_BASE).host;
    if (primaryHost !== fallbackHost) bases.push(FALLBACK_BASE);
  } catch {
    bases.push(FALLBACK_BASE);
  }

  // Query string opcional: limit/offset + filtros Campo__op=valor.
  const qs = new URLSearchParams();
  if (typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit >= 1) {
    qs.set("limit", String(Math.floor(params.limit)));
  }
  if (typeof params.offset === "number" && Number.isFinite(params.offset) && params.offset >= 0) {
    qs.set("offset", String(Math.floor(params.offset)));
  }
  if (params.filters) {
    for (const [key, value] of Object.entries(params.filters)) {
      if (value === undefined || value === null) continue;
      const v = Array.isArray(value) ? value.join(",") : String(value);
      qs.set(key, v);
    }
  }
  const queryString = qs.toString();

  let resp: Response | undefined;
  let lastErr: unknown = null;
  for (const base of bases) {
    const url = `${base}/data/${encodeURIComponent(schema)}.${encodeURIComponent(view)}${queryString ? `?${queryString}` : ""}`;
    try {
      const r = await fetch(url, {
        headers: {
          dynamictoken: dynamicToken,
          sessionid: sessionId,
        },
      });
      if (r.ok) {
        resp = r;
        break;
      }
      // 5xx → tenta próximo IP; 4xx → propaga sem fallback.
      if (r.status >= 500) {
        lastErr = new Error(`HTTP ${r.status} em ${base}`);
        continue;
      }
      resp = r;
      break;
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  if (!resp) {
    throw new Error(
      `HANA view ${view} falhou (v2, todos os IPs): ${String((lastErr as Error)?.message || lastErr)}`,
    );
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HANA view ${view} falhou (v2): ${resp.status} ${text}`);
  }
  const text = await resp.text();
  return parsePayload(text);
}

export { generateDynamicToken };
