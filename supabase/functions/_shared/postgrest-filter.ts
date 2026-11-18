// Reduces free text to a literal fragment safe inside PostgREST or()/ilike filters:
// removes filter syntax characters (commas, parentheses, quotes, wildcards, escapes).
export function safeFilterTerm(v: unknown, max = 80): string {
  return String(v ?? "").replace(/[,()"'\\%*:]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
