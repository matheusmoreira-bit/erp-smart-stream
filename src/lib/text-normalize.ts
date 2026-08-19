// ─────────────────────────────────────────────────────────────────────────────
// FONTE ÚNICA DE NORMALIZAÇÃO DE TEXTO E IDENTIDADE
//
// Toda comparação/filtro de texto do sistema (aprovações, integrações ERP,
// grupos de permissão, buscas) DEVE usar as funções deste módulo. Não crie
// variantes locais de `stripDiacritics`/`normalize` — divergências entre elas
// já causaram documentos invisíveis para o aprovador (ex.: "Mourão" x "mourao")
// e vínculos de integração perdidos.
//
// O gêmeo deste arquivo para Edge Functions é
// `supabase/functions/_shared/text-normalize.ts` e deve permanecer idêntico.
// ─────────────────────────────────────────────────────────────────────────────

/** Remove acentos/diacríticos preservando o restante do texto. */
export function stripDiacritics(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normalização padrão para BUSCA e COMPARAÇÃO de texto livre:
 * sem acentos, minúsculas, espaços colapsados e sem espaços nas pontas.
 */
export function normalizeText(value: unknown): string {
  return stripDiacritics(value).toLowerCase().replace(/\s+/g, " ").trim();
}

/** Igual a `normalizeText`, usado em filtros de busca (alias semântico). */
export const normalizeSearch = normalizeText;

/**
 * Normalização por PALAVRAS: qualquer caractere não alfanumérico vira espaço.
 * Útil para casar "Cactus-Tecnologia S.A." com "cactus tecnologia sa".
 */
export function normalizeWords(value: unknown): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** `normalizeWords` em caixa alta (usado por regras que comparam em maiúsculas). */
export function normalizeUpper(value: unknown): string {
  return normalizeWords(value).toUpperCase();
}

/** Somente [a-z0-9] — chave compacta para casar identificadores/códigos. */
export function normalizeCompact(value: unknown): string {
  return stripDiacritics(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** slug estável (a-z0-9 separados por hífen). */
export function slugify(value: unknown): string {
  return normalizeWords(value).replace(/\s+/g, "-");
}

/** Parte antes do "@" (UserCode do SAP x e-mail corporativo). */
export function emailLocalPart(value: unknown): string {
  const v = normalizeText(value);
  const at = v.indexOf("@");
  return at > 0 ? v.slice(0, at) : v;
}

/** Sufixos de contas externas/serviço que não mudam a pessoa. */
const ACCOUNT_SUFFIX_RE = /[._\-\s]?(ext|externo|terceiro|adm|admin)$/;

/** Identidade canônica: local-part sem acentos, símbolos ou caixa. */
export function canonicalIdentity(value: unknown): string {
  return normalizeCompact(emailLocalPart(value));
}

/**
 * Chave de usuário: identidade canônica sem sufixos de conta externa
 * (blenda.pinheiro.ext ≡ blenda.pinheiro). Espelha `public.canonical_user_key`.
 */
export function canonicalUserKey(value: unknown): string {
  const local = emailLocalPart(value);
  if (!local) return "";
  return normalizeCompact(stripDiacritics(local).replace(ACCOUNT_SUFFIX_RE, ""));
}

/** Duas identidades (e-mail, UserCode, login) representam a mesma pessoa? */
export function identityMatches(a: unknown, b: unknown): boolean {
  const ca = canonicalIdentity(a);
  const cb = canonicalIdentity(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  const ka = canonicalUserKey(a);
  const kb = canonicalUserKey(b);
  return !!ka && ka === kb;
}

/** Conectores ignorados ao comparar nomes de pessoas. */
const NAME_CONNECTORS = new Set(["de", "da", "do", "das", "dos", "e"]);

/** Tokens de um nome/identificador de pessoa, sem conectores nem domínio. */
export function tokenizePerson(value: unknown): string[] {
  return normalizeText(value)
    .replace(/@[^\s]*/g, " ")
    .replace(/[._\-@]+/g, " ")
    .split(/\s+/)
    .map((t) => stripDiacritics(t))
    .filter((t) => t && !NAME_CONNECTORS.has(t));
}

/**
 * Dois tokens de nome representam a mesma palavra?
 *
 * Além da igualdade exata, tolera ERROS DE GRAFIA por truncamento/letra a mais
 * ("guerard" x "guerardi", "goncalve" x "goncalves"): um token precisa ser
 * prefixo do outro, com no mínimo 4 caracteres e diferença de até 2 letras.
 * Não faz correspondência difusa genérica — só prefixo — para evitar casar
 * pessoas diferentes.
 */
export function tokenEquivalent(a: string, b: string): boolean {
  const x = stripDiacritics(String(a ?? "")).toLowerCase();
  const y = stripDiacritics(String(b ?? "")).toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < 4) return false;
  if (long.length - short.length > 2) return false;
  return long.startsWith(short);
}

/** Todos os tokens de `a` têm equivalente em `b` (tolerante a grafia)? */
export function personTokensSubset(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  return a.every((t) => b.some((o) => tokenEquivalent(t, o)));
}
