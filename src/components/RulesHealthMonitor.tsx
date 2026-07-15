import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Loader2,
  RefreshCw,
  Shield,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import type { ApprovalRule, RuleCriterion, RuleDocType } from "@/hooks/useApprovalRules";
import { DOC_TYPE_LABELS } from "@/hooks/useApprovalRules";

/* ────────────────────────── Tipos internos ────────────────────────── */

interface ActiveCC {
  code: string;
  name?: string;
  sources: Set<"sap" | "approver">;
}

interface RuleDomain {
  rule: ApprovalRule;
  /** Se true, regra é genérica em CC (não restringe CC). */
  ccWildcard: boolean;
  /** Padrões usados para casar CCs. */
  ccPatterns: {
    op: "equal" | "like" | "contains" | "not_equal" | "not_contains";
    value: string;
  }[];
  /** True se a regra não restringe valor. */
  amountWildcard: boolean;
  amountMin: number;
  amountMax: number;
  docTypes: Set<RuleDocType>;
  hasProject: boolean;
  hasSupplier: boolean;
  hasItem: boolean;
}

const INF = Number.POSITIVE_INFINITY;

/* ────────────────────────── Utilitários ────────────────────────── */

function normCode(s: string): string {
  return (s || "").trim().toLowerCase();
}

function likeToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = escaped.replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${re}$`, "i");
}

function ruleMatchesCC(patterns: RuleDomain["ccPatterns"], cc: string): boolean {
  const target = normCode(cc);
  // Positive matches
  const positives = patterns.filter((p) => p.op !== "not_equal" && p.op !== "not_contains");
  const negatives = patterns.filter((p) => p.op === "not_equal" || p.op === "not_contains");
  if (positives.length === 0 && negatives.length === 0) return true;
  const anyPositive =
    positives.length === 0 ||
    positives.some((p) => {
      const v = normCode(p.value);
      if (!v) return false;
      if (p.op === "equal") return target === v;
      if (p.op === "contains") return target.includes(v);
      if (p.op === "like") {
        try {
          return likeToRegex(v).test(target);
        } catch {
          return false;
        }
      }
      return false;
    });
  if (!anyPositive) return false;
  const anyNegativeHit = negatives.some((p) => {
    const v = normCode(p.value);
    if (!v) return false;
    if (p.op === "not_equal") return target === v;
    if (p.op === "not_contains") return target.includes(v);
    return false;
  });
  return !anyNegativeHit;
}

function extractDomain(rule: ApprovalRule): RuleDomain {
  const criteria: RuleCriterion[] = Array.isArray(rule.criteria) ? rule.criteria : [];
  const ccPatterns: RuleDomain["ccPatterns"] = [];
  let amountMin = 0;
  let amountMax = INF;
  let amountWildcard = true;
  const docTypes = new Set<RuleDocType>();
  let hasProject = false;
  let hasSupplier = false;
  let hasItem = false;

  for (const c of criteria) {
    const f = c.field;
    if (f === "cost_center") {
      const op = c.operator;
      if (op === "equal" || op === "like" || op === "contains" || op === "not_equal" || op === "not_contains") {
        ccPatterns.push({ op, value: c.value });
      }
    } else if (f === "total_amount") {
      amountWildcard = false;
      const v = Number(c.value);
      const v2 = Number(c.value2);
      if (c.operator === "greater_than" && Number.isFinite(v)) amountMin = Math.max(amountMin, v);
      else if (c.operator === "less_than" && Number.isFinite(v)) amountMax = Math.min(amountMax, v);
      else if (c.operator === "between" && Number.isFinite(v) && Number.isFinite(v2)) {
        amountMin = Math.max(amountMin, Math.min(v, v2));
        amountMax = Math.min(amountMax, Math.max(v, v2));
      } else if (c.operator === "equal" && Number.isFinite(v)) {
        amountMin = Math.max(amountMin, v);
        amountMax = Math.min(amountMax, v);
      }
    } else if (f === "doc_type") {
      const val = c.value as RuleDocType;
      if (val) docTypes.add(val);
    } else if (f === "project") {
      hasProject = true;
    } else if (f.startsWith("supplier") || f === "supplier_name") {
      hasSupplier = true;
    } else if (f.startsWith("item") || f === "item_codes" || f === "item_groups") {
      hasItem = true;
    }
  }

  if (docTypes.size === 0) {
    const dt = (rule.doc_type as RuleDocType) || "both";
    docTypes.add(dt);
  }

  return {
    rule,
    ccWildcard: ccPatterns.length === 0,
    ccPatterns,
    amountWildcard,
    amountMin,
    amountMax,
    docTypes,
    hasProject,
    hasSupplier,
    hasItem,
  };
}

function docTypesIntersect(a: Set<RuleDocType>, b: Set<RuleDocType>): boolean {
  if (a.has("both") || b.has("both")) return true;
  for (const x of a) if (b.has(x)) return true;
  return false;
}

function amountRangesIntersect(a: RuleDomain, b: RuleDomain): boolean {
  const lo = Math.max(a.amountMin, b.amountMin);
  const hi = Math.min(a.amountMax, b.amountMax);
  return lo <= hi;
}

function ccDomainsIntersect(a: RuleDomain, b: RuleDomain, ccs: ActiveCC[]): string[] {
  const hits: string[] = [];
  if (a.ccWildcard && b.ccWildcard) return ["*"];
  const listA = a.ccWildcard ? ccs.map((c) => c.code) : ccs.map((c) => c.code).filter((c) => ruleMatchesCC(a.ccPatterns, c));
  const setA = new Set(listA);
  const listB = b.ccWildcard ? ccs.map((c) => c.code) : ccs.map((c) => c.code).filter((c) => ruleMatchesCC(b.ccPatterns, c));
  for (const c of listB) if (setA.has(c)) hits.push(c);
  return hits;
}

function fmtAmount(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);
}

/* ─────────── Análise de gaps de valor por CC ─────────── */

interface AmountGap {
  cc: string;
  ccName?: string;
  from: number;
  to: number;
}

function computeAmountGaps(ccs: ActiveCC[], domains: RuleDomain[]): AmountGap[] {
  const gaps: AmountGap[] = [];
  const activeDomains = domains.filter((d) => d.rule.is_active);
  for (const cc of ccs) {
    const covering = activeDomains.filter((d) => d.ccWildcard || ruleMatchesCC(d.ccPatterns, cc.code));
    if (covering.length === 0) continue; // já é gap total (tratado à parte)
    // Constrói intervalos [min, max]
    const intervals = covering
      .map((d) => [d.amountMin, d.amountMax] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    // Merge
    const merged: [number, number][] = [];
    for (const iv of intervals) {
      if (merged.length === 0 || iv[0] > merged[merged.length - 1][1]) {
        merged.push([iv[0], iv[1]]);
      } else {
        merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1]);
      }
    }
    // Gap se não cobre 0 ou se há buracos internos
    if (merged[0][0] > 0) {
      gaps.push({ cc: cc.code, ccName: cc.name, from: 0, to: merged[0][0] });
    }
    for (let i = 1; i < merged.length; i++) {
      if (merged[i][0] > merged[i - 1][1]) {
        gaps.push({ cc: cc.code, ccName: cc.name, from: merged[i - 1][1], to: merged[i][0] });
      }
    }
    // Não reportamos gap "após o teto" — assumimos que a última regra cobre até ∞ é comum.
    const last = merged[merged.length - 1];
    if (Number.isFinite(last[1])) {
      gaps.push({ cc: cc.code, ccName: cc.name, from: last[1], to: INF });
    }
  }
  return gaps;
}

/* ────────────────────────── Componente principal ────────────────────────── */

interface Props {
  rules: ApprovalRule[];
  isLoading?: boolean;
  onOpenRule?: (rule: ApprovalRule) => void;
}

export function RulesHealthMonitor({ rules, isLoading, onOpenRule }: Props) {
  const { session } = useSap();
  const companyDb = session?.companyDB || null;

  const [activeCCs, setActiveCCs] = useState<ActiveCC[]>([]);
  const [loadingCCs, setLoadingCCs] = useState(false);
  const [ccFilter, setCcFilter] = useState("");

  const loadCCs = async () => {
    if (!companyDb) return;
    setLoadingCCs(true);
    try {
      const map = new Map<string, ActiveCC>();
      const { data: cached } = await supabase
        .from("sap_cache")
        .select("data")
        .eq("cache_key", "cost_centers")
        .eq("company_db", companyDb)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cached?.data && Array.isArray(cached.data)) {
        for (const row of cached.data as Array<Record<string, unknown>>) {
          const code = String(row?.CenterCode ?? "").trim();
          if (!code || code.startsWith("Centr_")) continue;
          const name = String(row?.CenterName ?? "").trim() || undefined;
          if ((name || "").toLowerCase().startsWith("centro geral")) continue;
          const key = normCode(code);
          if (!map.has(key)) map.set(key, { code, name, sources: new Set(["sap"]) });
          else map.get(key)!.sources.add("sap");
        }
      }
      const { data: approver } = await supabase
        .from("approver_cost_centers")
        .select("cost_center, cost_center_name")
        .eq("company_db", companyDb);
      for (const row of approver || []) {
        const code = String(row.cost_center || "").trim();
        if (!code) continue;
        const name = row.cost_center_name || undefined;
        const key = normCode(code);
        if (!map.has(key)) map.set(key, { code, name, sources: new Set(["approver"]) });
        else map.get(key)!.sources.add("approver");
      }
      setActiveCCs(Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code)));
    } finally {
      setLoadingCCs(false);
    }
  };

  useEffect(() => {
    void loadCCs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyDb]);

  const domains = useMemo(() => rules.filter((r) => r.is_active).map(extractDomain), [rules]);

  /* ── 1. CCs sem cobertura ── */
  const uncoveredCCs = useMemo(() => {
    return activeCCs.filter((cc) => !domains.some((d) => d.ccWildcard || ruleMatchesCC(d.ccPatterns, cc.code)));
  }, [activeCCs, domains]);

  /* ── 2. CCs em regra que não existem/estão inativos ── */
  const orphanRuleCCs = useMemo(() => {
    const active = new Set(activeCCs.map((c) => normCode(c.code)));
    const out: { rule: ApprovalRule; value: string }[] = [];
    for (const d of domains) {
      for (const p of d.ccPatterns) {
        if (p.op !== "equal") continue; // só sinalizamos códigos exatos
        if (!p.value) continue;
        if (!active.has(normCode(p.value))) out.push({ rule: d.rule, value: p.value });
      }
    }
    return out;
  }, [domains, activeCCs]);

  /* ── 3. Gaps por faixa de valor ── */
  const amountGaps = useMemo(() => computeAmountGaps(activeCCs, domains), [activeCCs, domains]);

  /* ── 4. Regras sobrepostas ── */
  // Regras personalizadas (prioridade >= 9999) são fluxos pontuais que
  // intencionalmente sobrepõem outras regras — ignoramos no cruzamento.
  const CUSTOM_PRIORITY = 9999;
  const overlaps = useMemo(() => {
    const out: { a: ApprovalRule; b: ApprovalRule; ccs: string[]; sameProject: boolean }[] = [];
    const eligible = domains.filter((d) => (d.rule.priority || 0) < CUSTOM_PRIORITY);
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        const a = eligible[i];
        const b = eligible[j];
        // Mesma prioridade → indício mais forte de sobreposição real (não é resolvida por prioridade).
        if ((a.rule.priority || 0) !== (b.rule.priority || 0)) continue;
        if (!docTypesIntersect(a.docTypes, b.docTypes)) continue;
        if (!amountRangesIntersect(a, b)) continue;
        const ccs = ccDomainsIntersect(a, b, activeCCs);
        if (ccs.length === 0) continue;
        // Se ambas usam projeto/fornecedor/item, sinalizamos com nota "pode ser intencional".
        out.push({
          a: a.rule,
          b: b.rule,
          ccs,
          sameProject: a.hasProject && b.hasProject,
        });
      }
    }
    return out;
  }, [domains, activeCCs]);

  const filteredUncovered = useMemo(() => {
    const q = ccFilter.trim().toLowerCase();
    if (!q) return uncoveredCCs;
    return uncoveredCCs.filter(
      (c) => c.code.toLowerCase().includes(q) || (c.name || "").toLowerCase().includes(q),
    );
  }, [uncoveredCCs, ccFilter]);

  const totalIssues = uncoveredCCs.length + amountGaps.length + overlaps.length + orphanRuleCCs.length;

  return (
    <div className="space-y-4">
      {/* Header + KPIs */}
      <div className="glass-card p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">Saúde das regras de aprovação</p>
              <p className="text-xs text-muted-foreground">
                Cruzamento das regras ativas com {activeCCs.length} centros de custo ativos ({companyDb || "—"}).
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={loadCCs} disabled={loadingCCs} className="gap-1.5">
            {loadingCCs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Recarregar
          </Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          <Kpi
            icon={<XCircle className="w-4 h-4" />}
            label="CCs sem cobertura"
            value={uncoveredCCs.length}
            tone={uncoveredCCs.length ? "destructive" : "success"}
          />
          <Kpi
            icon={<TriangleAlert className="w-4 h-4" />}
            label="Gaps por valor"
            value={amountGaps.length}
            tone={amountGaps.length ? "warning" : "success"}
          />
          <Kpi
            icon={<Layers className="w-4 h-4" />}
            label="Sobreposições"
            value={overlaps.length}
            tone={overlaps.length ? "warning" : "success"}
          />
          <Kpi
            icon={<AlertTriangle className="w-4 h-4" />}
            label="CCs órfãos em regras"
            value={orphanRuleCCs.length}
            tone={orphanRuleCCs.length ? "warning" : "success"}
          />
        </div>

        {totalIssues === 0 && !isLoading && !loadingCCs && activeCCs.length > 0 && (
          <div className="mt-3 flex items-center gap-2 text-xs text-success">
            <CheckCircle2 className="w-4 h-4" /> Nenhum problema detectado nas regras ativas.
          </div>
        )}
      </div>

      {(isLoading || loadingCCs) && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      )}

      <Accordion type="multiple" defaultValue={["uncovered", "gaps", "overlaps", "orphans"]} className="space-y-2">
        {/* 1. CCs sem cobertura */}
        <AccordionItem value="uncovered" className="glass-card border-0">
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex items-center gap-2 text-sm">
              <XCircle className="w-4 h-4 text-destructive" />
              <span className="font-medium">Centros de custo sem regra ativa</span>
              <Badge variant="outline" className="ml-1">{uncoveredCCs.length}</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {uncoveredCCs.length === 0 ? (
              <p className="text-xs text-muted-foreground">Todos os CCs ativos têm ao menos uma regra ativa que os cobre.</p>
            ) : (
              <>
                <Input
                  placeholder="Filtrar CCs..."
                  value={ccFilter}
                  onChange={(e) => setCcFilter(e.target.value)}
                  className="h-8 text-xs mb-2 max-w-[280px]"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {filteredUncovered.map((c) => (
                    <div key={c.code} className="text-xs p-2 rounded-md border border-border/60 bg-muted/20">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold">{c.code}</span>
                        <Badge variant="outline" className="text-[9px] px-1 py-0">
                          {c.sources.has("sap") && c.sources.has("approver") ? "SAP+APR" : c.sources.has("sap") ? "SAP" : "APR"}
                        </Badge>
                      </div>
                      {c.name && <p className="text-muted-foreground truncate mt-0.5">{c.name}</p>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* 2. Gaps por valor */}
        <AccordionItem value="gaps" className="glass-card border-0">
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex items-center gap-2 text-sm">
              <TriangleAlert className="w-4 h-4 text-warning" />
              <span className="font-medium">Gaps por faixa de valor</span>
              <Badge variant="outline" className="ml-1">{amountGaps.length}</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {amountGaps.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum buraco de valor detectado nos CCs cobertos.</p>
            ) : (
              <div className="space-y-1.5">
                {amountGaps.slice(0, 200).map((g, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs p-2 rounded-md border border-border/60 bg-muted/20">
                    <span className="font-mono font-semibold min-w-[80px]">{g.cc}</span>
                    {g.ccName && <span className="text-muted-foreground truncate flex-1">{g.ccName}</span>}
                    <span className="font-mono text-warning">
                      {fmtAmount(g.from)} → {fmtAmount(g.to)}
                    </span>
                  </div>
                ))}
                {amountGaps.length > 200 && (
                  <p className="text-[10px] text-muted-foreground">+ {amountGaps.length - 200} outros</p>
                )}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* 3. Sobreposições */}
        <AccordionItem value="overlaps" className="glass-card border-0">
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex items-center gap-2 text-sm">
              <Layers className="w-4 h-4 text-warning" />
              <span className="font-medium">Regras sobrepostas (mesma prioridade)</span>
              <Badge variant="outline" className="ml-1">{overlaps.length}</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {overlaps.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma sobreposição encontrada entre regras de mesma prioridade.</p>
            ) : (
              <div className="space-y-2">
                {overlaps.map((o, i) => (
                  <div key={i} className="p-2 rounded-md border border-warning/30 bg-warning/5 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <button
                        onClick={() => onOpenRule?.(o.a)}
                        className="font-medium underline-offset-2 hover:underline text-left"
                      >
                        {o.a.name}
                      </button>
                      <span className="text-muted-foreground">×</span>
                      <button
                        onClick={() => onOpenRule?.(o.b)}
                        className="font-medium underline-offset-2 hover:underline text-left"
                      >
                        {o.b.name}
                      </button>
                      <Badge variant="outline" className="text-[9px]">prio {o.a.priority || 0}</Badge>
                    </div>
                    <p className="text-muted-foreground">
                      Compartilham {o.ccs.length === 1 && o.ccs[0] === "*" ? "todos os CCs" : `${o.ccs.length} CC(s)`}
                      {o.ccs.length > 0 && o.ccs[0] !== "*" && (
                        <span className="font-mono ml-1">
                          ({o.ccs.slice(0, 5).join(", ")}{o.ccs.length > 5 ? ` +${o.ccs.length - 5}` : ""})
                        </span>
                      )}
                      {o.sameProject && <span className="ml-1">— ambas usam projeto (pode ser intencional)</span>}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* 4. CCs órfãos em regras */}
        <AccordionItem value="orphans" className="glass-card border-0">
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-warning" />
              <span className="font-medium">CCs referenciados em regras mas não ativos</span>
              <Badge variant="outline" className="ml-1">{orphanRuleCCs.length}</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {orphanRuleCCs.length === 0 ? (
              <p className="text-xs text-muted-foreground">Todas as regras apontam para CCs existentes.</p>
            ) : (
              <div className="space-y-1.5">
                {orphanRuleCCs.map((o, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs p-2 rounded-md border border-border/60 bg-muted/20">
                    <Shield className="w-3 h-3 text-muted-foreground" />
                    <button
                      onClick={() => onOpenRule?.(o.rule)}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {o.rule.name}
                    </button>
                    <span className="text-muted-foreground">→ CC</span>
                    <span className="font-mono text-destructive">{o.value}</span>
                  </div>
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

/* ────────────────────────── Sub-componentes ────────────────────────── */

function Kpi({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "success" | "warning" | "destructive";
}) {
  const bg =
    tone === "destructive"
      ? "bg-destructive/10 border-destructive/30 text-destructive"
      : tone === "warning"
        ? "bg-warning/10 border-warning/30 text-warning"
        : "bg-success/10 border-success/30 text-success";
  return (
    <div className={`p-3 rounded-lg border ${bg}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide opacity-80">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-2xl font-bold font-mono mt-1">{value}</p>
    </div>
  );
}

export { DOC_TYPE_LABELS };
