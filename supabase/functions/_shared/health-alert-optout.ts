// Destinatários que optaram por não receber alertas de degradação/saúde do sistema.
// Aplicado a integration-health-alerts e hana-health-probe.
const OPTED_OUT = new Set<string>([
  "juliana.gavineli@anagaming.com.br",
  "juliana.gavineli@cactuscorporation.com",
  "juliana.gavineli@lotusblanca.net",
]);

// Considera também variações de domínio do mesmo usuário (local-part exata).
const OPTED_OUT_LOCAL_PARTS = new Set<string>(["juliana.gavineli"]);

export function isHealthAlertOptedOut(email: string): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e) return true;
  if (OPTED_OUT.has(e)) return true;
  const local = e.split("@")[0] ?? "";
  return OPTED_OUT_LOCAL_PARTS.has(local);
}

export function filterHealthAlertRecipients(list: string[]): string[] {
  return (list ?? []).filter((e) => e && !isHealthAlertOptedOut(e));
}
