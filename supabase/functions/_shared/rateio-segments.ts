// FLUXOS DE APROVAÇÃO INDEPENDENTES POR SEGMENTO (rateio).
//
// Regra do negócio: quando as linhas de um mesmo documento pertencem a
// combinações distintas de (centro de custo, projeto), CADA segmento segue a
// sua própria cadeia de alçada, de forma INDEPENDENTE e em paralelo.
// O documento só é aprovado quando TODOS os segmentos concluírem as suas
// cadeias. Não existe mescla de cadeias — se a mesma pessoa aparece em dois
// segmentos, ela aprova cada segmento no seu momento.
//
// Ex.: PC com 2 linhas no CC 1.10.2.2
//   • projeto DONALD  → Leonardo Rossini → Santiago Macedo → Marco Tulio
//   • projeto BET.BET → Diogo Faria → Marco Tulio
//   ⇒ dois fluxos paralelos; níveis cujo aprovador é o solicitante são pulados.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { findMatchingRule, pickHierarchicalFallbackRule, type RuleRow } from "./rule-match.ts";
import { pickApproverSkippingRequester, type ApprovalLevel } from "./approval-skip.ts";
import type { RateioItem, RateioChainContext } from "./rateio-chain.ts";

export type SegmentResolution = "direct" | "branch_fallback" | "rule_without_levels";

export interface RateioSegment {
  segment_key: string;
  cost_center: string;
  project: string;
  amount: number;
  rule_id: string;
  chain: ApprovalLevel[];
  /** Como a alçada foi resolvida: regra direta ou fallback hierárquico do ramo. */
  resolution: SegmentResolution;
  rule_name: string | null;
  /** Ramo do CC usado no fallback (ex.: "1.8" para o CC 1.8.1.8). */
  fallback_branch: string | null;
  /** Regra que casou originalmente mas não tinha níveis (CC bloqueado). */
  fallback_from_rule_id: string | null;
  fallback_from_rule_name: string | null;
  resolution_note: string | null;
}


export interface SegmentRow {
  id: string;
  expense_id: string;
  segment_key: string;
  cost_center: string | null;
  project: string | null;
  amount: number;
  rule_id: string | null;
  chain: ApprovalLevel[];
  current_level: number;
  status: string;
  current_approver: string | null;
  current_approver_email: string | null;
}

async function levelsOf(admin: SupabaseClient, ruleId: string): Promise<ApprovalLevel[]> {
  const { data } = await admin
    .from("approval_rule_levels")
    .select("level_order, approver_name, approver_email")
    .eq("rule_id", ruleId)
    .order("level_order", { ascending: true });
  return ((data || []) as ApprovalLevel[]).filter((l) => l.approver_name || l.approver_email);
}

/**
 * Calcula os segmentos (CC + projeto) do documento com a cadeia de cada um.
 * Retorna `null` quando não há rateio de alçada (um único segmento, ou todos
 * os segmentos caem na MESMA regra → fluxo normal de nível único).
 */
