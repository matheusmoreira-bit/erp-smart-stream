import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireUserOrSapSession, authErrorResponse } from "../_shared/auth.ts";
import { logIntegrationCall } from "../_shared/integration-log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db",
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();


function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(arr: Uint8Array): string {
  let binary = "";
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const base64Url = token.split(".")[1];
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const json = decoder.decode(base64ToUint8Array(base64));
  return JSON.parse(json);
}

async function encryptPassword(password: string, ivBase64: string, aesKeyBase64: string, hmacKeyBase64: string): Promise<string> {
  const aesKeyBytes = base64ToUint8Array(aesKeyBase64);
  const hmacKeyBytes = base64ToUint8Array(hmacKeyBase64);
  const iv = base64ToUint8Array(ivBase64);

  const aesKey = await crypto.subtle.importKey("raw", aesKeyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, aesKey, encoder.encode(password));

  const encryptedArr = new Uint8Array(encrypted);
  const ciphertext = encryptedArr.slice(0, encryptedArr.length - 16);
  const tag = encryptedArr.slice(encryptedArr.length - 16);

  const payload = new Uint8Array(iv.length + ciphertext.length + tag.length);
  payload.set(iv, 0);
  payload.set(ciphertext, iv.length);
  payload.set(tag, iv.length + ciphertext.length);

  const hmacKey = await crypto.subtle.importKey("raw", hmacKeyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hmacValue = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, payload));

  const final = new Uint8Array(payload.length + hmacValue.length);
  final.set(payload, 0);
  final.set(hmacValue, payload.length);

  return uint8ArrayToBase64(final);
}

interface PagCorpCreds {
  api_base_url: string;
  client_key: string;
  client_secret: string;
  login_email: string;
  login_password: string;
  aes_key: string;
  hmac_key: string;
  account_id: string;
}

async function getCredentials(companyDb?: string): Promise<PagCorpCreds> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let data: { credential_key: string; credential_value: string }[] | null = null;

  if (companyDb) {
    // Strict: only use credentials for this specific company.
    const res = await supabase
      .from("system_credentials")
      .select("credential_key, credential_value")
      .eq("system_name", "pagcorp")
      .eq("company_db", companyDb);
    if (res.error) throw new Error(`Failed to load credentials: ${res.error.message}`);
    data = res.data;
  } else {
    // No company specified: use global credentials (company_db is null).
    const res = await supabase
      .from("system_credentials")
      .select("credential_key, credential_value")
      .eq("system_name", "pagcorp")
      .is("company_db", null);
    if (res.error) throw new Error(`Failed to load credentials: ${res.error.message}`);
    data = res.data;
  }

  if (!data || data.length === 0) {
    throw new Error(
      companyDb
        ? `PagCorp não configurado para esta empresa (${companyDb}). Configure as credenciais em Credenciais > PagCorp.`
        : "PagCorp credentials not configured.",
    );
  }

  const creds: Record<string, string> = {};
  for (const row of data) {
    creds[row.credential_key] = row.credential_value;
  }

  const required = ["api_base_url", "client_key", "client_secret", "login_email", "login_password", "aes_key", "hmac_key", "account_id"];
  for (const key of required) {
    if (!creds[key]) throw new Error(`Missing PagCorp credential: ${key}`);
  }

  return creds as unknown as PagCorpCreds;
}

