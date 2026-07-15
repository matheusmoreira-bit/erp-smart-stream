// Utilitários de busca tolerante para fornecedores/clientes.
//
// Regras:
//   • acento-insensível (NFD + remove diacríticos)
//   • case-insensível
//   • tokenização por espaço; todos os tokens precisam bater em ALGUM campo
//   • matching por dígitos (CNPJ/CPF) quando o termo tem ≥2 dígitos
//   • ranking simples: prefixo do nome > CNPJ exato > nome contém > outros

export function normalizeText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toString()
    .normalize("NFD")
    // Remove diacríticos (acentos)
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function onlyDigits(s: string | null | undefined): string {
  return (s ?? "").toString().replace(/\D+/g, "");
}

/**
 * Sufixos corporativos comuns que atrapalham a busca por nome.
 * Removidos antes do matching para casos como "Figma Inc." → "figma".
 */
const CORPORATE_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "l.l.c", "ltd", "ltda", "limitada", "limited",
  "co", "corp", "corporation", "company",
  "sa", "s/a", "s.a", "sac", "spa", "srl", "srls", "sarl", "sas", "sasu",
  "nv", "bv", "plc", "gmbh", "ag", "ab", "oy", "kk", "kg", "ohg", "sl", "slu",
  "pty", "pte", "eireli", "me", "epp", "cia", "&cia",
  "holding", "holdings", "group", "grupo", "groupe", "international", "intl", "hldg",
  "the", "de",
]);

/**
 * Retira siglas/sufixos corporativos (INC., S.A., LTDA, LTD, LLC…),
 * pontuação e o "&" para deixar apenas o "core" do nome.
 * Ex.: "Figma Inc." → "figma"; "ACME S/A" → "acme"; "BEM Holdings LTDA" → "bem".
 */
export function stripCorporateSuffixes(s: string | null | undefined): string {
  const n = normalizeText(s);
  if (!n) return "";
  const tokens = n
    .replace(/[.,/&]+/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]+$/u, "").replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter(Boolean)
    .filter((t) => !CORPORATE_SUFFIXES.has(t));
  return tokens.join(" ").trim();
}

export interface Searchable {
  code?: string | null;
  name?: string | null;
  extra?: string | null;
  details?: { fantasyName?: string | null; taxId?: string | null } | null;
}

/**
 * Retorna score do match (0 = não bate, quanto maior melhor). Rankeia:
 *   100+  código exato
 *    80+  CNPJ/CPF exato
 *    60+  nome começa com o termo
 *    40+  nome contém o termo completo
 *    20+  todos os tokens do termo aparecem em algum campo textual
 *    10+  todos os dígitos do termo aparecem em algum dígito de identificador
 *
 * Também aplica match "core" (sem siglas INC/S.A./LTDA…) para casar
 * "Figma Inc." (documento) com "FIGMA" (SAP).
 */
export function scoreMatch(item: Searchable, rawQuery: string): number {
  const q = normalizeText(rawQuery);
  if (!q) return 1; // sem query = todos passam com score baixo (ordem original)

  const name = normalizeText(item.name);
  const code = normalizeText(item.code);
  const extra = normalizeText(item.extra);
  const fantasy = normalizeText(item.details?.fantasyName);
  const taxId = normalizeText(item.details?.taxId);

  // Match numérico (CNPJ/CPF/CardCode digital)
  const qDigits = onlyDigits(rawQuery);
  const codeDigits = onlyDigits(item.code);
  const extraDigits = onlyDigits(item.extra);
  const taxDigits = onlyDigits(item.details?.taxId);

  if (qDigits.length >= 2) {
    if (taxDigits && taxDigits === qDigits) return 90;
    if (codeDigits && codeDigits === qDigits) return 105;
    if (
      (taxDigits && taxDigits.includes(qDigits)) ||
      (codeDigits && codeDigits.includes(qDigits)) ||
      (extraDigits && extraDigits.includes(qDigits))
    ) {
      return 80;
    }
  }

  if (code && code === q) return 100;
  if (name && name.startsWith(q)) return 70;
  if (fantasy && fantasy.startsWith(q)) return 65;
  if (name && name.includes(q)) return 55;
  if (fantasy && fantasy.includes(q)) return 50;

  // Match "core" — remove siglas (INC., S.A., LTDA…) dos dois lados.
  const qCore = stripCorporateSuffixes(rawQuery);
  if (qCore && qCore !== q) {
    const nameCore = stripCorporateSuffixes(item.name);
    const fantasyCore = stripCorporateSuffixes(item.details?.fantasyName);
    if (nameCore && nameCore === qCore) return 95;
    if (fantasyCore && fantasyCore === qCore) return 92;
    if (nameCore && nameCore.startsWith(qCore)) return 68;
    if (fantasyCore && fantasyCore.startsWith(qCore)) return 63;
    if (nameCore && nameCore.includes(qCore)) return 48;
    if (fantasyCore && fantasyCore.includes(qCore)) return 44;
    // Recíproco: nome do SAP pode ser mais curto que o do documento.
    if (nameCore && qCore.includes(nameCore) && nameCore.length >= 3) return 42;
    if (fantasyCore && qCore.includes(fantasyCore) && fantasyCore.length >= 3) return 40;
  }

  if (extra && extra.includes(q)) return 30;

  // Multi-token AND (ordem livre), usando forma "core" para tolerar siglas.
  const qCoreForTokens = qCore || q;
  const tokens = qCoreForTokens.split(" ").filter((t) => t.length > 1);
  if (tokens.length >= 1) {
    const nameCore = stripCorporateSuffixes(item.name);
    const fantasyCore = stripCorporateSuffixes(item.details?.fantasyName);
    const haystack = `${nameCore} ${fantasyCore} ${name} ${fantasy} ${code} ${extra} ${taxId}`;
    const allHit = tokens.every((t) => haystack.includes(t));
    if (allHit) return tokens.length > 1 ? 28 : 22;
    // Fuzzy por prefixo (mínimo 4 chars) — cobre "figma" ↔ "figmahq".
    const anyPrefix = tokens.every((t) =>
      t.length >= 4 && haystack.split(/\s+/).some((h) => h.startsWith(t.slice(0, 4))),
    );
    if (anyPrefix) return 15;
  }

  return 0;
}

export function filterAndRank<T extends Searchable>(
  items: T[],
  query: string,
  limit = 50,
): T[] {
  if (!query.trim()) return items.slice(0, limit);
  const scored = items
    .map((it) => ({ it, score: scoreMatch(it, query) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((s) => s.it);
}