export async function buildRateioSegments(
  admin: SupabaseClient,
  items: RateioItem[],
  ctx: RateioChainContext,
  opts?: { allowSingle?: boolean },
): Promise<RateioSegment[] | null> {
  const allowSingle = opts?.allowSingle === true;
  const rows = (items || []).filter(Boolean);
  if (!ctx.companyDb) return null;
  if (!allowSingle && rows.length < 2) return null;

  const groups = new Map<string, { cc: string; project: string; amount: number }>();
  for (const it of rows) {
    const cc = String(it.cost_center || ctx.headerCostCenter || "").trim();
    const project = String(it.project || ctx.headerProject || "").trim();
    const key = `${cc.toLowerCase()}||${project.toLowerCase()}`;
    const amount = Number(it.line_total || 0);
    const prev = groups.get(key);
    if (prev) prev.amount += amount;
    else groups.set(key, { cc, project, amount });
  }
  if (!allowSingle && groups.size < 2) return null;

  const { data: rulesRaw } = await admin
    .from("approval_rules")
    .select("id, name, is_active, priority, doc_type, criteria, company_db")
    .eq("company_db", ctx.companyDb)
    .eq("is_active", true);
  const rules = (rulesRaw || []) as unknown as RuleRow[];
  if (rules.length === 0) return null;

  const ordered = Array.from(groups.entries()).sort((a, b) => b[1].amount - a[1].amount);
  const segments: RateioSegment[] = [];
  for (const [key, g] of ordered) {
    const evalCtx: Record<string, unknown> = {
      total_amount: g.amount,
      cost_center: g.cc,
      project: g.project,
      requester_name: ctx.requesterName || "",
      supplier_name: `${ctx.supplierName || ""} ${ctx.supplierCode || ""}`.trim(),
      "supplier.name": String(ctx.supplierName || "").toLowerCase(),
      "supplier.code": String(ctx.supplierCode || "").toLowerCase(),
      currency: ctx.currency || "BRL",
      doc_type: ctx.docType,
      rateio_type: String(ctx.rateioType || "padrao").toLowerCase(),
    };
    const direct = findMatchingRule(rules, evalCtx, ctx.docType);
    const hierMatch = pickHierarchicalFallbackRule(rules, evalCtx, ctx.docType);
    const hier = hierMatch?.rule || null;
    const match = direct || hier;
    if (!match) return null; // segmento sem alçada → fluxo padrão trata
    let ruleId = match.id;
    let ruleName = (match.name || "").trim() || null;
    let chain = await levelsOf(admin, ruleId);
    let resolution: SegmentResolution = direct ? "direct" : "branch_fallback";
    let fallbackFromRuleId: string | null = null;
    let fallbackFromRuleName: string | null = null;
    // Regra casada sem níveis (ex.: CC bloqueado): usa a alçada do ramo.
    if (chain.length === 0 && hier && hier.id !== ruleId) {
      fallbackFromRuleId = ruleId;
      fallbackFromRuleName = ruleName;
      ruleId = hier.id;
      ruleName = (hier.name || "").trim() || null;
      chain = await levelsOf(admin, ruleId);
      resolution = "rule_without_levels";
    }
    if (chain.length === 0) return null;

    const branch = resolution === "direct" ? null : (hierMatch?.matchedBranch || null);
    let note: string | null = null;
    if (resolution === "branch_fallback") {
      note = `O centro de custo ${g.cc || "(sem CC)"} não possui alçada própria cadastrada. Foi aplicada a alçada do ramo ${branch} (regra "${ruleName}"${hierMatch?.siblingCostCenter ? `, cadastrada no CC ${hierMatch.siblingCostCenter}` : ""}), compatível com o valor do segmento.`;
    } else if (resolution === "rule_without_levels") {
      note = `A regra "${fallbackFromRuleName}" casou com o centro de custo ${g.cc || "(sem CC)"}, mas não tem nenhum aprovador cadastrado (ex.: CC bloqueado). Para não travar o documento, foi aplicada a alçada do ramo ${branch} (regra "${ruleName}").`;
    }

    segments.push({
      segment_key: key,
      cost_center: g.cc,
      project: g.project,
      amount: g.amount,
      rule_id: ruleId,
      chain,
      resolution,
      rule_name: ruleName,
      fallback_branch: branch,
      fallback_from_rule_id: fallbackFromRuleId,
      fallback_from_rule_name: fallbackFromRuleName,
      resolution_note: note,
    });

  }

  // Todos os segmentos na mesma regra → não é rateio de alçada.
  if (!allowSingle && new Set(segments.map((s) => s.rule_id)).size < 2) return null;
  return segments;
}

/** Rótulo do aprovador atual do documento = aprovadores pendentes de cada segmento. */
export function pendingApproverLabel(rows: Array<{ status: string; current_approver: string | null }>): string | null {
  const names = Array.from(new Set(
    rows.filter((r) => r.status === "pendente").map((r) => (r.current_approver || "").trim()).filter(Boolean),
  ));
  return names.length ? names.join(" / ") : null;
}

/**
 * Persiste os segmentos do documento (substituindo os anteriores), já
 * posicionando cada um no primeiro nível cujo aprovador não é o solicitante.
 */
