// Microsserviço de busca de aprovadores substitutos do SAP B1.
//
// Consulta a view SAP `VW_AG_APROVADORES_SUBSTITUTOS` via o webhook
// mediado do n8n (encapsulado pela Edge Function `sap-b1-proxy` — action
// `queryView`), normaliza campos com fuzzy matching e devolve uma lista
// higienizada. Implementa cache de 5 minutos com stale-while-revalidate:
// em caso de falha (timeout / HTTP 5xx / rejeição do n8n) retornamos o
// último snapshot válido do cache com um aviso no console.
//
// Contrato de saída (por linha):
//   {
//     id, substituteUserId, originalApproverId,
//     substituteUserName, originalApproverName,
//     validFrom, validTo,                 // ISO-8601 em UTC (ou null)
//     isFromSap: true, active: boolean
//   }

import type { SapSession } from "@/lib/sap-client";
import { sapQueryView } from "@/lib/sap-client";

export const SAP_SUBSTITUTES_TABLE = "VW_AG_APROVADORES_SUBSTITUTOS";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const CACHE_STORAGE_KEY = "sap:substitutes:v1";

export interface SapSubstituteRow {
  id: string;
  substituteUserId: string;
  originalApproverId: string;
  substituteUserName: string | null;
  originalApproverName: string | null;
  validFrom: string | null;
  validTo: string | null;
  isFromSap: true;
  active: boolean;
}

/* ─────────── Fuzzy field mapping ─────────── */

const FIELD_ALIASES: Record<keyof Omit<SapSubstituteRow, "isFromSap">, string[]> = {
  id: ["id", "code", "u_code", "lineid", "line_id", "key", "idsubstituicao"],
  substituteUserId: [
    "substituteuserid", "substituteuser", "u_substituteuser", "substitute_user",
    "u_substitute", "substituto", "aprovadorsubstituto", "aprovador_substituto",
    "sub_user", "usuarioaprovadorsubstituto",
  ],
  originalApproverId: [
    "originalapproverid", "originalapprover", "u_originalapprover", "original_approver",
    "u_approver", "aprovadororiginal", "aprovador_original", "aprovador", "orig_user",
    "usuarioaprovadororiginal",
  ],
  substituteUserName: [
    "substituteusername", "nomeaprovadorsubstituto", "nome_aprovador_substituto",
    "substitutename", "nomesubstituto",
  ],
  originalApproverName: [
    "originalapprovername", "nomeaprovadororiginal", "nome_aprovador_original",
    "originalname", "nomeaprovador",
  ],
  validFrom: [
    "validfrom", "u_validfrom", "datainicio", "data_inicio", "vigenciainicio",
    "startdate", "vigenciade", "datainicial",
  ],
  validTo: [
    "validto", "valid_to", "u_validto", "datafim", "data_fim", "vigenciafim",
    "enddate", "vigenciaate", "datafinal",
  ],
  active: ["substituicaoativa", "substituicao_ativa", "active", "status", "ativo"],
};

/** Normaliza chave: minúsculas, sem acentos, sem `_ - .` */
function keyOf(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\-.\s]/g, "");
}

function buildKeyIndex(obj: Record<string, unknown>): Map<string, string> {
  const idx = new Map<string, string>();
  for (const k of Object.keys(obj)) idx.set(keyOf(k), k);
  return idx;
}

function pick(
  obj: Record<string, unknown>,
  idx: Map<string, string>,
  aliases: readonly string[],
): unknown {
  for (const alias of aliases) {
    const real = idx.get(keyOf(alias));
    if (real !== undefined) {
      const v = obj[real];
      if (v !== undefined && v !== null && v !== "") return v;
    }
  }
  return undefined;
}

/* ─────────── Value normalizers ─────────── */

/** Aceita ISO, `YYYY-MM-DD`, `DD/MM/YYYY`, epoch, HANA `YYYY-MM-DD HH:mm:ss`. */
function toIsoUtc(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = String(value).trim();
  if (!s) return null;
  // DD/MM/YYYY[ HH:mm[:ss]]
  const br = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (br) {
    const [, d, m, y, hh = "00", mm = "00", ss = "00"] = br;
    return new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss)).toISOString();
  }
  // YYYY-MM-DD (sem tempo) → 00:00 UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(`${s}T00:00:00.000Z`).toISOString();
  }
  // HANA: "YYYY-MM-DD HH:mm:ss(.SSS)?" — trata como UTC
  const hana = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(s);
  if (hana) return new Date(`${hana[1]}T${hana[2]}Z`).toISOString();
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function toActiveBool(value: unknown): boolean {
  if (value == null || value === "") return true; // default: ativo
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const s = String(value).trim().toLowerCase();
  return !(s === "n" || s === "no" || s === "nao" || s === "não"
    || s === "false" || s === "0" || s === "inactive" || s === "inativo");
}

function toIdString(value: unknown, fallback: string): string {
  if (value == null || value === "") return fallback;
  return String(value).trim();
}

/* ─────────── Normalize a single row ─────────── */

