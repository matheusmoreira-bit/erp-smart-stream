/**
 * Utilitários compartilhados de IDENTIDADE para avaliar grupos no client.
 *
 * Regras de negócio (visibilidade, centros de custo, cadastros) NÃO moram aqui:
 * são capacidades configuradas no grupo — ver `src/lib/permission-capabilities.ts`
 * e `src/hooks/useMyCapabilities.ts`.
 */

// Normalização vem da fonte única (`src/lib/text-normalize.ts`).
export {
  canonicalIdentity,
  identityMatches,
} from "@/lib/text-normalize";
import { normalizeText } from "@/lib/text-normalize";

/** Normaliza o nome de um grupo de permissão (uso apenas para exibição/ordenação). */
export function normalizeGroupName(value: unknown): string {
  return normalizeText(value);
}
