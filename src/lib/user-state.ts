/**
 * Modelo de estado unificado do usuário (Acesso & Usuários).
 *
 * O estado de um usuário NÃO é binário. Cada dimensão abaixo é independente e
 * a UI deriva daí um conjunto de chips de atributo + um conjunto de alertas.
 */

export type IdpLinkState = "linked" | "none" | "removed" | "suspended";

export interface UserStateInput {
  /** Acesso ao ERP (usuário SAP bloqueado). */
  locked: boolean;
  /** Existe usuário SAP vinculado na empresa atual. */
  sapLinked: boolean;
  /** Estado do vínculo com o IdP (JumpCloud/Okta). */
  idp: IdpLinkState;
  /** Admin do backoffice (Lovable Cloud / auth). */
  isAdmin: boolean;
  /** Licença atribuída no controle de licenças. */
  hasLicense: boolean;
  /** Grupo de permissão global (null = sem grupo). */
  groupName: string | null;
  /** Enforcement de vínculo de identidade ligado na empresa. */
  idpEnforcement?: boolean;
}

export type AlertSeverity = "critical" | "warning";

export interface UserAlert {
  key: string;
  severity: AlertSeverity;
  label: string;
  hint: string;
}

export const IDP_STATE_LABEL: Record<IdpLinkState, string> = {
  linked: "IdP vinculado",
  none: "Sem vínculo IdP",
  removed: "Removido no IdP",
  suspended: "Suspenso no IdP",
};

/** Alertas derivados — ordenados por severidade (crítico primeiro). */
export function deriveUserAlerts(input: UserStateInput): UserAlert[] {
  const alerts: UserAlert[] = [];

  if (!input.locked && (input.idp === "removed" || input.idp === "suspended")) {
    alerts.push({
      key: "idp-divergence",
      severity: "critical",
      label: "Ativo no ERP + removido no IdP",
      hint: "O usuário foi removido/suspenso no IdP mas continua com acesso ao ERP. Resolva em Sincronização IdP.",
    });
  }
  if (!input.locked && !input.groupName) {
    alerts.push({
      key: "no-group",
      severity: "warning",
      label: "Sem grupo de permissão",
      hint: "Usuário ativo sem grupo herda apenas o acesso padrão (despesas).",
    });
  }
  if (!input.locked && !input.hasLicense) {
    alerts.push({
      key: "no-license",
      severity: "warning",
      label: "Sem licença",
      hint: "Usuário ativo sem licença atribuída no controle de licenças.",
    });
  }
  if (input.idpEnforcement && input.sapLinked && input.idp === "none") {
    alerts.push({
      key: "sap-without-idp",
      severity: "warning",
      label: "SAP sem vínculo IdP",
      hint: "O enforcement de identidade está ligado: vincule o usuário ao IdP.",
    });
  }

  return alerts;
}

/** Peso de ordenação para o segmento "Divergências IdP". */
export function alertSeverityScore(alerts: UserAlert[]): number {
  let score = 0;
  for (const a of alerts) score += a.severity === "critical" ? 100 : 10;
  return score;
}