async function getAuthToken(creds: PagCorpCreds): Promise<string> {
  const tokenRes = await fetch(`${creds.api_base_url}Authentication/Client`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: creds.client_key, clientSecret: creds.client_secret }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => "");
    throw new Error(`Client auth failed [${tokenRes.status}]: ${body.slice(0, 300)}`);
  }
  const { token: accessToken } = await tokenRes.json();

  const jwt = decodeJwtPayload(accessToken);
  const iv = jwt.iv as string;

  const encryptedPassword = await encryptPassword(creds.login_password, iv, creds.aes_key, creds.hmac_key);

  const loginRes = await fetch(`${creds.api_base_url}Authentication/Login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ login: creds.login_email, password: encryptedPassword }),
  });
  if (!loginRes.ok) {
    const body = await loginRes.text().catch(() => "");
    throw new Error(`Login failed [${loginRes.status}]: ${body.slice(0, 300)}`);
  }
  const { token: apiToken } = await loginRes.json();
  return apiToken;
}

function splitDateRange(startDate: string, endDate: string): { start: string; end: string }[] {
  const chunks: { start: string; end: string }[] = [];
  let current = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");

  while (current <= end) {
    // chunk end = current + 30 days or endDate, whichever is earlier
    const chunkEnd = new Date(current);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 27);
    const actualEnd = chunkEnd > end ? end : chunkEnd;
    chunks.push({
      start: current.toISOString().slice(0, 10),
      end: actualEnd.toISOString().slice(0, 10),
    });
    // next chunk starts day after
    current = new Date(actualEnd);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return chunks;
}

async function fetchExpenses(apiToken: string, baseUrl: string, accountId: string, startDate: string, endDate: string): Promise<unknown[]> {
  const chunks = splitDateRange(startDate, endDate);
  const allItems: unknown[] = [];

  for (const chunk of chunks) {
    let page = 1;
    while (true) {
      const url = `${baseUrl}Expense/Account/${accountId}?startDate=${chunk.start}&endDate=${chunk.end}&page=${page}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!res.ok) {
        const errBody = await res.text();
        console.error(`Fetch expenses failed [${res.status}] URL: ${url} Body: ${errBody}`);
        throw new Error(`Fetch expenses failed [${res.status}]: ${errBody}`);
      }
      const data = await res.json();
      const items = data.items || [];
      if (items.length === 0) break;
      if (page === 1 && allItems.length === 0 && items[0]) {
        console.log("[pagcorp] sample item keys:", Object.keys(items[0]));
        console.log("[pagcorp] sample item:", JSON.stringify(items[0]).slice(0, 2000));
      }
      allItems.push(...items);
      if (data.currentPage >= data.totalPages) break;
      page++;
    }
  }

  return allItems;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const _startedAt = Date.now();
  let _action = "default";
  let _company_db: string | null = null;
  let _http = 200;
  let _err: string | null = null;
  try {
    await requireUserOrSapSession(req);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const companyDb = url.searchParams.get("companyDb") || undefined;
    _action = action || "default";
    _company_db = companyDb ?? null;

    // ── Receipt file proxy: ?action=receipt&receiptId=X&companyDb=Y ──
    if (action === "receipt") {
      const receiptId = url.searchParams.get("receiptId");
      const directUrl = url.searchParams.get("url");
      if (!receiptId && !directUrl) {
        return new Response(JSON.stringify({ error: "receiptId ou url obrigatório" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const creds = await getCredentials(companyDb);
      const apiToken = await getAuthToken(creds);

      const candidates: string[] = [];
      if (directUrl) {
        candidates.push(directUrl);
      } else if (receiptId) {
        const base = creds.api_base_url;
        candidates.push(
          `${base}Receipt/${receiptId}/File`,
          `${base}Receipt/${receiptId}`,
          `${base}Receipt/Image/${receiptId}`,
          `${base}Receipt/Download/${receiptId}`,
          `${base}Expense/Account/${creds.account_id}/Receipt/${receiptId}`,
          `${base}Expense/Account/${creds.account_id}/Receipt/${receiptId}/File`,
        );
      }

      let fileRes: Response | null = null;
      let lastStatus = 0;
      let lastBody = "";
      for (const u of candidates) {
        const r = await fetch(u, { headers: { Authorization: `Bearer ${apiToken}` } });
        if (r.ok) { fileRes = r; break; }
        lastStatus = r.status;
        lastBody = await r.text().catch(() => "");
        console.warn(`[pagcorp receipt] ${r.status} ${u} ${lastBody.slice(0, 120)}`);
      }
      if (!fileRes) {
        const isPermissionDenied = lastStatus === 401 || lastStatus === 403;
        return new Response(JSON.stringify({
          success: false,
          error: isPermissionDenied
            ? "RECEIPT_ACCESS_DENIED"
            : "RECEIPT_DOWNLOAD_FAILED",
          message: isPermissionDenied
            ? "O PagCorp não autorizou o download deste recibo. A transação continua disponível para integração, mas o anexo não pode ser aberto por esta credencial."
            : `Falha ao baixar recibo [${lastStatus || "sem status"}]: ${lastBody.slice(0, 200)}`,
          status: lastStatus || 502,
          fallback: false,
        }), {
          // Keep 200 so the browser/Supabase client does not treat PagCorp's
          // external 403 as an application crash/runtime error.
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const contentType = fileRes.headers.get("content-type") || "application/octet-stream";
      // Some PagCorp endpoints return JSON { url: "https://..." } — follow it.
      if (contentType.includes("application/json")) {
        const j = await fileRes.json().catch(() => null) as any;
        const follow = j?.url || j?.fileUrl || j?.downloadUrl || j?.link;
        if (follow) {
          const r2 = await fetch(follow, { headers: { Authorization: `Bearer ${apiToken}` } });
          if (r2.ok) {
            const ct2 = r2.headers.get("content-type") || "application/octet-stream";
            const buf2 = await r2.arrayBuffer();
            return new Response(buf2, {
              headers: { ...corsHeaders, "Content-Type": ct2, "Content-Disposition": "inline" },
            });
          }
        }
      }
      const buf = await fileRes.arrayBuffer();
      return new Response(buf, {
        headers: { ...corsHeaders, "Content-Type": contentType, "Content-Disposition": "inline" },
      });
    }

    const startDate = url.searchParams.get("startDate") || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const endDate = url.searchParams.get("endDate") || new Date().toISOString().slice(0, 10);

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return new Response(JSON.stringify({ error: "Formato de data inválido. Use YYYY-MM-DD." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let creds: PagCorpCreds;
    try {
      creds = await getCredentials(companyDb);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("não configurado") || msg.includes("not configured")) {
        // Empresa sem PagCorp configurado: não é erro de servidor — retornar vazio.
        return new Response(
          JSON.stringify({ items: [], startDate, endDate, notConfigured: true, message: msg }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw e;
    }
    const apiToken = await getAuthToken(creds);
    const expenses = await fetchExpenses(apiToken, creds.api_base_url, creds.account_id, startDate, endDate);

    return new Response(JSON.stringify({ items: expenses, startDate, endDate }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const authResp = authErrorResponse(error, corsHeaders);
    if (authResp) {
      _http = authResp.status;
      _err = error instanceof Error ? error.message : "auth error";
      return authResp;
    }

    console.error("PagCorp proxy error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    _http = 500;
    _err = message;
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    void logIntegrationCall({
      system_name: "pagcorp",
      action: _action,
      company_db: _company_db,
      status: _http >= 400 ? "error" : "ok",
      http_status: _http,
      error_message: _err,
      duration_ms: Date.now() - _startedAt,
    });
  }
});
