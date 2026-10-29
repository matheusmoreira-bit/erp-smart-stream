// Regras puras do aviso de anexos pendentes de cópia manual para o Drive.
export const BUCKETS = ["expense-attachments", "sap-archive", "registration-attachments", "nf-entrada-files", "nfse-pdfs", "nfse-xmls"] as const;
export type Bucket = typeof BUCKETS[number];
export type Item = { name: string; bytes: number };
export type BucketStat = { bucket: Bucket; storage_files: number; storage_mb: number; drive_files: number; complete: boolean; drive_folder: string };

export const basename = (p: string) => p.split("/").filter(Boolean).pop() || p;

/** Subpasta da ERP-Flow-Backup onde cada bucket deve ser colocado. */
export function driveFolderFor(bucket: Bucket): string {
  if (bucket === "expense-attachments") return "anexos-pedidos-flow";
  if (bucket === "sap-archive") return "arquivo-sap/<empresa>/anexos";
  return `outros-anexos/${bucket}`;
}

/** Bucket ao qual um arquivo do Drive pertence, pelo caminho relativo à raiz ERP-Flow-Backup. */
export function bucketForDrivePath(segments: string[]): Bucket | null {
  const [top, second, third] = segments;
  if (top === "anexos-pedidos-flow") return "expense-attachments";
  if (top === "arquivo-sap" && third === "anexos") return "sap-archive";
  if (top === "outros-anexos" && (BUCKETS as readonly string[]).includes(second)) return second as Bucket;
  return null;
}

/** Compara por nome (sem pasta) e tamanho, contando repetições. */
export function compareBucket(bucket: Bucket, storage: Item[], drive: Item[]): BucketStat {
  const avail = new Map<string, number>();
  for (const d of drive) { const k = `${basename(d.name)}|${d.bytes}`; avail.set(k, (avail.get(k) || 0) + 1); }
  let matched = 0;
  for (const s of storage) {
    const k = `${basename(s.name)}|${s.bytes}`; const n = avail.get(k) || 0;
    if (n > 0) { matched++; avail.set(k, n - 1); }
  }
  const bytes = storage.reduce((a, s) => a + s.bytes, 0);
  return { bucket, storage_files: storage.length, storage_mb: Math.round(bytes / 1048576 * 10) / 10, drive_files: matched, complete: matched === storage.length, drive_folder: driveFolderFor(bucket) };
}

/** Carga inicial concluída: toda empresa tem cursores, todos completos, e nenhum anexo pendente. */
export function sapInitialLoadDone(companies: readonly string[], cursors: { company_db: string; completed: boolean }[], pendingAttachments: number): boolean {
  if (pendingAttachments > 0) return false;
  return companies.every((c) => { const own = cursors.filter((x) => x.company_db === c); return own.length > 0 && own.every((x) => x.completed); });
}

export type Mode = "check" | "weekly";
export type Decision = "none" | "initial" | "weekly" | "final";
/** Decide o envio. "check" (diário) só manda o aviso inicial e o final; "weekly" manda enquanto houver pendência. */
export function decide(mode: Mode, opts: { allComplete: boolean; sapDone: boolean; initialSent: boolean; completed: boolean }): Decision {
  if (opts.completed) return "none";
  if (opts.allComplete && opts.sapDone) return "final";
  if (mode === "weekly") return "weekly";
  if (opts.sapDone && !opts.initialSent) return "initial";
  return "none";
}
