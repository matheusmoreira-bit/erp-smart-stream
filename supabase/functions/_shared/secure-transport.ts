/**
 * Endpoints with ERP credentials must be explicitly configured and use TLS.
 *
 * Exceção controlada (F08 — depende do fornecedor SAP/Wevy): a API HANA
 * legada ainda só responde em HTTP. Hosts listados aqui (ou na env
 * ERP_INSECURE_HOST_ALLOWLIST, separados por vírgula) são aceitos em HTTP
 * até o fornecedor habilitar TLS. Qualquer outro host continua exigindo HTTPS.
 */
const DEFAULT_INSECURE_ALLOWLIST = ["201.48.79.205:8001"];

function insecureAllowlist(): Set<string> {
  const extra = (Deno.env.get("ERP_INSECURE_HOST_ALLOWLIST") || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set([...DEFAULT_INSECURE_ALLOWLIST, ...extra]);
}

export function requireHttpsEndpoint(raw: string | null | undefined): string {
  let url: URL;
  try { url = new URL(String(raw || "").trim()); }
  catch { throw new Error("Configure um endpoint HTTPS válido para a integração ERP."); }
  const httpAllowed = url.protocol === "http:" && insecureAllowlist().has(url.host.toLowerCase());
  if ((url.protocol !== "https:" && !httpAllowed) || url.username || url.password || url.hash || url.search) {
    throw new Error("A integração ERP exige HTTPS, sem credenciais, query ou fragmento na URL base.");
  }
  if (httpAllowed) console.warn(`[secure-transport] HTTP permitido por exceção F08: ${url.host}`);
  return url.toString().replace(/\/+$/, "");
}
