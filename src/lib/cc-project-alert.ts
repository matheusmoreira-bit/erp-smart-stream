import { supabase } from "@/integrations/supabase/client";
import { normalizeUpper } from "@/lib/text-normalize";

/**
 * Alerta de casamento entre Centro de Custo e Projeto (pedidos de compra).
 *
 * Regra: o alerta é disparado SOMENTE quando um centro de custo institucional
 * (1.8.%, 1.9.%, 1.10.%, 1.11.%, 1.14.%) é combinado com um projeto que tem o
 * nome da empresa (institucional/corporativo). CC sem projeto não dispara nada.
 */
export const CC_ALERT_PREFIXES = [
  "1.8.",
  "1.9.",
  "1.10.",
  "1.11.",
  "1.14.",
];


/** Projetos institucionais/corporativos (nome ou código no SAP). */
export const INSTITUTIONAL_PROJECTS = [
  "ANA GAMING",
  "CACTUS",
  "OPEN GAMIN",
  "OPEN GAMING",
  "INSTITUTO CACTUS",
  "CACTUS PROVIDERS",
];

export function normalizeText(v: string): string {
  return normalizeUpper(v);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  return 1 - levenshtein(a, b) / max;
}

/** Tolerante a erros de digitação nos nomes dos projetos no SAP. */
export function isInstitutionalProject(codeOrName?: string | null): boolean {
  const value = normalizeText(codeOrName || "");
  if (!value) return false;
  return INSTITUTIONAL_PROJECTS.some((ref) => {
    const r = normalizeText(ref);
    if (value === r) return true;
    if (value.includes(r) || r.includes(value)) return true;
    return similarity(value, r) >= 0.82;
  });
}

export function costCenterNeedsAlert(code?: string | null): boolean {
  const c = (code || "").trim();
  if (!c) return false;
  return CC_ALERT_PREFIXES.some((p) => c.startsWith(p));
}

/**
 * Único gatilho válido do alerta: CC institucional + projeto institucional
 * (nome da empresa). Sem projeto selecionado → nunca alerta.
 */
export function shouldAlertCcProject(
  costCenterCode?: string | null,
  projectCodeOrName?: string | null,
  projectAlt?: string | null,
): boolean {
  if (!costCenterNeedsAlert(costCenterCode)) return false;
  const project = (projectCodeOrName || projectAlt || "").trim();
  if (!project) return false;
  return isInstitutionalProject(projectCodeOrName) || isInstitutionalProject(projectAlt);
}


export interface CcProjectAlertPayload {
  companyDb?: string | null;
  sapUserName?: string | null;
  lineIndex: number;
  costCenterCode: string;
  costCenterName?: string | null;
  projectCode?: string | null;
  projectName?: string | null;
}

/** Registra o alerta exibido (decision = 'pending'). Retorna o id do registro. */
export async function logCcProjectAlert(
  payload: CcProjectAlertPayload,
): Promise<string | null> {
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) return null;
    const { data, error } = await supabase
      .from("cc_project_alerts")
      .insert({
        user_id: user.id,
        user_email: user.email ?? null,
        sap_user_name: payload.sapUserName ?? null,
        company_db: payload.companyDb ?? null,
        line_index: payload.lineIndex,
        cost_center_code: payload.costCenterCode,
        cost_center_name: payload.costCenterName ?? null,
        project_code_at_alert: payload.projectCode ?? null,
        project_name_at_alert: payload.projectName ?? null,
        is_institutional_project: isInstitutionalProject(
          payload.projectName || payload.projectCode,
        ),
        decision: "pending",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data?.id ?? null;
  } catch {
    return null;
  }
}

/** Grava a decisão do usuário no alerta previamente registrado. */
export async function recordCcProjectAlertDecision(
  alertId: string | null,
  decision: "confirmed" | "changed",
  finalProjectCode?: string | null,
): Promise<void> {
  if (!alertId) return;
  try {
    await supabase
      .from("cc_project_alerts")
      .update({ decision, final_project_code: finalProjectCode ?? null })
      .eq("id", alertId);
  } catch {
    // auditoria nunca deve bloquear o fluxo principal
  }
}