function normalizeRow(raw: unknown, index: number): SapSubstituteRow | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const idx = buildKeyIndex(obj);

  const substituteUserId = String(pick(obj, idx, FIELD_ALIASES.substituteUserId) ?? "").trim();
  const originalApproverId = String(pick(obj, idx, FIELD_ALIASES.originalApproverId) ?? "").trim();

  // Sem os dois lados da substituição, a linha é inútil — descartar.
  if (!substituteUserId || !originalApproverId) return null;

  const idRaw = pick(obj, idx, FIELD_ALIASES.id);
  const id = toIdString(
    idRaw,
    `sap-${originalApproverId.toLowerCase()}-${substituteUserId.toLowerCase()}-${index}`,
  );

  return {
    id,
    substituteUserId,
    originalApproverId,
    substituteUserName:
      (pick(obj, idx, FIELD_ALIASES.substituteUserName) as string | undefined)?.toString().trim() || null,
    originalApproverName:
      (pick(obj, idx, FIELD_ALIASES.originalApproverName) as string | undefined)?.toString().trim() || null,
    validFrom: toIsoUtc(pick(obj, idx, FIELD_ALIASES.validFrom)),
    validTo: toIsoUtc(pick(obj, idx, FIELD_ALIASES.validTo)),
    isFromSap: true,
    active: toActiveBool(pick(obj, idx, FIELD_ALIASES.active)),
  };
}

/* ─────────── Response unwrapping ─────────── */

/**
 * Aceita as várias formas de resposta que o webhook n8n pode devolver:
 *   1. Array<{ json: T }>                        (n8n item wrapper)
 *   2. { value | data | results | rows: T[] }    (envelopes REST comuns)
 *   3. T[]                                       (array cru)
 *   4. T                                         (objeto único → array unitário)
 */
export function unwrapSapPayload(payload: unknown): unknown[] {
  if (payload == null) return [];
  let current: unknown = payload;

  if (Array.isArray(current) && current.length > 0
      && current.every((it) => it && typeof it === "object" && "json" in (it as object))) {
    current = current.map((it) => (it as { json: unknown }).json);
  }

  if (!Array.isArray(current) && current && typeof current === "object") {
    const rec = current as Record<string, unknown>;
    for (const key of ["value", "data", "results", "rows"]) {
      if (Array.isArray(rec[key])) { current = rec[key]; break; }
    }
  }

  if (Array.isArray(current)) return current;
  return [current];
}

export function normalizeSapSubstitutes(payload: unknown): SapSubstituteRow[] {
  return unwrapSapPayload(payload)
    .map((row, i) => normalizeRow(row, i))
    .filter((r): r is SapSubstituteRow => r !== null);
}

/* ─────────── Cache (stale-while-revalidate) ─────────── */

interface CacheEntry {
  savedAt: number;
  rows: SapSubstituteRow[];
}

function cacheKey(session: SapSession): string {
  return `${CACHE_STORAGE_KEY}:${session.companyDB}`;
}

function readCache(session: SapSession): CacheEntry | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(session));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(session: SapSession, rows: SapSubstituteRow[]): void {
  try {
    const entry: CacheEntry = { savedAt: Date.now(), rows };
    sessionStorage.setItem(cacheKey(session), JSON.stringify(entry));
  } catch {
    /* quota / private mode — cache é apenas otimização */
  }
}

/* ─────────── Public API ─────────── */

export interface FetchSubstitutesResult {
  rows: SapSubstituteRow[];
  fromCache: boolean;
  stale: boolean;      // true quando fallback pós-erro
  updatedAt: string;   // ISO
  warning?: string;
}

/**
 * Busca substitutos da view SAP. Estratégia:
 *   1. Se houver cache fresco (<5min) → devolve direto.
 *   2. Consulta o webhook (via sap-b1-proxy queryView).
 *   3. Em caso de erro (timeout, 5xx, rede) e houver cache prévio → devolve
 *      o cache com `stale=true` e log de aviso. Sem cache prévio, propaga o
 *      erro para o chamador.
 */
export async function fetchSapSubstitutes(
  session: SapSession,
  opts?: { force?: boolean },
): Promise<FetchSubstitutesResult> {
  if (session.erpType !== "sap") {
    return { rows: [], fromCache: false, stale: false, updatedAt: new Date().toISOString() };
  }

  const cached = readCache(session);
  const force = !!opts?.force;
  if (!force && cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return {
      rows: cached.rows,
      fromCache: true,
      stale: false,
      updatedAt: new Date(cached.savedAt).toISOString(),
    };
  }

  try {
    const result = await sapQueryView<unknown>(session, SAP_SUBSTITUTES_TABLE, undefined, false);
    const rows = normalizeSapSubstitutes(result.data);
    writeCache(session, rows);
    return { rows, fromCache: false, stale: false, updatedAt: new Date().toISOString() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (cached) {
      console.warn(
        `[sap-substitutes] Falha ao consultar SAP (${message}). ` +
        `Servindo snapshot do cache de ${new Date(cached.savedAt).toISOString()}.`,
      );
      return {
        rows: cached.rows,
        fromCache: true,
        stale: true,
        updatedAt: new Date(cached.savedAt).toISOString(),
        warning: `SAP indisponível — exibindo dados em cache (${message}).`,
      };
    }
    throw err;
  }
}

/** Limpa o cache local — útil após criar/revogar substituição manualmente. */
export function invalidateSapSubstitutesCache(session: SapSession): void {
  try { sessionStorage.removeItem(cacheKey(session)); } catch { /* noop */ }
}
