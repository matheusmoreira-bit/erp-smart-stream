import { BUCKETS, driveFolderFor, type Bucket } from "../../supabase/functions/attachment-backup-notice/core";

export { BUCKETS, driveFolderFor, type Bucket };
export const PART_BYTES = 200 * 1024 * 1024;
export type BackupFile = { bucket: Bucket; name: string; bytes: number; version: string };
export const fileKey = (file: BackupFile) => JSON.stringify([file.bucket, file.name, file.bytes, file.version]);

export type InventoryRow = { bucket: Bucket; files: BackupFile[]; loading: boolean; error?: string };

export function parseInventory(bucket: Bucket, data: unknown): BackupFile[] {
  if (!Array.isArray(data)) throw new Error("Inventário inválido");
  return data.map((value: unknown) => {
    if (!value || typeof value !== "object" || !("name" in value) || typeof value.name !== "string" || !("bytes" in value) || value.bytes === null || value.bytes === "" || !("version" in value) || typeof value.version !== "string") {
      throw new Error("Metadados de arquivo indisponíveis");
    }
    const bytes = Number(value.bytes);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Tamanho de arquivo indisponível");
    return { bucket, name: value.name, bytes, version: value.version };
  });
}

// Independent completions keep a slow or failed bucket from hiding the others.
export async function loadInventories(
  fetchBucket: (bucket: Bucket) => Promise<BackupFile[]>,
  onRow: (row: InventoryRow) => void,
): Promise<void> {
  await Promise.all(BUCKETS.map(async bucket => {
    try { onRow({ bucket, files: await fetchBucket(bucket), loading: false }); }
    catch (error) { onRow({ bucket, files: [], loading: false, error: error instanceof Error ? error.message : "Falha ao consultar inventário" }); }
  }));
}

export function zipPath(file: BackupFile): string {
  const segments = file.name.split("/");
  if (segments.some(s => !s || s === "." || s === ".." || /[\\\x00-\x1f:]/.test(s))) {
    throw new Error("Caminho de arquivo inválido");
  }
  if (file.bucket === "sap-archive") {
    const [company, ...rest] = segments;
    if (!company || !rest.length) throw new Error("Empresa ausente no caminho SAP");
    return `${driveFolderFor(file.bucket).replace("<empresa>", company)}/${rest.join("/")}`;
  }
  return `${driveFolderFor(file.bucket)}/${file.name}`;
}

export function splitParts(files: BackupFile[], limit = PART_BYTES): { parts: BackupFile[][]; rejected: BackupFile[] } {
  const parts: BackupFile[][] = [];
  const rejected: BackupFile[] = [];
  const seen = new Set<string>();
  let current: BackupFile[] = [];
  let bytes = 22;
  for (const file of files) {
    let path: string;
    try { path = zipPath(file); } catch { rejected.push(file); continue; }
    const weight = file.bytes + new TextEncoder().encode(path).length * 2 + 128;
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || weight + 22 > limit || seen.has(path)) {
      rejected.push(file); continue;
    }
    seen.add(path);
    if (bytes + weight > limit && current.length) {
      parts.push(current); current = []; bytes = 22;
    }
    current.push(file); bytes += weight;
  }
  if (current.length) parts.push(current);
  return { parts, rejected };
}

export async function retryFile<T>(operation: () => Promise<T>, cancelled: () => boolean): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (cancelled()) throw new Error("Cancelado");
    try { return await operation(); } catch (error) {
      if (attempt === 2 || cancelled()) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new Error("Falha ao baixar arquivo");
}

export function downloadZip(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}