// Resolução da configuração do provedor de KYP (BeCompliance).
// Prioridade: credenciais cadastradas na tela de Credenciais
// (system_credentials, system_name = "becompliance") → secrets do backend
// (BECOMPLIANCE_*) → overrides não sensíveis de empresa_kyp_config.config.

import type { KYPProviderConfig } from "./types.ts";

const DEFAULT_BASE_URL = "https://api.becompliance.com";

export async function loadBeComplianceCredentials(
  sb: { from: (t: string) => any },
  companyDb?: string | null,
): Promise<Record<string, string>> {
  const read = async (db: string | null) => {
    let q = sb
      .from("system_credentials")
      .select("credential_key, credential_value")
      .eq("system_name", "becompliance");
    q = db ? q.eq("company_db", db) : q.is("company_db", null);
    const { data } = await q;
    const kv: Record<string, string> = {};
    for (const r of (data ?? []) as Array<{ credential_key: string; credential_value: string }>) {
      if (r.credential_value) kv[r.credential_key] = r.credential_value;
    }
    return kv;
  };

  const scoped = companyDb ? await read(companyDb) : {};
  if (Object.keys(scoped).length > 0) return scoped;
  return await read(null);
}

/**
 * Monta o KYPProviderConfig do BeCompliance. Retorna null quando faltar
 * client_id, e-mail ou senha (integração não configurada).
 */
export async function resolveBeComplianceConfig(
  sb: { from: (t: string) => any },
  companyDb?: string | null,
  extra: Record<string, unknown> = {},
): Promise<KYPProviderConfig | null> {
  const kv = await loadBeComplianceCredentials(sb, companyDb);

  const clientId = (kv.client_id || String(extra.client_id ?? "") ||
    Deno.env.get("BECOMPLIANCE_CLIENT_ID") || "").trim();
  const baseUrl = (kv.base_url || String(extra.base_url ?? "") ||
    Deno.env.get("BECOMPLIANCE_BASE_URL") || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const email = (kv.email || Deno.env.get("BECOMPLIANCE_EMAIL") || "").trim();
  const password = kv.password || Deno.env.get("BECOMPLIANCE_PASSWORD") || "";

  if (!clientId || !email || !password) return null;
  return { clientId, baseUrl: baseUrl || DEFAULT_BASE_URL, email, password, extra };
}

export function missingBeComplianceFields(kv: Record<string, string>): string[] {
  const missing: string[] = [];
  if (!(kv.client_id || Deno.env.get("BECOMPLIANCE_CLIENT_ID"))) missing.push("client_id");
  if (!(kv.email || Deno.env.get("BECOMPLIANCE_EMAIL"))) missing.push("email");
  if (!(kv.password || Deno.env.get("BECOMPLIANCE_PASSWORD"))) missing.push("password");
  return missing;
}
