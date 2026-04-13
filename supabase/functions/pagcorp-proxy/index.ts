import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function requireAuth(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new Error("UNAUTHORIZED");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("UNAUTHORIZED");
  return user;
}

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

  let query = supabase
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "pagcorp");

  if (companyDb) {
    query = query.eq("company_db", companyDb);
  }

  const { data, error } = await query;

  if (error) throw new Error(`Failed to load credentials: ${error.message}`);
  if (!data || data.length === 0) throw new Error(companyDb ? `Credenciais PagCorp não configuradas para a empresa ${companyDb}.` : "PagCorp credentials not configured.");

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
  if (!tokenRes.ok) throw new Error(`Client auth failed [${tokenRes.status}]`);
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
  if (!loginRes.ok) throw new Error(`Login failed [${loginRes.status}]`);
  const { token: apiToken } = await loginRes.json();
  return apiToken;
}

async function fetchExpenses(apiToken: string, baseUrl: string, accountId: string, startDate: string, endDate: string): Promise<unknown[]> {
  const allItems: unknown[] = [];
  let page = 1;

  while (true) {
    const url = `${baseUrl}Expense/Account/${accountId}?startDate=${startDate}&endDate=${endDate}&page=${page}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) throw new Error(`Fetch expenses failed [${res.status}]`);
    const data = await res.json();
    const items = data.items || [];
    if (items.length === 0) break;
    allItems.push(...items);
    if (data.currentPage >= data.totalPages) break;
    page++;
  }

  return allItems;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Authentication is handled by PagCorp's own API (client key + login).
    // Supabase JWT auth is not required here.

    const url = new URL(req.url);
    const startDate = url.searchParams.get("startDate") || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const endDate = url.searchParams.get("endDate") || new Date().toISOString().slice(0, 10);
    const companyDb = url.searchParams.get("companyDb") || undefined;

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return new Response(JSON.stringify({ error: "Formato de data inválido. Use YYYY-MM-DD." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const creds = await getCredentials(companyDb);
    const apiToken = await getAuthToken(creds);
    const expenses = await fetchExpenses(apiToken, creds.api_base_url, creds.account_id, startDate, endDate);

    return new Response(JSON.stringify({ items: expenses, startDate, endDate }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("PagCorp proxy error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
