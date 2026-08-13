// Cadeia de aprovação para documentos RATEADOS entre segmentos diferentes.
//
// Regra do negócio: quando as linhas de um mesmo documento pertencem a
// combinações distintas de (centro de custo, projeto), cada segmento tem a sua
// própria alçada na matriz. O documento só está aprovado quando TODAS as
// cadeias envolvidas aprovaram — então mesclamos as cadeias em uma única
// sequência, preservando a ordem relativa de cada uma e sem repetir a mesma
// pessoa (ex.: Marco Tulio, que fecha as duas ramificações, aprova uma vez só).
//
// Ex.: PC com 2 linhas no CC 1.10.2.2
//   • projeto DONALD  (R$ 3,3M) → Leonardo Rossini → Santiago Macedo → Marco Tulio
//   • projeto BET.BET (R$ 1,0M) → Diogo Faria → Marco Tulio
//   ⇒ cadeia mesclada: Leonardo → Diogo → Santiago → Marco
//     (o nível do Leonardo é pulado quando ele é o solicitante).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { findMatchingRule, pickHierarchicalFallbackRule, type RuleRow } from "./rule-match.ts";
import type { ApprovalLevel } from "./approval-skip.ts";
import { emailLocalPart, normalizeText } from "./text-normalize.ts";

export interface RateioItem {
  cost_center?: string | null;
  project?: string | null;
  line_total?: number | string | null;
}

export interface RateioChainContext {
  companyDb: string;
  docType: string;
  currency?: string | null;
  requesterName?: string | null;
  supplierName?: string | null;
  supplierCode?: string | null;
  headerCostCenter?: string | null;
  headerProject?: string | null;
  /** Tipo de rateio do documento (padrao/folha/imposto/reembolso/viagens). */
  rateioType?: string | null;
}

function approverKey(name: string | null, email: string | null): string {
  const e = normalizeText(email);
  if (e) return emailLocalPart(e) || e;
  return normalizeText(name);
}

async function levelsOf(admin: SupabaseClient, ruleId: string): Promise<ApprovalLevel[]> {
  const { data } = await admin
    .from("approval_rule_levels")
    .select("level_order, approver_name, approver_email")
    .eq("rule_id", ruleId)
    .order("level_order", { ascending: true });
  return ((data || []) as ApprovalLevel[]);
}

/**
 * Devolve a cadeia mesclada (níveis 1..N) quando o documento é rateado entre
 * segmentos com alçadas DIFERENTES. Retorna `null` quando não há rateio ou
 * quando todos os segmentos caem na mesma regra (fluxo normal de nível único).
 */
export async function buildRateioChain(
  admin: SupabaseClient,
  items: RateioItem[],
  ctx: RateioChainContext,
): Promise<ApprovalLevel[] | null> {
  const rows = (items || []).filter(Boolean);
  if (rows.length < 2 || !ctx.companyDb) return null;

  // Agrupa por (CC, projeto).
  const groups = new Map<string, { cc: string; project: string; amount: number }>();
  for (const it of rows) {
    const cc = String(it.cost_center || ctx.headerCostCenter || "").trim();
    const project = String(it.project || ctx.headerProject || "").trim();
    const key = `${cc.toLowerCase()}||${project.toLowerCase()}`;
    const prev = groups.get(key);
    const amount = Number(it.line_total || 0);
    if (prev) prev.amount += amount;
    else groups.set(key, { cc, project, amount });
  }
  if (groups.size < 2) return null;

  const { data: rulesRaw } = await admin
    .from("approval_rules")
    .select("id, name, is_active, priority, doc_type, criteria, company_db")
    .eq("company_db", ctx.companyDb)
    .eq("is_active", true);
  const rules = (rulesRaw || []) as unknown as RuleRow[];
  if (rules.length === 0) return null;

  const ordered = Array.from(groups.values()).sort((a, b) => b.amount - a.amount);
  const chains: Array<{ ruleId: string; levels: ApprovalLevel[] }> = [];
  for (const g of ordered) {
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
    };
    const match = findMatchingRule(rules, evalCtx, ctx.docType)
      || pickHierarchicalFallbackRule(rules, evalCtx, ctx.docType)?.rule
      || null;
    if (!match) return null; // segmento sem alçada → deixa o fluxo padrão tratar
    const lvls = (await levelsOf(admin, match.id)).filter((l) => l.approver_name || l.approver_email);
    if (lvls.length === 0) return null;
    chains.push({ ruleId: match.id, levels: lvls });
  }

  // Todas as ramificações na mesma regra → não é rateio de alçada.
  if (new Set(chains.map((c) => c.ruleId)).size < 2) return null;

  // Mescla: posição = maior índice em que a pessoa aparece nas cadeias.
  const merged = new Map<string, { name: string; email: string | null; pos: number; seen: number }>();
  let seen = 0;
  for (const chain of chains) {
    const distinct = Array.from(new Set(chain.levels.map((l) => l.level_order))).sort((a, b) => a - b);
    distinct.forEach((lo, idx) => {
      for (const row of chain.levels.filter((l) => l.level_order === lo)) {
        const key = approverKey(row.approver_name, row.approver_email);
        if (!key) continue;
        const prev = merged.get(key);
        if (prev) prev.pos = Math.max(prev.pos, idx);
        else merged.set(key, {
          name: row.approver_name || "",
          email: row.approver_email || null,
          pos: idx,
          seen: seen++,
        });
      }
    });
  }
  if (merged.size === 0) return null;

  return Array.from(merged.values())
    .sort((a, b) => (a.pos - b.pos) || (a.seen - b.seen))
    .map((a, i) => ({
      level_order: i + 1,
      approver_name: a.name,
      approver_email: a.email,
    }));
}
