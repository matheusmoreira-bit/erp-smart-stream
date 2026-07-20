// Helper compartilhado para consumir views HANA.
//
// Suporta duas variantes:
//   - V1 (default, via middleware n8n): usa HANA_VIEWS_URL + query string + headers X-*.
//   - V2 (direto no servidor de origem): GET {hanaApiUrl}/data/{SCHEMA}.{VIEW}
//     com headers `dynamictoken` e `sessionid` (lowercase). Sem query string.
//
// A escolha é por empresa: quando `hanaApiUrl` é passado (lido de
// system_credentials.hana_api_url), usa V2. Caso contrário, mantém V1.

import { generateDynamicToken } from "./sap-middleware-token.ts";

const DEFAULT_HANA_VIEWS_URL =
  Deno.env.get("HANA_VIEWS_URL") ||
  "https://anagaming.app.n8n.cloud/webhook/d7c643d9-040c-4e60-aa26-99344e60e89b";

export interface FetchHanaViewParams {
  /** Schema HANA onde a view está publicada (ex.: "SBO_OPENGAMING"). */
  schema: string;
  /** Nome da view (ex.: "VW_FORNECEDORES"). */
  view: string;
  /** SessionId obtido no Login do Service Layer. */
  sessionId: string;
  /** URL base do servidor HANA direto (V2). Obrigatória quando useV2=true. */
  hanaApiUrl?: string | null;
  /** Força usar V2 (direto). Só entra em V2 quando useV2 === true E hanaApiUrl estiver setada. */
  useV2?: boolean;
  /** Middleware URL (V1). Default = env HANA_VIEWS_URL. */
  middlewareUrl?: string;
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
 * Executa a chamada da view HANA usando V2 (direto) quando `hanaApiUrl` for
 * fornecido, ou V1 (middleware n8n) caso contrário. Retorna as linhas cruas.
 */
export async function fetchHanaView(
  params: FetchHanaViewParams,
): Promise<Record<string, unknown>[]> {
  const { schema, view, sessionId } = params;
  const dynamicToken = await generateDynamicToken();
  const useV2 = !!(params.useV2 && params.hanaApiUrl && params.hanaApiUrl.trim());

  let resp: Response;
  if (useV2) {
    const base = params.hanaApiUrl!.replace(/\/+$/, "");
    const url = `${base}/data/${encodeURIComponent(schema)}.${encodeURIComponent(view)}`;
    resp = await fetch(url, {
      headers: {
        dynamictoken: dynamicToken,
        sessionid: sessionId,
      },
    });
  } else {
    const middleware = params.middlewareUrl || DEFAULT_HANA_VIEWS_URL;
    const qs = new URLSearchParams({
      SessionId: sessionId,
      DB: schema,
      Schema: schema,
      View: view,
      DynamicToken: dynamicToken,
      _t: String(Date.now()),
    });
    resp = await fetch(`${middleware}?${qs.toString()}`, {
      headers: {
        "X-SessionId": sessionId,
        "X-DB": schema,
        "X-Schema": schema,
        "X-View": view,
        "X-Dynamic-Token": dynamicToken,
      },
    });
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `HANA view ${view} falhou (${useV2 ? "v2" : "v1"}): ${resp.status} ${text}`,
    );
  }
  const text = await resp.text();
  return parsePayload(text);
}

export { generateDynamicToken };
