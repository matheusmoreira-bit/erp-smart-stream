import { unzip } from "https://esm.sh/fflate@0.8.2";

export interface MasterTaxFileCredentials {
  base_url: string;
  token: string;
}

export function masterTaxAuthHeader(token: string): string {
  return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}

async function unzipToPdf(bytes: Uint8Array): Promise<Uint8Array | null> {
  return await new Promise((resolve) => {
    unzip(bytes, (error, files) => {
      if (error || !files) return resolve(null);
      const entries = Object.entries(files);
      const selected = entries.find(([name]) => name.toLowerCase().endsWith(".pdf")) ||
        entries.find(([, content]) => content && content.byteLength > 0);
      resolve(selected ? selected[1] : null);
    });
  });
}

export async function fetchMasterTaxPdf(
  credentials: MasterTaxFileCredentials,
  masterTaxId: string,
): Promise<{ bytes: Uint8Array; contentType: "application/pdf" } | { error: string }> {
  const url = `${credentials.base_url}/api/notas-servico/danfse/${encodeURIComponent(masterTaxId)}`;
  const response = await fetch(url, {
    headers: { Authorization: masterTaxAuthHeader(credentials.token), Accept: "*/*" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (contentType.includes("zip") || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const pdf = await unzipToPdf(bytes);
    return pdf
      ? { bytes: pdf, contentType: "application/pdf" }
      : { error: "Não foi possível extrair o PDF do ZIP DANFSE" };
  }
  if (contentType.includes("pdf") || (bytes[0] === 0x25 && bytes[1] === 0x50)) {
    return { bytes, contentType: "application/pdf" };
  }
  return { error: `Formato inesperado (${contentType || "sem content-type"})` };
}
