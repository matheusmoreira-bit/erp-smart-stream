/**
 * Exibição de usuários: sempre mostrar o NOME, nunca o e-mail cru.
 *
 * Regras:
 *  - "Fulano <fulano@x.com>"  → "Fulano"
 *  - "daniela.camargos@x.com" → "Daniela Camargos"
 *  - "matheus.moreira"        → "Matheus Moreira"
 *  - "Marco Tulio"            → inalterado
 *
 * Camada puramente de apresentação — não altera dados persistidos.
 */

const PARTICLES = new Set(["de", "da", "do", "das", "dos", "e"]);
const SUFFIXES = new Set(["ext", "extra", "adm", "admin", "temp"]);

function titleCasePart(part: string): string {
  const lower = part.toLocaleLowerCase("pt-BR");
  if (PARTICLES.has(lower)) return lower;
  return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
}

export function displayUserName(raw?: string | null, fallback = "—"): string {
  const value = (raw ?? "").trim();
  if (!value) return fallback;

  // "Nome <email@dominio>" → usa a parte do nome quando existir
  const angle = value.match(/^(.*)<([^>]+)>\s*$/);
  if (angle) {
    const name = angle[1].trim();
    if (name) return displayUserName(name, fallback);
    return displayUserName(angle[2], fallback);
  }

  // Já é um nome legível (tem espaço e não é e-mail)
  if (!value.includes("@") && /\s/.test(value)) return value;

  const local = value.includes("@") ? value.split("@")[0] : value;
  if (!/[._-]/.test(local)) {
    // login simples (ex.: "manager") — capitaliza
    return /\s/.test(local) ? local : titleCasePart(local);
  }

  const parts = local
    .split(/[._-]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p, i, arr) => !(i === arr.length - 1 && arr.length > 1 && SUFFIXES.has(p.toLowerCase())));

  if (parts.length === 0) return fallback;
  return parts.map(titleCasePart).join(" ");
}

/** Igual a displayUserName, mas devolve string vazia quando não há valor. */
export function displayUserNameOrEmpty(raw?: string | null): string {
  return displayUserName(raw, "");
}
