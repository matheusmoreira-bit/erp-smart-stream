// Desprovisionamento automático via IdP (JumpCloud/Okta).
//
// Quando o usuário é suspenso/removido no provedor de identidade, a MESMA
// sincronização revoga tudo que dá acesso ou poder de decisão no ERP Flow:
//   • vínculo de identidade  → marcado como desprovisionado (corta a sessão)
//   • grupos de permissão    → removidos (acessos e visibilidade)
//   • substituições vigentes → encerradas (como titular e como substituto)
//   • credenciais SAP salvas → apagadas (desfaz o provisionamento de senha)
//   • centros de custo do aprovador → removidos (alçada)
//   • dispositivos com push  → removidos
//   • licença                → marcada como bloqueada/sem licença
//   • regras de aprovação em que ele figura → sinalizadas para reatribuição
//
// Nada aqui lança exceção para o fluxo de sincronização: cada etapa é
// best-effort e o resultado (inclusive erros) fica registrado em
// `public.idp_deprovision_log` para auditoria.
// deno-lint-ignore-file no-explicit-any

export interface DeprovisionTarget {
  mappingId?: string | null;
  companyDb?: string | null;
  idpProvider?: string | null;
  idpUserId?: string | null;
  sapUserCode?: string | null;
  email?: string | null;
  /** Motivo legível (ex.: "suspenso no JumpCloud"). */
  reason: string;
  /** Origem do evento (ex.: "jumpcloud_sap_sync"). */
  source?: string;
  /** O bloqueio do usuário no SAP funcionou? Apenas informativo no log. */
  sapLocked?: boolean;
}

export interface DeprovisionResult {
  userKey: string;
  groupsRevoked: number;
  substitutionsRevoked: number;
  credentialsRevoked: number;
  pushDevicesRevoked: number;
  costCentersRevoked: number;
  approvalRulesOrphaned: number;
  orphanRules: Array<{ ruleId: string; ruleName: string; levelOrder: number }>;
  errors: string[];
}

/** Mesma normalização de `public.canonical_user_key` (login sem sufixos .ext). */
export { canonicalUserKey } from "./text-normalize.ts";

function sameUser(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = canonicalUserKey(a);
  const kb = canonicalUserKey(b);
  return !!ka && ka === kb;
}

/**
 * Revoga acessos, alçadas e substituições de um usuário desligado no IdP.
 * Best-effort: nunca lança; devolve o que foi revogado e os erros.
 */
export async function deprovisionUser(admin: any, target: DeprovisionTarget): Promise<DeprovisionResult> {
  const res: DeprovisionResult = {
    userKey: canonicalUserKey(target.sapUserCode || target.email),
    groupsRevoked: 0,
    substitutionsRevoked: 0,
    credentialsRevoked: 0,
    pushDevicesRevoked: 0,
    costCentersRevoked: 0,
    approvalRulesOrphaned: 0,
    orphanRules: [],
    errors: [],
  };
  const now = new Date().toISOString();
  const step = async (label: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { res.errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); }
  };
  if (!res.userKey) {
    res.errors.push("identificador do usuário vazio — nada a revogar");
    return res;
  }

  // ── 1. Vínculo de identidade: corta sessões e marca o desligamento ──────
  await step("idp_user_mapping", async () => {
    let q = admin
      .from("idp_user_mapping")
      .update({
        status: "disabled_by_idp",
        deprovisioned_at: now,
        deprovision_reason: target.reason,
        updated_at: now,
      });
    q = target.mappingId ? q.eq("id", target.mappingId) : q.eq("sap_user_code", target.sapUserCode || "");
    const { error } = await q;
    if (error) throw new Error(error.message);
  });

  // ── 2. Grupos de permissão (acessos e visibilidade) ─────────────────────
  await step("user_group_assignments", async () => {
    const { data } = await admin.from("user_group_assignments").select("id, sap_email");
    const ids = (data || []).filter((r: any) => sameUser(r.sap_email, res.userKey)).map((r: any) => r.id);
    if (!ids.length) return;
    const { error } = await admin.from("user_group_assignments").delete().in("id", ids);
    if (error) throw new Error(error.message);
    res.groupsRevoked = ids.length;
  });

  // ── 3. Substituições vigentes (como titular e como substituto) ──────────
  await step("approver_substitutes", async () => {
    const { data } = await admin
      .from("approver_substitutes")
      .select("id, official_email, substitute_email, revoked_at, ends_at");
    const ids = (data || [])
      .filter((r: any) => !r.revoked_at && (sameUser(r.official_email, res.userKey) || sameUser(r.substitute_email, res.userKey)))
      .map((r: any) => r.id);
    if (!ids.length) return;
    const { error } = await admin
      .from("approver_substitutes")
      .update({
        revoked_at: now,
        ends_at: now,
        revoked_reason: `Desprovisionamento automático via IdP — ${target.reason}`,
        updated_at: now,
      })
      .in("id", ids);
    if (error) throw new Error(error.message);
    res.substitutionsRevoked = ids.length;
  });

  // ── 4. Credenciais SAP provisionadas ────────────────────────────────────
  await step("user_sap_credentials", async () => {
    const { data } = await admin.from("user_sap_credentials").select("id, sap_user");
    const ids = (data || []).filter((r: any) => sameUser(r.sap_user, res.userKey)).map((r: any) => r.id);
    if (!ids.length) return;
    const { error } = await admin.from("user_sap_credentials").delete().in("id", ids);
    if (error) throw new Error(error.message);
    res.credentialsRevoked = ids.length;
  });

  // ── 5. Centros de custo do aprovador (alçada) ───────────────────────────
  await step("approver_cost_centers", async () => {
    const { data } = await admin.from("approver_cost_centers").select("id, sap_email");
    const ids = (data || []).filter((r: any) => sameUser(r.sap_email, res.userKey)).map((r: any) => r.id);
    if (!ids.length) return;
    const { error } = await admin.from("approver_cost_centers").delete().in("id", ids);
    if (error) throw new Error(error.message);
    res.costCentersRevoked = ids.length;
  });

  // ── 6. Dispositivos com push ────────────────────────────────────────────
  await step("push_subscriptions", async () => {
    const { data } = await admin.from("push_subscriptions").select("id, user_identifier, email");
    const ids = (data || [])
      .filter((r: any) => sameUser(r.user_identifier, res.userKey) || sameUser(r.email, res.userKey))
      .map((r: any) => r.id);
    if (!ids.length) return;
    const { error } = await admin.from("push_subscriptions").delete().in("id", ids);
    if (error) throw new Error(error.message);
    res.pushDevicesRevoked = ids.length;
  });

  // ── 7. Licença: marca como bloqueada/sem licença ────────────────────────
  await step("user_licenses", async () => {
    const { data } = await admin.from("user_licenses").select("id, user_code");
    const ids = (data || []).filter((r: any) => sameUser(r.user_code, res.userKey)).map((r: any) => r.id);
    if (!ids.length) return;
    await admin
      .from("user_licenses")
      .update({
        is_locked: true,
        has_license: false,
        notes: `Desprovisionado via IdP em ${now} — ${target.reason}`,
        updated_at: now,
      })
      .in("id", ids);
  });

  // ── 8. Regras de aprovação: sinaliza (não apaga) para reatribuição ──────
  await step("approval_rules", async () => {
    let q = admin
      .from("approval_rule_levels")
      .select("id, rule_id, level_order, approver_email, approval_rules!inner(id, name, is_active, company_db)");
    if (target.companyDb) q = q.eq("approval_rules.company_db", target.companyDb);
    const { data } = await q;
    const hits = (data || []).filter(
      (r: any) => sameUser(r.approver_email, res.userKey) && r.approval_rules?.is_active !== false,
    );
    res.approvalRulesOrphaned = hits.length;
    res.orphanRules = hits.map((r: any) => ({
      ruleId: r.rule_id,
      ruleName: r.approval_rules?.name || r.rule_id,
      levelOrder: r.level_order,
    }));
  });

  return res;
}

