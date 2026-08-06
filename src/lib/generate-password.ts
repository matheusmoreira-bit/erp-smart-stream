/**
 * Gera uma senha forte e única (evita histórico de senhas do SAP).
 * Sem caracteres ambíguos (0/O, 1/l/I).
 */
export function generateUniquePassword(length = 12): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const specials = "!@#$%&*?";
  const pick = (src: string) => src[Math.floor(Math.random() * src.length)];
  const out = [pick(upper), pick(lower), pick(digits), pick(specials)];
  const all = upper + lower + digits + specials;
  for (let i = out.length; i < Math.max(8, length); i++) out.push(pick(all));
  return out.sort(() => Math.random() - 0.5).join("");
}
