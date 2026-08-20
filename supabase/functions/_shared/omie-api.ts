export interface OmieCredentials {
  app_key: string;
  app_secret: string;
}

export async function loadOmieCredentials(
  supabase: any,
  companyDb: string,
): Promise<OmieCredentials> {
  const { data, error } = await supabase
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "omie")
    .eq("company_db", companyDb);
  if (error) throw new Error(`Erro ao carregar credenciais Omie: ${error.message}`);

  const credentials: Record<string, string> = {};
  for (const row of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
    credentials[row.credential_key] = row.credential_value || "";
  }
  if (!credentials.app_key || !credentials.app_secret) {
    throw new Error(`Credenciais Omie não configuradas para a empresa ${companyDb}.`);
  }
  return { app_key: credentials.app_key, app_secret: credentials.app_secret };
}

export async function callOmieApi<T = Record<string, unknown>>(
  credentials: OmieCredentials,
  endpoint: string,
  call: string,
  param: unknown,
): Promise<T> {
  const response = await fetch(`https://app.omie.com.br/api/v1/${endpoint.replace(/^\/+/, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      call,
      app_key: credentials.app_key,
      app_secret: credentials.app_secret,
      param: [param],
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.faultstring) {
    throw new Error(`Omie ${call}: ${body?.faultstring || `HTTP ${response.status}`}`);
  }
  return body as T;
}
