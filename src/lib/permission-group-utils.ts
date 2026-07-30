/**
 * Utilitários compartilhados para avaliar grupos de permissão no client.
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
  const strip = (v: string) => v.replace(/(ext|externo|terceiro)$/, "");
  return strip(ca) === strip(cb);
}

/** Normaliza o nome de um grupo de permissão. */
export function normalizeGroupName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Grupos "básicos": só enxergam os próprios documentos. */
const BASIC_GROUPS = new Set(["usuario", "usuarios", "user", "users"]);

export function isBasicGroup(name: unknown): boolean {
  return BASIC_GROUPS.has(normalizeGroupName(name));
}

/**
 * Grupo "Usuário Administrativo": enxerga todos os documentos da própria
 * diretoria (CC de 2º nível vindo do IdP) — não é visão total da base.
 */
export function isDirectorateGroup(name: unknown): boolean {
  const n = normalizeGroupName(name);
  return n === "usuario administrativo" || n === "usuarios administrativos";
}

/**
 * Grupos que sempre veem/selecionam todos os centros de custo.
 * "Usuário Administrativo" continua com visibilidade de documentos restrita à
 * própria diretoria, mas pode LANÇAR em qualquer centro de custo.
 */
export function isFullCostCenterGroup(name: unknown): boolean {
  const n = normalizeGroupName(name);
  return (
    n === "admin" ||
    isDirectorateGroup(n) ||
    n.includes("facilities") ||
    n.includes("contabil") ||
    n.includes("fiscal") ||
    n.includes("financeiro") ||
    n.includes("contas a pagar") ||
    n === "cfo"
  );
}

