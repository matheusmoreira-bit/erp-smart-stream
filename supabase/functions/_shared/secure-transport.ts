/** Endpoints with ERP credentials must be explicitly configured and use TLS. */
export function requireHttpsEndpoint(raw: string | null | undefined): string {
  let url: URL;
  try { url = new URL(String(raw || "").trim()); }
  catch { throw new Error("Configure um endpoint HTTPS válido para a integração ERP."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
    throw new Error("A integração ERP exige HTTPS, sem credenciais, query ou fragmento na URL base.");
  }
  return url.toString().replace(/\/+$/, "");
}