export async function persistRateioSegments(
  admin: SupabaseClient,
  expenseId: string,
  segments: RateioSegment[],
  requesterName: string | null,
  requesterEmail: string | null,
): Promise<SegmentRow[]> {
  await admin.from("expense_approval_segments").delete().eq("expense_id", expenseId);

  const payload = segments.map((s) => {
    const picked = pickApproverSkippingRequester(s.chain, requesterName, requesterEmail, 1);
    return {
      expense_id: expenseId,
      segment_key: s.segment_key,
      cost_center: s.cost_center || null,
      project: s.project || null,
      amount: s.amount,
      rule_id: s.rule_id,
      chain: s.chain,
      current_level: picked.level_order,
      status: "pendente",
      current_approver: picked.approver_name || null,
      current_approver_email: picked.approver_email,
      resolution: s.resolution || "direct",
      rule_name: s.rule_name || null,
      fallback_branch: s.fallback_branch || null,
      fallback_from_rule_id: s.fallback_from_rule_id || null,
      fallback_from_rule_name: s.fallback_from_rule_name || null,
      resolution_note: s.resolution_note || null,
    };
  });

  const { data } = await admin.from("expense_approval_segments").insert(payload).select("*");

  // Registra no histórico do documento cada segmento resolvido por fallback.
  const fallbacks = segments.filter((s) => s.resolution && s.resolution !== "direct");
  if (fallbacks.length > 0) {
    await admin.from("expense_approval_log").insert(
      fallbacks.map((s) => ({
        expense_id: expenseId,
        decision: "routing_fallback",
        approver_name: pickApproverSkippingRequester(s.chain, requesterName, requesterEmail, 1).approver_name || null,
        approver_email: pickApproverSkippingRequester(s.chain, requesterName, requesterEmail, 1).approver_email,
        remarks: [
          `Segmento ${s.cost_center || "sem CC"}${s.project ? ` | ${s.project}` : ""}`,
          s.resolution_note,
        ].filter(Boolean).join(" — "),
      })),
    );
  }

  return ((data || []) as unknown as SegmentRow[]);
}


/** Carrega os segmentos de um documento. */
export async function loadRateioSegments(
  admin: SupabaseClient,
  expenseId: string,
): Promise<SegmentRow[]> {
  const { data } = await admin
    .from("expense_approval_segments")
    .select("*")
    .eq("expense_id", expenseId);
  return ((data || []) as unknown as SegmentRow[]);
}

/**
 * Avança um segmento para o próximo nível DISTINTO da sua cadeia, pulando
 * níveis cujo aprovador é o solicitante. Devolve o estado resultante.
 */
export function advanceSegment(
  seg: SegmentRow,
  requesterName: string | null,
  requesterEmail: string | null,
): { status: string; current_level: number; current_approver: string | null; current_approver_email: string | null; finished: boolean } {
  const chain = (seg.chain || []) as ApprovalLevel[];
  const distinct = Array.from(new Set(chain.map((l) => l.level_order))).sort((a, b) => a - b);
  const next = distinct.find((lo) => lo > Number(seg.current_level));
  if (!next) {
    return {
      status: "aprovado",
      current_level: Number(seg.current_level),
      current_approver: null,
      current_approver_email: null,
      finished: true,
    };
  }
  const picked = pickApproverSkippingRequester(chain, requesterName, requesterEmail, next);
  // Quando todos os níveis restantes eram do solicitante, o helper devolve o
  // fallback global — nesse caso o segmento continua pendente com ele.
  return {
    status: "pendente",
    current_level: picked.level_order,
    current_approver: picked.approver_name || null,
    current_approver_email: picked.approver_email,
    finished: false,
  };
}

/**
 * Regenera APENAS os segmentos informados (ex.: um único centro de custo),
 * preservando as demais trilhas do documento e seus históricos de aprovação.
 */
