export const SHARED_DRIVE = "0AEGlkXe3D_4wUk9PVA";
export const ROOT_NAME = "ERP-Flow-Backup";
export const PENDING_BUCKETS = ["expense-attachments", "sap-archive", "registration-attachments", "nf-entrada-files", "nfse-pdfs", "nfse-xmls"];
const sensitive = /secret|token|password|credential|private.?key|api.?key|access.?key|authorization|cookie|encrypted|session|signed.?url|webhook/i;
export function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    if (/Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|(?:sk_live_|sk_test_|sb_secret_)[A-Za-z0-9]+|https?:\/\/[^\s]*[?&](?:token|key|signature|secret)=/i.test(value)) return "[REDACTED]";
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitive.test(key)).map(([key, v]) => [key, sanitize(v)]));
  return value;
}
export function csvCell(value: unknown): string {
  const clean = sanitize(value);
  let text = clean == null ? "" : typeof clean === "object" ? JSON.stringify(clean) : String(clean);
  if (/^[\s]*[=+@-]/.test(text) && typeof value !== "number") text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function csvRows(rows: Record<string, unknown>[], columns: readonly string[]): string {
  return rows.map(row => columns.map(c => csvCell(row[c])).join(";")).join("\r\n") + (rows.length ? "\r\n" : "");
}
export function safeSegment(value: string): string { return encodeURIComponent(value || "_global"); }
export function canComplete(tablesDone: boolean, sapDone: boolean, attachmentPending: number, errors: number): boolean {
  return tablesDone && sapDone && attachmentPending === 0 && errors === 0;
}