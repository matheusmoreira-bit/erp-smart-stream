const NFSE_PUBLIC_CONSULTATION_URL = "https://www.nfse.gov.br/ConsultaPublica/";

export function normalizeNfseAccessKey(value?: string | null): string | null {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 50 ? digits : null;
}

export function buildNfsePublicConsultationUrl(value?: string | null): string | null {
  const accessKey = normalizeNfseAccessKey(value);
  if (!accessKey) return null;

  const url = new URL(NFSE_PUBLIC_CONSULTATION_URL);
  url.searchParams.set("chave", accessKey);
  url.searchParams.set("tpc", "1");
  return url.toString();
}
