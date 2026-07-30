import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  EyeOff,
  GitCompareArrows,
  Layers,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ApprovalRule } from "@/hooks/useApprovalRules";
import {
  CONFLICT_KIND_LABELS,
  detectRuleConflicts,
  type ConflictSeverity,
  type RuleConflict,
} from "@/lib/approval-rule-conflicts";

const SEVERITY_STYLE: Record<ConflictSeverity, { border: string; text: string; label: string }> = {
  critical: { border: "border-l-destructive", text: "text-destructive", label: "Crítico" },
  warning: { border: "border-l-warning", text: "text-warning", label: "Atenção" },
  info: { border: "border-l-muted-foreground/40", text: "text-muted-foreground", label: "Informativo" },
};

const KIND_ICON = {
  tie: ShieldAlert,
  overlap: GitCompareArrows,
  redundant: Copy,
} as const;

function chainText(rule: ApprovalRule): string {
  const levels = (rule.levels || []).slice().sort((a, b) => a.level_order - b.level_order);
  if (levels.length === 0) return "sem aprovadores";
  return levels.map((l) => `${l.level_order}. ${l.approver_name || l.approver_email || "—"}`).join("  →  ");
}

function ConflictCard({
  conflict,
  onOpenRule,
}: {
  conflict: RuleConflict;
  onOpenRule?: (rule: ApprovalRule) => void;
}) {
  const [open, setOpen] = useState(false);
  const style = SEVERITY_STYLE[conflict.severity];
  const Icon = KIND_ICON[conflict.kind];

  return (
    <div className={`glass-card border-l-2 ${style.border} p-3 space-y-2`}>
      <div className="flex items-start gap-2">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${style.text}`} />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={`text-[10px] ${style.text}`}>
              {CONFLICT_KIND_LABELS[conflict.kind]} · {style.label}
            </Badge>
            <span className="text-[10px] text-muted-foreground font-mono">
              {conflict.scenarios.length} cenário(s)
            </span>
          </div>
          <p className="text-sm text-foreground leading-snug">{conflict.message}</p>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Ver cenários e cadeias
          </button>

          {open && (
            <div className="space-y-2 pt-1">
              <div className="grid gap-2 sm:grid-cols-2">
                {[conflict.winner, conflict.loser].map((r, i) => (
                  <div key={r.id} className="rounded-md bg-muted/30 p-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground truncate">
                        {i === 0 ? "Vence: " : "Perde: "}
                        {r.name}
                      </span>
                      <Badge variant="secondary" className="text-[10px] font-mono">P{r.priority}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground break-words">{chainText(r)}</p>
                    {onOpenRule && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => onOpenRule(r)}
                      >
                        Abrir regra
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <ul className="space-y-1">
                {conflict.scenarios.map((s, i) => (
                  <li key={i} className="text-[11px] text-muted-foreground font-mono bg-muted/20 rounded px-2 py-1">
                    {s.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  rules: ApprovalRule[];
  /** Regra em edição ainda não salva — entra na análise sobreposta à matriz. */
  draftRule?: ApprovalRule | null;
  onOpenRule?: (rule: ApprovalRule) => void;
  /** Quando true, mostra apenas achados que envolvem a regra em rascunho. */
  draftOnly?: boolean;
}

export function RuleConflictsPanel({ rules, draftRule = null, onOpenRule, draftOnly = false }: Props) {
  const report = useMemo(() => detectRuleConflicts(rules, draftRule), [rules, draftRule]);

  const conflicts = useMemo(() => {
    if (!draftOnly || !draftRule) return report.conflicts;
    return report.conflicts.filter((c) => c.winner.id === draftRule.id || c.loser.id === draftRule.id);
  }, [report.conflicts, draftOnly, draftRule]);

  const shadowed = useMemo(() => {
    if (!draftOnly || !draftRule) return report.shadowed;
    return report.shadowed.filter((s) => s.rule.id === draftRule.id);
  }, [report.shadowed, draftOnly, draftRule]);

  const criticals = conflicts.filter((c) => c.severity === "critical").length;
  const warnings = conflicts.filter((c) => c.severity === "warning").length;

  return (
    <div className="space-y-3">
      <div className="glass-card p-3 flex flex-wrap items-center gap-3">
        <Layers className="w-4 h-4 text-primary" />
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-medium text-foreground">Conflitos e sobreposição de regras</p>
          <p className="text-xs text-muted-foreground">
            {report.scenariosEvaluated} cenário(s) fictício(s) gerados a partir dos critérios das regras ativas e
            avaliados com a mesma lógica do Raio-X.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] text-destructive">{criticals} crítico(s)</Badge>
          <Badge variant="outline" className="text-[10px] text-warning">{warnings} atenção</Badge>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">{shadowed.length} sombreada(s)</Badge>
        </div>
      </div>

      {conflicts.length === 0 && shadowed.length === 0 ? (
        <div className="glass-card p-4 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-success" />
          <p className="text-sm text-muted-foreground">
            Nenhuma disputa detectada entre as regras ativas nos cenários avaliados.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {conflicts.map((c) => (
            <ConflictCard key={c.id} conflict={c} onOpenRule={onOpenRule} />
          ))}

          {shadowed.map((s) => (
            <div key={s.rule.id} className="glass-card border-l-2 border-l-warning p-3 flex items-start gap-2">
              <EyeOff className="w-4 h-4 mt-0.5 text-warning shrink-0" />
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  A regra <span className="font-semibold">{s.rule.name}</span> (prioridade {s.rule.priority}) nunca
                  vence: em todos os cenários em que ela bate, outra regra é aplicada antes.
                </p>
                {s.blockedBy.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Bloqueada por: {s.blockedBy.map((r) => `${r.name} (P${r.priority})`).join(", ")}
                  </p>
                )}
                {onOpenRule && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] mt-1" onClick={() => onOpenRule(s.rule)}>
                    Abrir regra
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {report.unresolvable.length > 0 && (
        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          Sem critérios avaliáveis (não analisadas): {report.unresolvable.map((r) => r.name).join(", ")}.
        </p>
      )}
    </div>
  );
}

export function RuleConflictsDialog({
  open,
  onClose,
  rules,
  draftRule = null,
}: {
  open: boolean;
  onClose: () => void;
  rules: ApprovalRule[];
  draftRule?: ApprovalRule | null;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompareArrows className="w-4 h-4 text-primary" />
            Conflitos com a matriz publicada
          </DialogTitle>
        </DialogHeader>
        <RuleConflictsPanel rules={rules} draftRule={draftRule} draftOnly={!!draftRule} />
      </DialogContent>
    </Dialog>
  );
}
