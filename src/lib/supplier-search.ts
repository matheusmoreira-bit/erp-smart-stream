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
  if (extra && extra.includes(q)) return 30;

  // Multi-token AND (ordem livre)
  const tokens = q.split(" ").filter((t) => t.length > 0);
  if (tokens.length > 1) {
    const haystack = `${name} ${fantasy} ${code} ${extra} ${taxId}`;
    const allHit = tokens.every((t) => haystack.includes(t));
    if (allHit) return 25;
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
