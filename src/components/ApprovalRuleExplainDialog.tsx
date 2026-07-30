import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, X, ScanSearch, AlertTriangle, ArrowRight } from "lucide-react";
import { useApprovalRules } from "@/hooks/useApprovalRules";
import { displayUserName } from "@/lib/user-display";
import {
  explainApproval,
  summarizeExplanation,
  fieldLabel,
  operatorLabel,
  rateioLabel,
  type ExplainVariables,
  type GroupTrace,
} from "@/lib/approval-rule-explain";

interface Props {
  open: boolean;
  onClose: () => void;
  vars: ExplainVariables;
  appliedRuleId: string | null;
  currentLevel: number | null;
  currentApprover: string;
  docTitle: string;
}

function money(v: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(v || 0);
}

function VarRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right font-medium break-words">{value}</span>
    </div>
  );
}

function GroupBlock({ g, index }: { g: GroupTrace; index: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center gap-2">
        {index > 0 && (
          <Badge variant="outline" className="uppercase">{g.groupLogic === "or" ? "OU" : "E"}</Badge>
        )}
        <span className="text-xs text-muted-foreground">Grupo {index + 1}</span>
        <Badge variant={g.passed ? "default" : "secondary"} className="ml-auto">
          {g.passed ? "Atendido" : "Não atendido"}
        </Badge>
      </div>
      <div className="space-y-1.5">
        {g.criteria.map((c, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span className={`mt-0.5 shrink-0 ${c.passed ? "text-primary" : "text-destructive"}`}>
              {c.passed ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <div className="break-words">
                {i > 0 && (
                  <span className="mr-1 text-[10px] uppercase text-muted-foreground">
                    {c.criterion.logic === "or" ? "ou" : "e"}
                  </span>
                )}
                <span className="font-medium">{fieldLabel(c.criterion.field)}</span>{" "}
                <span className="text-muted-foreground">{operatorLabel(c.criterion.operator).toLowerCase()}</span>{" "}
                <span className="font-medium">
                  {c.criterion.value}
                  {c.criterion.operator === "between" && c.criterion.value2 ? ` — ${c.criterion.value2}` : ""}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                Valor no documento: <span className="font-mono">{c.actual}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Raio-X da Regra de Aprovação: valida e explica, critério a critério, por que
 * a regra vigente foi aplicada ao documento em análise.
 */
export function ApprovalRuleExplainDialog({
  open,
  onClose,
  vars,
  appliedRuleId,
  currentLevel,
  currentApprover,
  docTitle,
}: Props) {
  const { rules, isLoading: loading } = useApprovalRules();

  // Normaliza as variáveis: qualquer campo ausente vira valor seguro para não
  // quebrar a renderização (um throw aqui derrubava a tela inteira).
  const vars: ExplainVariables = useMemo(
    () => ({
      costCenters: rawVars?.costCenters ?? [],
      projects: rawVars?.projects ?? [],
      totalAmount: Number(rawVars?.totalAmount || 0),
      currency: rawVars?.currency || "BRL",
      itemCodes: rawVars?.itemCodes ?? [],
      itemNames: rawVars?.itemNames ?? [],
      supplierName: rawVars?.supplierName || "",
      supplierCode: rawVars?.supplierCode || "",
      requesterName: rawVars?.requesterName || "",
      docType: rawVars?.docType || "purchase",
      rateioType: rawVars?.rateioType || "padrao",
      rateioByCC: rawVars?.rateioByCC ?? [],
    }),
    [rawVars],
  );

  const result = useMemo(() => {
    try {
      return explainApproval(rules || [], vars, appliedRuleId);
    } catch {
      return {
        evaluated: [],
        simulatedMatch: null,
        appliedRule: null,
        appliedTrace: null,
        divergent: false,
      };
    }
  }, [rules, vars, appliedRuleId]);

  const summary = useMemo(() => {
    try {
      return summarizeExplanation(result, vars, currentLevel, currentApprover);
    } catch {
      return "Não foi possível montar a explicação desta regra.";
    }
  }, [result, vars, currentLevel, currentApprover]);


  const skipped = result.evaluated.filter(
    (t) => !t.matched && (!result.appliedRule || t.rule.id !== result.appliedRule.id),
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="w-screen h-[100dvh] max-w-none rounded-none sm:h-auto sm:max-h-[90vh] sm:w-[95vw] sm:max-w-3xl sm:rounded-lg overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanSearch className="h-5 w-5 text-primary" />
            Raio-X da Regra de Aprovação
          </DialogTitle>
          <DialogDescription>{docTitle}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-5 pb-4">
            {/* Resumo em texto */}
            <div className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">
              {loading ? "Carregando matriz de aprovação…" : summary}
            </div>

            {result.divergent && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  A matriz mudou desde a criação: hoje o documento cairia em{" "}
                  <strong>{result.simulatedMatch?.rule.name}</strong>. A regra gravada continua valendo para este documento.
                </span>
              </div>
            )}

            {/* Variáveis atuais */}
            <section>
              <h4 className="mb-2 text-sm font-semibold">Variáveis avaliadas</h4>
              <div className="rounded-md border px-3 py-1 divide-y">
                <VarRow
                  label="Centro de Custo"
                  value={vars.costCenters.length ? vars.costCenters.join(", ") : "—"}
                />
                <VarRow label="Projeto" value={vars.projects.length ? vars.projects.join(", ") : "—"} />
                <VarRow label="Valor total" value={money(vars.totalAmount, vars.currency)} />
                <VarRow
                  label="Itens"
                  value={vars.itemCodes.length ? `${vars.itemCodes.length} · ${vars.itemCodes.slice(0, 4).join(", ")}${vars.itemCodes.length > 4 ? "…" : ""}` : "—"}
                />
                <VarRow label="Regra de rateio" value={rateioLabel(vars.rateioType)} />
                <VarRow label="Fornecedor / Cliente" value={vars.supplierName || "—"} />
                <VarRow label="Solicitante" value={displayUserName(vars.requesterName) || "—"} />
              </div>

              {vars.rateioByCC.length > 1 && (
                <div className="mt-2 space-y-1 rounded-md border px-3 py-2 text-sm">
                  <div className="text-xs font-medium text-muted-foreground">Distribuição por centro de custo</div>
                  {vars.rateioByCC.map((r) => (
                    <div key={r.code} className="flex justify-between">
                      <span className="font-mono text-xs">{r.code}</span>
                      <span>
                        {money(r.amount, vars.currency)}{" "}
                        <span className="text-muted-foreground">({r.pct.toFixed(1)}%)</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <Separator />

            {/* Regra aplicada */}
            <section>
              <h4 className="mb-2 text-sm font-semibold">Regra aplicada</h4>
              {result.appliedRule ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{result.appliedRule.name}</Badge>
                    <Badge variant="outline">Prioridade {result.appliedRule.priority}</Badge>
                    {!result.appliedRule.is_active && <Badge variant="destructive">Inativa</Badge>}
                    {result.appliedTrace && (
                      <Badge variant={result.appliedTrace.matched ? "secondary" : "destructive"}>
                        {result.appliedTrace.matched ? "Critérios conferem" : "Critérios não conferem hoje"}
                      </Badge>
                    )}
                  </div>

                  {result.appliedTrace?.groups.map((g, i) => (
                    <GroupBlock key={g.group} g={g} index={i} />
                  ))}

                  <div>
                    <div className="mb-1 text-xs font-medium text-muted-foreground">Cadeia de aprovação</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[...(result.appliedRule.levels || [])]
                        .sort((a, b) => a.level_order - b.level_order)
                        .map((l, i, arr) => (
                          <span key={`${l.level_order}-${l.approver_email || l.approver_name}-${i}`} className="flex items-center gap-1.5">
                            <Badge variant={currentLevel === l.level_order ? "default" : "outline"}>
                              AP{l.level_order} · {displayUserName(l.approver_name)}
                            </Badge>
                            {i < arr.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                          </span>
                        ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sem regra vinculada — o documento seguiu para aprovação administrativa.
                </p>
              )}
            </section>

            {/* Regras descartadas */}
            {skipped.length > 0 && (
              <section>
                <h4 className="mb-2 text-sm font-semibold">
                  Regras de maior/igual prioridade que não bateram ({skipped.length})
                </h4>
                <div className="space-y-1.5">
                  {skipped.slice(0, 12).map((t) => {
                    const failed = t.groups.flatMap((g) => g.criteria).filter((c) => !c.passed);
                    return (
                      <div key={t.rule.id} className="rounded-md border px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium break-words">{t.rule.name}</span>
                          <Badge variant="outline" className="shrink-0">P{t.rule.priority}</Badge>
                        </div>
                        {failed.length > 0 && (
                          <div className="mt-1 text-xs text-muted-foreground break-words">
                            Falhou em: {failed.slice(0, 3).map((c) =>
                              `${fieldLabel(c.criterion.field)} ${operatorLabel(c.criterion.operator).toLowerCase()} ${c.criterion.value}`,
                            ).join(" · ")}
                            {failed.length > 3 ? "…" : ""}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export default ApprovalRuleExplainDialog;