export async function persistSegmentSubset(
  admin: SupabaseClient,
  expenseId: string,
  segments: RateioSegment[],
  requesterName: string | null,
  requesterEmail: string | null,
): Promise<SegmentRow[]> {
  if (segments.length === 0) return [];
  const keys = segments.map((s) => s.segment_key);
  await admin
    .from("expense_approval_segments")
    .delete()
    .eq("expense_id", expenseId)
    .in("segment_key", keys);

  const payload = segments.map((s) => {
    const picked = pickApproverSkippingRequester(s.chain, requesterName, requesterEmail, 1);
    return {
      expense_id: expenseId,
      segment_key: s.segment_key,
      cost_center: s.cost_center || null,
      project: s.project || null,
      amount: s.amount,
      rule_id: s.rule_id,
      chain: s.chain,
      current_level: picked.level_order,
      status: "pendente",
      current_approver: picked.approver_name || null,
      current_approver_email: picked.approver_email,
      resolution: s.resolution || "direct",
      rule_name: s.rule_name || null,
      fallback_branch: s.fallback_branch || null,
      fallback_from_rule_id: s.fallback_from_rule_id || null,
      fallback_from_rule_name: s.fallback_from_rule_name || null,
      resolution_note: s.resolution_note || null,
    };
  });

  const { data } = await admin.from("expense_approval_segments").insert(payload).select("*");

  const logs = segments.map((s) => {
    const picked = pickApproverSkippingRequester(s.chain, requesterName, requesterEmail, 1);
    return {
      expense_id: expenseId,
      decision: "routing_fallback",
      approver_name: picked.approver_name || null,
      approver_email: picked.approver_email,
      remarks: [
        `Trilha reprocessada — segmento ${s.cost_center || "sem CC"}${s.project ? ` | ${s.project}` : ""}`,
        s.resolution_note,
      ].filter(Boolean).join(" — "),
    };
  });
  if (logs.length > 0) await admin.from("expense_approval_log").insert(logs);

  return ((data || []) as unknown as SegmentRow[]);
}

/**
 * REEMBOLSO — trilha PARALELA.
 *
 * Diferente dos demais tipos de rateio (folha/imposto/viagens), que forçam uma
 * regra ÚNICA em substituição à matriz, o reembolso é ADICIONAL: o documento
 * segue a alçada padrão (por CC + projeto) E, em paralelo, a alçada de
 * reembolso. O documento só é aprovado quando as duas trilhas concluírem.
 */
export async function buildReembolsoSegments(
  admin: SupabaseClient,
  items: RateioItem[],
  ctx: RateioChainContext,
): Promise<RateioSegment[] | null> {
  if (!ctx.companyDb) return null;

  // 1) Trilhas padrão da matriz — avaliadas como se não houvesse tipo de rateio.
  const standard = await buildRateioSegments(
    admin,
    items,
    { ...ctx, rateioType: "padrao" },
    { allowSingle: true },
  );

  // 2) Trilha específica de reembolso (regras que usam o critério rateio_type).
  const { data: rulesRaw } = await admin
    .from("approval_rules")
    .select("id, name, is_active, priority, doc_type, criteria, company_db")
    .eq("company_db", ctx.companyDb)
    .eq("is_active", true);
  const reembolsoRules = ((rulesRaw || []) as unknown as RuleRow[]).filter((r) =>
    Array.isArray(r.criteria) &&
    (r.criteria as Array<{ field?: string }>).some((c) => c?.field === "rateio_type")
  );

  const total = (items || []).reduce((s, it) => s + Number(it?.line_total || 0), 0);
  const headerCc = String(ctx.headerCostCenter || items?.[0]?.cost_center || "").trim();
  const headerProject = String(ctx.headerProject || items?.[0]?.project || "").trim();

  const evalCtx: Record<string, unknown> = {
    total_amount: total,
    cost_center: headerCc,
    project: headerProject,
    requester_name: ctx.requesterName || "",
    supplier_name: `${ctx.supplierName || ""} ${ctx.supplierCode || ""}`.trim(),
    "supplier.name": String(ctx.supplierName || "").toLowerCase(),
    "supplier.code": String(ctx.supplierCode || "").toLowerCase(),
    currency: ctx.currency || "BRL",
    doc_type: ctx.docType,
    rateio_type: "reembolso",
  };

  const match = findMatchingRule(reembolsoRules, evalCtx, ctx.docType);
  if (!match) return standard;
  const chain = await levelsOf(admin, match.id);
  if (chain.length === 0) return standard;

  const reembolso: RateioSegment = {
    segment_key: "__reembolso__",
    cost_center: headerCc,
    project: headerProject,
    amount: total,
    rule_id: match.id,
    chain,
    resolution: "direct",
    rule_name: (match.name || "").trim() || "Reembolso",
    fallback_branch: null,
    fallback_from_rule_id: null,
    fallback_from_rule_name: null,
    resolution_note:
      `Trilha paralela de reembolso (regra "${(match.name || "Reembolso").trim()}") — corre junto com a alçada padrão do documento.`,
  };

  return [...(standard || []), reembolso];
}
