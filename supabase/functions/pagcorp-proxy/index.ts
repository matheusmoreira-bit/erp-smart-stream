import { corsHeaders } from "@supabase/supabase-js/cors";

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

async function encryptPassword(password: string, ivBase64: string): Promise<string> {
  const aesKeyBytes = base64ToUint8Array(Deno.env.get("PAGCORP_AES_KEY")!);
  const hmacKeyBytes = base64ToUint8Array(Deno.env.get("PAGCORP_HMAC_KEY")!);
  const iv = base64ToUint8Array(ivBase64);

  // AES-256-GCM encrypt
  const aesKey = await crypto.subtle.importKey("raw", aesKeyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, aesKey, encoder.encode(password));

  // encrypted = ciphertext + tag (last 16 bytes)
  const encryptedArr = new Uint8Array(encrypted);
  const ciphertext = encryptedArr.slice(0, encryptedArr.length - 16);
  const tag = encryptedArr.slice(encryptedArr.length - 16);

  // payload = iv + ciphertext + tag
  const payload = new Uint8Array(iv.length + ciphertext.length + tag.length);
  payload.set(iv, 0);
  payload.set(ciphertext, iv.length);
  payload.set(tag, iv.length + ciphertext.length);

  // HMAC-SHA256
  const hmacKey = await crypto.subtle.importKey("raw", hmacKeyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hmacValue = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, payload));

  // final = payload + hmac
  const final = new Uint8Array(payload.length + hmacValue.length);
  final.set(payload, 0);
  final.set(hmacValue, payload.length);

  return uint8ArrayToBase64(final);
}

async function getAuthToken(): Promise<string> {
  const baseUrl = Deno.env.get("PAGCORP_API_BASE_URL")!;
  const clientKey = Deno.env.get("PAGCORP_CLIENT_KEY")!;
  const clientSecret = Deno.env.get("PAGCORP_CLIENT_SECRET")!;
  const loginEmail = Deno.env.get("PAGCORP_LOGIN_EMAIL")!;
  const loginPassword = Deno.env.get("PAGCORP_LOGIN_PASSWORD")!;

  // Step 1: Get access token
  const tokenRes = await fetch(`${baseUrl}Authentication/Client`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey, clientSecret }),
  });
  if (!tokenRes.ok) throw new Error(`Client auth failed [${tokenRes.status}]`);
  const { token: accessToken } = await tokenRes.json();

  // Step 2: Decode JWT to get IV
  const jwt = decodeJwtPayload(accessToken);
  const iv = jwt.iv as string;

  // Step 3: Encrypt password
  const encryptedPassword = await encryptPassword(loginPassword, iv);

  // Step 4: Login
  const loginRes = await fetch(`${baseUrl}Authentication/Login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ login: loginEmail, password: encryptedPassword }),
  });
  if (!loginRes.ok) throw new Error(`Login failed [${loginRes.status}]`);
  const { token: apiToken } = await loginRes.json();
  return apiToken;
}

async function fetchExpenses(apiToken: string, startDate: string, endDate: string): Promise<unknown[]> {
  const baseUrl = Deno.env.get("PAGCORP_API_BASE_URL")!;
  const accountId = Deno.env.get("PAGCORP_ACCOUNT_ID")!;
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
    const url = new URL(req.url);
    const startDate = url.searchParams.get("startDate") || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const endDate = url.searchParams.get("endDate") || new Date().toISOString().slice(0, 10);

    const apiToken = await getAuthToken();
    const expenses = await fetchExpenses(apiToken, startDate, endDate);

    return new Response(JSON.stringify({ items: expenses, startDate, endDate }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("PagCorp proxy error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
