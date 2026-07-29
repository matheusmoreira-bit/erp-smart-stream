/**
 * Limpeza de estado local do ERP.
 *
 * Chamado no logout (e em expiração de sessão) para garantir que, ao recarregar
 * em "/", nenhum dado do usuário anterior sobreviva: sessão do ERP, caches de
 * consulta, preferências por usuário/empresa e caches de IA.
 *
 * Mantemos apenas preferências neutras (ex.: tema), que não expõem dados.
 */

const PRESERVED_LOCAL_KEYS = new Set<string>([
  "erp-theme",
  "theme",
]);

/** Prefixos de chaves em localStorage que pertencem à sessão do usuário. */
const USER_SCOPED_LOCAL_PREFIXES = [
  "ai-response-cache-v2:",
  "notifications_dismissed_",
  "intercompany.",
  "erp:",
  "sap:",
  "profile-completion",
  "expenses.",
  "approvals.",
  "sales.",
];

export function clearErpLocalState() {
  if (typeof window === "undefined") return;

  // sessionStorage é inteiramente escopado à sessão do ERP — pode ir todo.
  try {
    window.sessionStorage.clear();
  } catch { /* ignore */ }

  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || PRESERVED_LOCAL_KEYS.has(key)) continue;
      if (USER_SCOPED_LOCAL_PREFIXES.some((p) => key.startsWith(p))) {
        toRemove.push(key);
      }
    }
    toRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch { /* ignore */ }
}
