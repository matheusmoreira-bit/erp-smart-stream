// deno-lint-ignore-file no-explicit-any

export interface OktaCredentials {
  org_url: string;
  client_id: string;
  private_key: string;
  key_id?: string;
}

export interface NormalizedIdpUser {
  _id: string;
  email: string;
  username: string;
  displayname?: string;
  firstname?: string;
  lastname?: string;
  suspended?: boolean;
  department?: string;
  costCenter?: string;
  jobTitle?: string;
  company?: string;
  employeeIdentifier?: string;
  employeeType?: string;
  manager?: string;
  status?: string;
}

const encoder = new TextEncoder();

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToBytes(pem: string): Uint8Array {
  const normalized = pem.trim();
  if (!normalized.includes("-----BEGIN PRIVATE KEY-----")) {
    throw new Error("Okta: a chave deve estar no formato PEM PKCS#8 (BEGIN PRIVATE KEY).");
  }
  const payload = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  try {
    return Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
  } catch {
    throw new Error("Okta: chave privada PEM invalida.");
  }
}

export function normalizeOktaOrgUrl(raw: string): string {
  const candidate = raw.trim().replace(/\/+$/, "");
  if (!candidate) throw new Error("Okta: URL da organizacao nao configurada.");
  let parsed: URL;
  try {
    parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
  } catch {
    throw new Error("Okta: URL da organizacao invalida.");
  }
  if (parsed.protocol !== "https:") throw new Error("Okta: a URL da organizacao deve usar HTTPS.");
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Okta: informe apenas a origem da organizacao, por exemplo https://empresa.okta.com.");
  }
  return parsed.origin;
}

export async function createOktaClientAssertion(credentials: OktaCredentials, now = Date.now()): Promise<string> {
  const orgUrl = normalizeOktaOrgUrl(credentials.org_url);
  const clientId = credentials.client_id.trim();
  if (!clientId) throw new Error("Okta: Client ID nao configurado.");
  if (!credentials.private_key.trim()) throw new Error("Okta: chave privada nao configurada.");

  let privateKey: CryptoKey;
  try {
    privateKey = await crypto.subtle.importKey(
      "pkcs8",
      pemToBytes(credentials.private_key).buffer as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (error) {
    throw new Error(`Okta: nao foi possivel importar a chave privada (${error instanceof Error ? error.message : String(error)}).`);
  }

  const issuedAt = Math.floor(now / 1000);
  const tokenUrl = `${orgUrl}/oauth2/v1/token`;
  const header: Record<string, string> = { alg: "RS256", typ: "JWT" };
  if (credentials.key_id?.trim()) header.kid = credentials.key_id.trim();
  const payload = {
    aud: tokenUrl,
    iss: clientId,
    sub: clientId,
    iat: issuedAt,
    exp: issuedAt + 300,
    jti: crypto.randomUUID(),
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, encoder.encode(signingInput)),
  );
  return `${signingInput}.${base64Url(signature)}`;
}

async function responseError(response: Response, context: string): Promise<Error> {
  const raw = await response.text();
  let detail = raw;
  try {
    const parsed = JSON.parse(raw);
    detail = parsed.error_description || parsed.errorSummary || parsed.error || raw;
  } catch {
    // Keep the response body as diagnostic detail.
  }
  if (response.status === 401) {
    return new Error(`Okta: autenticacao recusada em ${context}. Verifique Client ID, chave privada e Key ID (${detail}).`);
  }
  if (response.status === 403) {
    return new Error(`Okta: o Service App nao possui permissao para ${context}. Conceda o escopo okta.users.read e uma funcao administrativa (${detail}).`);
  }
  return new Error(`Okta: falha em ${context} (HTTP ${response.status}: ${detail}).`);
}

export async function getOktaAccessToken(credentials: OktaCredentials): Promise<string> {
  const orgUrl = normalizeOktaOrgUrl(credentials.org_url);
  const tokenUrl = `${orgUrl}/oauth2/v1/token`;
  const assertion = await createOktaClientAssertion(credentials);
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "okta.users.read",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
  });
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!response.ok) throw await responseError(response, "emissao do token OAuth");
  const payload = await response.json();
  if (!payload.access_token) throw new Error("Okta: resposta OAuth sem access_token.");
  return payload.access_token as string;
}

function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/i);
    if (match) return match[1];
  }
  return null;
}

interface OktaRawUser {
  id?: unknown;
  status?: unknown;
  profile?: Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function normalizeOktaUser(user: OktaRawUser): NormalizedIdpUser {
  const profile = user?.profile || {};
  const firstName = optionalString(profile.firstName);
  const lastName = optionalString(profile.lastName);
  const composedName = [firstName, lastName].filter(Boolean).join(" ");
  const status = String(user?.status || "");
  const email = optionalString(profile.email);
  const login = optionalString(profile.login);
  return {
    _id: String(user?.id || ""),
    email: email || login || "",
    username: login || email || String(user?.id || ""),
    displayname: optionalString(profile.displayName) || composedName || login,
    firstname: firstName,
    lastname: lastName,
    suspended: status === "SUSPENDED" || status === "DEPROVISIONED",
    department: optionalString(profile.department),
    costCenter: optionalString(profile.costCenter),
    jobTitle: optionalString(profile.title),
    company: optionalString(profile.organization) || optionalString(profile.company),
    employeeIdentifier: optionalString(profile.employeeNumber),
    employeeType: optionalString(profile.employeeType) || optionalString(profile.userType),
    manager: optionalString(profile.managerId) || optionalString(profile.manager),
    status,
  };
}

export async function listOktaUsers(credentials: OktaCredentials, limitUsers = 20000): Promise<NormalizedIdpUser[]> {
  const orgUrl = normalizeOktaOrgUrl(credentials.org_url);
  const token = await getOktaAccessToken(credentials);
  let url: string | null = `${orgUrl}/api/v1/users?limit=200`;
  const users: NormalizedIdpUser[] = [];
  while (url && users.length < limitUsers) {
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw await responseError(response, "listagem de usuarios");
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error("Okta: resposta inesperada na listagem de usuarios.");
    users.push(...page.map(normalizeOktaUser).filter((user) => user._id));
    url = nextLink(response.headers.get("link"));
  }
  return users.slice(0, limitUsers);
}
