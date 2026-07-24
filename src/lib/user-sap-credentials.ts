import { authFetch } from "@/lib/auth-fetch";

export interface UserSapCredential {
  company_db: string;
  sap_user: string;
  updated_at: string;
}

export function defaultSapUserFromEmail(email: string | null | undefined): string {
  if (!email) return "";
  const local = email.split("@")[0] || "";
  return local.toLowerCase().slice(0, 20);
}

export async function listUserSapCredentials(companyDb?: string): Promise<UserSapCredential[]> {
  const qs = companyDb ? `?company_db=${encodeURIComponent(companyDb)}` : "";
  const res = await authFetch(`sap-user-credentials${qs}`);
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.credentials) ? data.credentials : [];
}

export async function saveUserSapCredential(companyDb: string, sapUser: string, sapPassword: string): Promise<void> {
  const res = await authFetch("sap-user-credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_db: companyDb, sap_user: sapUser, sap_password: sapPassword }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Erro ${res.status}`);
  }
}

export async function deleteUserSapCredential(companyDb: string): Promise<void> {
  const res = await authFetch("sap-user-credentials", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_db: companyDb }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Erro ${res.status}`);
  }
}

export interface SapAutoLoginResult {
  sessionId: string;
  routeId: string;
  companyDB: string;
  sapUser: string;
  sessionTimeout: number;
}

export async function sapAutoLogin(companyDb: string): Promise<SapAutoLoginResult> {
  const res = await authFetch("sap-auto-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_db: companyDb }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erro ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return data as SapAutoLoginResult;
}
