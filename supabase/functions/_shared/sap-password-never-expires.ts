// Helper compartilhado: garante a opção "Senha nunca expira" do SAP B1.
//
// Motivação: após qualquer troca/definição de senha, a política de expiração
// do SAP pode forçar o usuário a trocar a senha novamente (e derrubar
// integrações). Ativamos o flag correspondente em OUSR (PwdNeverEx).
//
// O nome da propriedade no Service Layer varia entre versões/patches, então
// descobrimos dinamicamente lendo o objeto do usuário e procurando a
// propriedade que representa a expiração de senha. É best-effort: qualquer
// falha é apenas logada — nunca quebra o fluxo principal.

type SapReq = (
  path: string,
  method: string,
  body?: unknown,
) => Promise<{ ok: boolean; status: number; data: unknown }>;

const CANDIDATES = [
  "PasswordNeverExpires",
  "PwdNeverExpires",
  "PasswordNeverExpire",
  "PwdNeverEx",
];

/** Nome da propriedade "senha nunca expira" no objeto Users retornado. */
export function findNeverExpiresProp(user: Record<string, unknown> | null | undefined): string | null {
  if (!user || typeof user !== "object") return null;
  const keys = Object.keys(user);
  for (const c of CANDIDATES) {
    const hit = keys.find((k) => k.toLowerCase() === c.toLowerCase());
    if (hit) return hit;
  }
  return keys.find((k) => /pass?w(or)?d/i.test(k) && /expir/i.test(k)) ||
    keys.find((k) => /pwd/i.test(k) && /(never|expir)/i.test(k)) ||
    null;
}

/**
 * Ativa "Senha nunca expira" para o usuário informado. Best-effort: retorna
 * `true` quando o SAP aceitou o PATCH.
 */
export async function ensurePasswordNeverExpires(
  sapRequest: SapReq,
  internalKey: number | string,
  ctx: Record<string, unknown> = {},
): Promise<boolean> {
  try {
    const got = await sapRequest(`Users(${internalKey})`, "GET");
    if (!got.ok) return false;
    const user = got.data as Record<string, unknown> | null;
    const prop = findNeverExpiresProp(user);
    if (!prop) {
      console.warn("[password-never-expires] propriedade não encontrada no schema Users", ctx);
      return false;
    }
    if (String(user?.[prop] ?? "").toLowerCase() === "tyes") return true;
    const patch = await sapRequest(`Users(${internalKey})`, "PATCH", { [prop]: "tYES" });
    if (!patch.ok) {
      console.warn("[password-never-expires] PATCH recusado", { ...ctx, prop, status: patch.status });
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[password-never-expires] erro", { ...ctx, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}
