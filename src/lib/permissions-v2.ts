import { supabase } from "@/integrations/supabase/client";

/**
 * Permissions v2 — runtime gate + shadow log.
 *
 * O motor v1 (usePermissions/useModuleAccess) continua entregando `can` para a UI.
 * O v2 é uma segunda camada que consulta `has_module_action` (que já cruza ERP Flow
 * global × grupos SAP da empresa). Em `shadow`, apenas registra o que negaria.
 * Em `enforce`, o cliente respeita o veredito do servidor.
 *
 * O RLS/edge functions permanecem a fonte final da verdade — este helper é apenas
 * para melhorar a experiência (esconder botões que não iriam funcionar) e para
 * gerar telemetria antes de virar chaves.
 */

export type PermissionMode = "off" | "shadow" | "enforce";
export type PermissionAction =
  | "view" | "create" | "edit" | "delete" | "approve" | "integrate" | "export";

export interface PermissionCheck {
  mode: PermissionMode;
  serverAllows: boolean;   // has_module_action(...)
  clientAllows: boolean;   // permissão v1 já concedida pela UI
  effectiveAllow: boolean; // resultado final aplicado à UI
  reason?: string;
}

const modeCache = new Map<string, { at: number; mode: PermissionMode }>();
const CACHE_TTL = 60_000;

export async function getEnforcementMode(companyDb?: string | null): Promise<PermissionMode> {
  const key = (companyDb ?? "__global__").toLowerCase();
  const cached = modeCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.mode;

  const { data, error } = await supabase.rpc("permissions_enforcement_mode", {
    _company_db: companyDb ?? null,
  });
  const mode = (error ? "shadow" : (data as PermissionMode)) ?? "shadow";
  modeCache.set(key, { at: Date.now(), mode });
  return mode;
}

export function invalidateEnforcementCache() {
  modeCache.clear();
}

/**
 * Retorna a decisão v2 já considerando o modo.
 * - off      → passa direto (usa apenas o v1).
 * - shadow   → server pode negar, mas UI aplica o v1 (loga negativa).
 * - enforce  → server manda (log de negativa também).
 */
export async function checkModuleAction(params: {
  userId: string | null;
  identifier: string | null;   // e-mail ou user_code SAP
  companyDb: string | null;
  module: string;
  action: PermissionAction;
  clientAllows: boolean;       // resultado do motor v1 (para telemetria)
}): Promise<PermissionCheck> {
  const { userId, identifier, companyDb, module, action, clientAllows } = params;

  const mode = await getEnforcementMode(companyDb);

  if (mode === "off" || !userId) {
    return { mode, serverAllows: clientAllows, clientAllows, effectiveAllow: clientAllows };
  }

  const { data, error } = await supabase.rpc("has_module_action", {
    _user_id: userId,
    _company_db: companyDb,
    _module: module,
    _action: action,
  });

  const serverAllows = Boolean(data) && !error;
  const effectiveAllow = mode === "enforce" ? serverAllows : clientAllows;

  if (!serverAllows) {
    // Log apenas quando o servidor negaria — reduz volume da tabela.
    void supabase.rpc("log_permission_shadow", {
      _company_db: companyDb,
      _module: module,
      _action: action,
      _decision: "deny",
      _mode: mode,
      _reason: error ? `rpc_error:${error.message}` : "server_deny",
      _identifier: identifier,
      _context: { clientAllows },
    });
  }

  return {
    mode,
    serverAllows,
    clientAllows,
    effectiveAllow,
    reason: !serverAllows ? "server_deny" : undefined,
  };
}
