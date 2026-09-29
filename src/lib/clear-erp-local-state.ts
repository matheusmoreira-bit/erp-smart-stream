import { invalidateLocalState } from "@/lib/local-state-epoch";
import { clearAiCache } from "@/lib/ai-file-cache";
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
  "ai-response-cache-v1:",
  "ai-response-cache-v2:",
  "ai-response-cache-v3:",
  "notifications_dismissed_",
  "intercompany.",
  "erp:",
  "sap:",
  "profile-completion",
  "expenses.",
  "approvals.",
  "sales.",
];

export async function clearErpLocalState(): Promise<void> {
  if (typeof window === "undefined") return;
  invalidateLocalState();
  clearAiCache();

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

  // F13: fila offline de despesas e anexos de NF guardados no IndexedDB.
  await clearUserIndexedDbs();
}

const USER_INDEXED_DBS = ["erpflow-offline", "createExpenseModalQueue"];

/** Aguarda a exclusão efetiva. Bloqueio/erro não é sucesso de limpeza. */
export async function clearUserIndexedDbs(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const results = await Promise.allSettled(USER_INDEXED_DBS.map((name) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    const timer = setTimeout(() => reject(new Error("Não foi possível limpar os dados locais. Feche as outras abas do ERP e tente novamente.")), 5000);
    req.onsuccess = () => { clearTimeout(timer); resolve(); };
    req.onerror = () => { clearTimeout(timer); reject(req.error ?? new Error("Falha ao limpar os dados locais")); };
    // onblocked não conclui a operação: aguarda as outras conexões fecharem.
  })));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
}