/** Registra o evento e avisa os administradores (best-effort). */
export async function logDeprovision(
  admin: any,
  target: DeprovisionTarget,
  res: DeprovisionResult,
): Promise<void> {
  try {
    await admin.from("idp_deprovision_log").insert({
      company_db: target.companyDb || null,
      idp_provider: target.idpProvider || null,
      idp_user_id: target.idpUserId || null,
      sap_user_code: target.sapUserCode || null,
      email: target.email || null,
      user_key: res.userKey,
      reason: target.reason,
      source: target.source || "idp_sync",
      sap_locked: !!target.sapLocked,
      groups_revoked: res.groupsRevoked,
      substitutions_revoked: res.substitutionsRevoked,
      credentials_revoked: res.credentialsRevoked,
      push_devices_revoked: res.pushDevicesRevoked,
      cost_centers_revoked: res.costCentersRevoked,
      approval_rules_orphaned: res.approvalRulesOrphaned,
      details: { orphan_rules: res.orphanRules },
      errors: res.errors,
    });
  } catch (e) {
    console.warn("[idp-deprovision] falha ao gravar log:", e instanceof Error ? e.message : String(e));
  }

  // Aviso para o time de administração quando o desligado ainda é aprovador
  // em regras ativas — a matriz precisa de reatribuição manual.
  if (res.approvalRulesOrphaned === 0) return;
  try {
    const { data: admins } = await admin
      .from("user_group_assignments")
      .select("sap_email, permission_groups!inner(name)")
      .ilike("permission_groups.name", "%admin%");
    const recipients = new Set<string>();
    for (const a of admins || []) {
      const ident = canonicalUserKey((a as any).sap_email);
      if (ident) recipients.add(ident);
    }
    if (recipients.size === 0) return;
    const rulesTxt = res.orphanRules.map((r) => `${r.ruleName} (nível ${r.levelOrder})`).join("; ");
    await admin.from("notifications").insert(
      [...recipients].map((ident) => ({
        user_identifier: ident,
        company_db: target.companyDb || null,
        title: "Aprovador desligado no IdP — reatribuição necessária",
        body: `${target.sapUserCode || target.email} foi desprovisionado (${target.reason}) e ainda consta em regras ativas: ${rulesTxt}`,
        category: "security",
        link: "/regras-aprovacao",
        metadata: { ref_id: `deprov:${res.userKey}:${Date.now()}`, user_key: res.userKey },
      })),
    );
  } catch (e) {
    console.warn("[idp-deprovision] falha ao notificar admins:", e instanceof Error ? e.message : String(e));
  }
}
