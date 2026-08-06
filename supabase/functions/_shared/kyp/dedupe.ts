// Guard anti-duplicidade do KYP.
//
// Regra de negócio (compliance): só abrimos uma NOVA due diligence quando
//   (a) o parceiro não possui nenhuma diligência no provedor, ou
//   (b) a diligência mais recente está VENCIDA (expiry_date no passado).
//
// Além da regra do provedor, este módulo aplica uma trava local para evitar
// corridas entre o cron (kyp-orchestrator) e o fluxo de cadastro
// (registration-supplier-create), que antes conseguiam abrir duas diligências
// para o mesmo documento na mesma janela de tempo.

import { maisRecente, type KYPDiligenciaResult } from "./types.ts";

/** Janela padrão da trava local (horas). */
export const CREATE_COOLDOWN_HORAS = 24;

interface MinimalSb {
  from: (table: string) => any;
}

/**
 * Escolhe a diligência "vigente" entre as retornadas pelo provedor.
 * Preferência: diligência não vencida (aprovada ou em análise) mais recente.
 * Só cai para a mais recente vencida quando não existe nenhuma vigente —
 * é exatamente esse caso que autoriza a criação de uma nova.
 */
export function selecionarDiligencia(
  rows: Array<Record<string, unknown>>,
  now = new Date(),
): Record<string, unknown> | null {
  if (!rows?.length) return null;
  const vigentes = rows.filter((r) => {
    const raw = (r.expiry_date ?? r.expiration_date ?? r.valid_until ?? null) as string | null;
    if (!raw) return true; // sem expiração = vigente
    const t = new Date(raw).getTime();
    if (isNaN(t)) return true;
    return t >= now.getTime();
  });
  return maisRecente(vigentes.length ? vigentes : rows);
}

/**
 * Trava local: houve criação de diligência bem-sucedida para o mesmo documento
 * nas últimas `horas`? Nesse caso não criamos outra, mesmo que a consulta ao
 * provedor ainda não enxergue a diligência recém-aberta (indexação/latência).
 */
export async function criacaoRecente(
  sb: MinimalSb,
  documento: string,
  horas = CREATE_COOLDOWN_HORAS,
): Promise<{ existe: boolean; providerRefId: string | null; executadoEm: string | null }> {
  const doc = String(documento ?? "").replace(/\D+/g, "");
  if (!doc) return { existe: false, providerRefId: null, executadoEm: null };
  const desde = new Date(Date.now() - horas * 3600_000).toISOString();
  const { data, error } = await sb
    .from("kyp_avaliacoes")
    .select("provider_ref_id, executado_em")
    .eq("documento", doc)
    .eq("acao", "CREATE")
    .eq("sucesso", true)
    .gte("executado_em", desde)
    .order("executado_em", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[kyp][dedupe] consulta falhou:", error.message);
    return { existe: false, providerRefId: null, executadoEm: null };
  }
  const row = (data ?? [])[0] as { provider_ref_id?: string | null; executado_em?: string | null } | undefined;
  if (!row) return { existe: false, providerRefId: null, executadoEm: null };
  return {
    existe: true,
    providerRefId: row.provider_ref_id ?? null,
    executadoEm: row.executado_em ?? null,
  };
}

/**
 * Decide se a criação pode prosseguir. Retorna `null` quando pode criar, ou um
 * resultado sintético (a diligência já existente) quando deve ser reaproveitada.
 */
export async function reaproveitarDiligencia(
  sb: MinimalSb,
  documento: string,
  horas = CREATE_COOLDOWN_HORAS,
): Promise<KYPDiligenciaResult | null> {
  const recente = await criacaoRecente(sb, documento, horas);
  if (!recente.existe) return null;
  return {
    providerRefId: recente.providerRefId ?? "",
    status: "pending",
    expiryDate: null,
    updatedAt: recente.executadoEm,
    raw: { reused: true, executado_em: recente.executadoEm },
  };
}
