// Escapes untrusted text before interpolating it into e-mail HTML.
export function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Masks an e-mail for diagnostics so logs never hold the full address.
export function maskEmail(v: unknown): string {
  const s = String(v ?? "");
  const at = s.indexOf("@");
  if (at < 1) return s ? "***" : "";
  return `${s[0]}***@${s.slice(at + 1)}`;
}
