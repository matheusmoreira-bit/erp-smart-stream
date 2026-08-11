// Leitura SAP B1 (somente GET) para o motor de auditoria de pagamentos.
// Nenhuma escrita no SAP é feita aqui — apenas Login (sessão) e GETs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sapFetch } from "../sap-fetch.ts";

export function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export interface SapCreds {
  baseUrl: string;
  username: string;
  password: string;
  sapCompanyDb: string;
}

export async function getSapCreds(companyDB: string): Promise<SapCreds> {
  const { data } = await admin()
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("company_db", companyDB)
    .eq("system_name", "sap");
  const map = new Map((data ?? []).map((r: any) => [r.credential_key, r.credential_value as string]));
  const url = map.get("service_layer_url");
  const username = map.get("username");
  const password = map.get("password");
  const sapCompanyDb = map.get("company_db") || companyDB;
  if (!url || !username || !password) {
    throw new Error(`Credenciais SAP ausentes para ${companyDB}`);
  }
  let baseUrl = String(url).replace(/\/+$/, "");
  if (baseUrl.includes("/b1s/v1")) baseUrl = baseUrl.replace("/b1s/v1", "/b1s/v2");
  else if (!baseUrl.includes("/b1s/v2")) baseUrl = `${baseUrl}/b1s/v2`;
  return { baseUrl, username, password, sapCompanyDb };
}

export async function sapLogin(creds: SapCreds): Promise<string> {
  const resp = await sapFetch(`${creds.baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      UserName: creds.username,
      Password: creds.password,
      CompanyDB: creds.sapCompanyDb,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`SAP Login falhou: ${resp.status} ${txt.slice(0, 200)}`);
  }
  const setCookie = resp.headers.get("set-cookie") ?? "";
  const sessionId = setCookie.match(/B1SESSION=([^;]+)/)?.[1];
  const routeId = setCookie.match(/ROUTEID=([^;]+)/)?.[1];
  await resp.body?.cancel().catch(() => {});
  if (!sessionId) throw new Error("SAP Login: B1SESSION ausente");
  return `B1SESSION=${sessionId}${routeId ? `; ROUTEID=${routeId}` : ""}`;
}

/** GET puro no Service Layer. Qualquer método diferente de GET é rejeitado. */
export async function sapGet<T = any>(baseUrl: string, cookie: string, path: string): Promise<T | null> {
  const url = `${baseUrl}/${path.replace(/^\/+/, "")}`;
  const resp = await sapFetch(url, { method: "GET", headers: { Cookie: cookie } });
  if (resp.status === 404) {
    await resp.body?.cancel().catch(() => {});
    return null;
  }
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`SAP GET ${path} -> ${resp.status}: ${txt.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

export async function sapList<T = any>(baseUrl: string, cookie: string, path: string): Promise<T[]> {
  const body = await sapGet<{ value?: T[] }>(baseUrl, cookie, path);
  return body?.value ?? [];
}
