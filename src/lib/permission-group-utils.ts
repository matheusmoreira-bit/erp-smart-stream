/**
 * Utilitários compartilhados de IDENTIDADE para avaliar grupos no client.
 *
 * Regras de negócio (visibilidade, centros de custo, cadastros) NÃO moram aqui:
 * são capacidades configuradas no grupo — ver `src/lib/permission-capabilities.ts`
 * e `src/hooks/useMyCapabilities.ts`.
 */

/** Normaliza um identificador (email/usuário SAP) removendo acentos e símbolos. */
export function canonicalIdentity(value: unknown): string {
  const raw = String(value ?? "").toLowerCase().trim();
  const prefix = raw.includes("@") ? raw.slice(0, raw.indexOf("@")) : raw;
  return prefix
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Compara duas identidades de forma flexível (email x usuário SAP, .ext, acentos). */
export function identityMatches(a: unknown, b: unknown): boolean {
  const ca = canonicalIdentity(a);
  const cb = canonicalIdentity(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  // tolera sufixos de conta externa/serviço (ex.: blenda.pinheiro.ext)
  const strip = (v: string) => v.replace(/(ext|externo|terceiro|adm|admin)$/, "");
  return strip(ca) === strip(cb);
}

/** Normaliza o nome de um grupo de permissão (uso apenas para exibição/ordenação). */
export function normalizeGroupName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
