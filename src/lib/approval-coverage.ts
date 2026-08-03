/**
 * Varredura de cobertura da matriz de alçadas.
 *
 * Objetivo: apontar centros de custo, projetos e faixas de valor que NÃO têm
 * regra ativa — ou seja, um documento naquele cenário cairia no fallback
 * hierárquico (aprovador do ramo) ou, pior, no aprovador padrão de contingência.
 *
 * Puro e testável: recebe o universo (CCs/projetos observados) e as regras,
 * devolve as lacunas. A UI só apresenta.
 */

import { findMatchingRule } from "@/lib/approvalSegments";
import { pickHierarchicalFallbackRule } from "@/lib/approval-fallback";
import type { ApprovalRule, RuleDocType } from "@/hooks/useApprovalRules";

/** Faixas de valor testadas (limite superior representativo de cada faixa). */
export const DEFAULT_VALUE_BANDS: { label: string; amount: number }[] = [
  { label: "até 5k", amount: 4_999 },
  { label: "5k–30k", amount: 29_999 },
  { label: "30k–100k", amount: 99_999 },
  { label: "100k–300k", amount: 299_999 },
  { label: "300k–1M", amount: 999_999 },
  { label: "acima de 1M", amount: 3_000_000 },
];

export type GapSeverity = "critical" | "warning";

export interface CoverageGap {
  key: string;
  costCenter: string;
  project: string | null;
  docType: RuleDocType;
  /** Faixas de valor sem regra ativa. */
  bands: string[];
  severity: GapSeverity;
  /** Regra "irmã" do ramo que absorveria o documento, quando existir. */
  fallbackRuleName: string | null;
  fallbackBranch: string | null;
  /** Nº de documentos observados nesse CC/projeto (prioriza a correção). */
  docCount: number;
}

export interface CoverageScope {
  /** Combinações reais observadas nos documentos. */
  combos: { costCenter: string; project: string | null; docCount: number }[];
  docTypes: RuleDocType[];
  bands?: { label: string; amount: number }[];
}

export interface CoverageResult {
  gaps: CoverageGap[];
  scanned: number;
  covered: number;
  critical: number;
  warning: number;
  scannedAt: string;
}

export function scanCoverage(rules: ApprovalRule[], scope: CoverageScope): CoverageResult {
  const bands = scope.bands?.length ? scope.bands : DEFAULT_VALUE_BANDS;
  const docTypes = scope.docTypes.length ? scope.docTypes : (["purchase"] as RuleDocType[]);
  const gaps: CoverageGap[] = [];
  let scanned = 0;
  let covered = 0;

  for (const combo of scope.combos) {
    for (const docType of docTypes) {
      const missing: string[] = [];
      let fallbackRuleName: string | null = null;
      let fallbackBranch: string | null = null;

      for (const band of bands) {
        scanned++;
        const ctx: Record<string, unknown> = {
          total_amount: band.amount,
          cost_center: combo.costCenter,
          project: combo.project ?? "",
          doc_type: docType,
        };
        const rule = findMatchingRule(rules, ctx, docType);
        if (rule) {
          covered++;
          continue;
        }
        missing.push(band.label);
        if (!fallbackRuleName) {
          const fb = pickHierarchicalFallbackRule(rules, ctx, docType);
          if (fb) {
            fallbackRuleName = fb.rule.name;
            fallbackBranch = fb.matchedBranch;
          }
        }
      }

      if (missing.length > 0) {
        gaps.push({
          key: `${combo.costCenter}|${combo.project ?? ""}|${docType}`,
          costCenter: combo.costCenter,
          project: combo.project,
          docType,
          bands: missing,
          severity: fallbackRuleName ? "warning" : "critical",
          fallbackRuleName,
          fallbackBranch,
          docCount: combo.docCount,
        });
      }
    }
  }

  gaps.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    if (b.docCount !== a.docCount) return b.docCount - a.docCount;
    return a.costCenter.localeCompare(b.costCenter);
  });

  return {
    gaps,
    scanned,
    covered,
    critical: gaps.filter((g) => g.severity === "critical").length,
    warning: gaps.filter((g) => g.severity === "warning").length,
    scannedAt: new Date().toISOString(),
  };
}

export function coverageToCsv(gaps: CoverageGap[]): string {
  const head = [
    "Centro de custo",
    "Projeto",
    "Tipo de documento",
    "Faixas sem regra",
    "Criticidade",
    "Fallback do ramo",
    "Ramo",
    "Documentos observados",
  ];
  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = gaps.map((g) =>
    [
      g.costCenter,
      g.project ?? "",
      g.docType === "sales" ? "Venda" : "Compra",
      g.bands.join(" | "),
      g.severity === "critical" ? "Crítico (contingência)" : "Atenção (fallback do ramo)",
      g.fallbackRuleName ?? "",
      g.fallbackBranch ?? "",
      String(g.docCount),
    ]
      .map(esc)
      .join(","),
  );
  return [head.map(esc).join(","), ...lines].join("\n");
}
