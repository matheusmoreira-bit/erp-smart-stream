import { useMemo, useState } from "react";
import { PlayCircle, CheckCircle2, XCircle, Trophy, Users as UsersIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  OPERATOR_LABELS,
  FIELD_OPTIONS,
  type ApprovalRule,
  type RuleCriterion,
  type RuleDocType,
} from "@/hooks/useApprovalRules";

function fieldLabel(field: string): string {
  return FIELD_OPTIONS.find((f) => f.value === field)?.label || field;
}

function criterionSummary(c: RuleCriterion): string {
  const f = fieldLabel(c.field);
  const op = OPERATOR_LABELS[c.operator];
  if (c.operator === "between") return `${f} ${op} ${c.value} e ${c.value2}`;
  return `${f} ${op} ${c.value}`;
}

function evaluateCriterion(c: RuleCriterion, ctx: Record<string, unknown>): boolean {
  const raw = ctx[c.field];
  if (raw === undefined || raw === null) return false;
  const val = String(raw).toLowerCase();
  const target = String(c.value ?? "").toLowerCase();

  switch (c.operator) {
    case "greater_than":
      return Number(raw) > Number(c.value);
    case "less_than":
      return Number(raw) < Number(c.value);
    case "between":
      return (
        Number(raw) >= Number(c.value) &&
        Number(raw) <= Number(c.value2 ?? c.value)
      );
    case "equal":
      return val === target;
    case "not_equal":
      return val !== target;
    case "contains":
      return val.includes(target);
    case "not_contains":
      return !val.includes(target);
    case "like": {
      const pattern = target.replace(/%/g, ".*").replace(/_/g, ".");
      try {
        return new RegExp(`^${pattern}$`).test(val);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

interface SimulationInput {
  total_amount: string;
  cost_center: string;
  project: string;
  requester_name: string;
  supplier_name: string;
  currency: string;
  doc_type: RuleDocType;
  item_codes: string;
  item_groups: string;
}

const EMPTY: SimulationInput = {
  total_amount: "",
  cost_center: "",
  project: "",
  requester_name: "",
  supplier_name: "",
  currency: "BRL",
  doc_type: "purchase",
  item_codes: "",
  item_groups: "",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

/**
 * Constrói o contexto que o `findMatchingRule` monta em runtime — mesmo shape
 * usado pelo hook `useExpenses` para avaliar regras na criação de despesas.
 */
function buildContext(input: SimulationInput): Record<string, unknown> {
  const toList = (s: string) =>
    ` ${s
      .split(/[\s,;]+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
      .join(" ")} `;
  return {
    total_amount: Number(input.total_amount || 0),
    cost_center: input.cost_center.trim(),
    project: input.project.trim(),
    requester_name: input.requester_name.trim(),
    supplier_name: input.supplier_name.trim(),
    currency: input.currency.trim().toUpperCase(),
    doc_type: input.doc_type,
    item_codes: toList(input.item_codes),
    item_groups: toList(input.item_groups),
  };
}

interface Match {
  rule: ApprovalRule;
  perCriterion: { criterion: RuleCriterion; passed: boolean }[];
  allMatched: boolean;
}

export function RuleSimulator({
  open,
  onClose,
  rules,
}: {
  open: boolean;
  onClose: () => void;
  rules: ApprovalRule[];
}) {
  const [input, setInput] = useState<SimulationInput>(EMPTY);
  const [ran, setRan] = useState(false);

  const setField = <K extends keyof SimulationInput>(k: K, v: SimulationInput[K]) =>
    setInput((prev) => ({ ...prev, [k]: v }));

  const results = useMemo<Match[]>(() => {
    if (!ran) return [];
    const ctx = buildContext(input);
    // mesma lógica do runtime: só regras ativas + filtro por doc_type
    const scoped = rules
      .filter((r) => r.is_active)
      .filter((r) => {
        const rdt = r.doc_type;
        return !rdt || rdt === "both" || rdt === input.doc_type;
      })
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    return scoped.map((r) => {
      const criteria = Array.isArray(r.criteria) ? r.criteria : [];
      const perCriterion = criteria.map((c) => ({
        criterion: c,
        passed: evaluateCriterion(c, ctx),
      }));
      const allMatched =
        criteria.length > 0 && perCriterion.every((p) => p.passed);
      return { rule: r, perCriterion, allMatched };
    });
  }, [ran, input, rules]);

  const matched = results.filter((r) => r.allMatched);
  const winner = matched[0];

  const reset = () => {
    setInput(EMPTY);
    setRan(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          setRan(false);
        }
      }}
    >
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayCircle className="w-5 h-5 text-primary" />
            Simulador de Regras de Aprovação
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          <p className="text-xs text-muted-foreground">
            Preencha as características de um pedido hipotético para ver quais regras (e cadeia de aprovadores)
            seriam aplicadas. A avaliação usa exatamente a mesma lógica da criação de despesas.
          </p>

          {/* Inputs */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">
                Tipo de Documento
              </label>
              <Select
                value={input.doc_type}
                onValueChange={(v) => setField("doc_type", v as RuleDocType)}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="purchase">Compra</SelectItem>
                  <SelectItem value="sales">Venda</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">
                Valor Total
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={input.total_amount}
                onChange={(e) => setField("total_amount", e.target.value)}
                placeholder="Ex: 6000"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">
                Moeda
              </label>
              <Input
                value={input.currency}
                onChange={(e) => setField("currency", e.target.value)}
                placeholder="BRL"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">
                Centro de Custo
              </label>
              <Input
                value={input.cost_center}
                onChange={(e) => setField("cost_center", e.target.value)}
                placeholder="Ex: 1.9.1.2"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">
                Projeto
              </label>
              <Input
                value={input.project}
                onChange={(e) => setField("project", e.target.value)}
                placeholder="Ex: BET.BET"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">
                Solicitante
              </label>
              <Input
                value={input.requester_name}
                onChange={(e) => setField("requester_name", e.target.value)}
                placeholder="Ex: priscila.iaralhan"
                className="h-9 text-sm"
              />
            </div>
            <div className="col-span-2 md:col-span-2">
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">
                Fornecedor
              </label>
              <Input
                value={input.supplier_name}
                onChange={(e) => setField("supplier_name", e.target.value)}
                placeholder="Ex: MILLENA MARIA SILVEIRA GUEDES"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">
                Códigos dos Itens
              </label>
              <Input
                value={input.item_codes}
                onChange={(e) => setField("item_codes", e.target.value)}
                placeholder="Ex: IMP001, FOL002"
                className="h-9 text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">
                Grupos dos Itens
              </label>
              <Input
                value={input.item_groups}
                onChange={(e) => setField("item_groups", e.target.value)}
                placeholder="Ex: Impostos, Folha"
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button onClick={() => setRan(true)} className="gap-1.5">
              <PlayCircle className="w-4 h-4" /> Simular
            </Button>
            <Button variant="ghost" onClick={reset}>
              Limpar
            </Button>
            {ran && (
              <div className="ml-auto text-xs text-muted-foreground">
                {matched.length} de {results.length} regra{results.length === 1 ? "" : "s"} aplicáve{results.length === 1 ? "l" : "is"} bate{matched.length === 1 ? "" : "m"}
              </div>
            )}
          </div>

          {/* Results */}
          {ran && (
            <div className="space-y-4">
              {/* Winner */}
              {winner ? (
                <div className="rounded-lg border border-success/40 bg-success/5 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-success" />
                    <p className="text-xs font-semibold uppercase tracking-wider text-success">
                      Regra vencedora
                    </p>
                    <Badge variant="outline" className="text-[10px]">
                      Prioridade {winner.rule.priority}
                    </Badge>
                  </div>
                  <p className="text-sm font-semibold text-foreground">{winner.rule.name}</p>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                      <UsersIcon className="w-3 h-3" /> Cadeia de aprovadores
                    </p>
                    {winner.rule.levels.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">
                        Regra sem níveis de aprovação configurados.
                      </p>
                    ) : (
                      <ol className="space-y-1.5">
                        {[...winner.rule.levels]
                          .sort((a, b) => a.level_order - b.level_order)
                          .map((lvl) => (
                            <li
                              key={`${lvl.level_order}-${lvl.approver_email || lvl.approver_name}`}
                              className="flex items-center gap-2 text-sm"
                            >
                              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary text-[11px] font-bold">
                                {lvl.level_order}
                              </div>
                              <span className="font-medium text-foreground">{lvl.approver_name}</span>
                              {lvl.approver_email && (
                                <span className="text-[11px] text-muted-foreground">
                                  {lvl.approver_email}
                                </span>
                              )}
                            </li>
                          ))}
                      </ol>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
                  <p className="text-sm font-medium text-foreground mb-1">
                    Nenhuma regra bate com esse cenário.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Na criação real, o pedido seria roteado para o aprovador administrativo padrão da empresa.
                  </p>
                </div>
              )}

              {/* All applicable rules */}
              {matched.length > 1 && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                    Outras regras que também batem ({matched.length - 1})
                  </p>
                  <div className="space-y-2">
                    {matched.slice(1).map((m) => (
                      <div
                        key={m.rule.id}
                        className="rounded-lg border border-border bg-muted/20 p-3 flex items-center justify-between"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">{m.rule.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {m.rule.levels
                              .map((l) => l.approver_name)
                              .filter(Boolean)
                              .join(" → ") || "Sem níveis"}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          Prioridade {m.rule.priority}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Diagnostic */}
              <details className="rounded-lg border border-border bg-muted/10 p-3">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Diagnóstico completo — {results.length} regras avaliadas
                </summary>
                <div className="mt-3 space-y-2">
                  {results.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nenhuma regra ativa para este tipo de documento.
                    </p>
                  ) : (
                    results.map((m) => (
                      <div
                        key={m.rule.id}
                        className={`rounded-md border p-2.5 text-xs ${
                          m.allMatched
                            ? "border-success/30 bg-success/5"
                            : "border-border bg-background"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          {m.allMatched ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                          <span className="font-medium text-foreground">{m.rule.name}</span>
                          <Badge variant="outline" className="text-[9px] ml-auto">
                            P{m.rule.priority}
                          </Badge>
                        </div>
                        {m.perCriterion.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground italic">
                            Regra sem critérios — nunca casa automaticamente.
                          </p>
                        ) : (
                          <ul className="space-y-0.5 ml-5">
                            {m.perCriterion.map((p, idx) => (
                              <li
                                key={idx}
                                className={`flex items-center gap-1.5 ${
                                  p.passed ? "text-success" : "text-muted-foreground"
                                }`}
                              >
                                {p.passed ? "✓" : "✗"}
                                <span>{criterionSummary(p.criterion)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </details>

              {winner && Number(input.total_amount) > 0 && (
                <p className="text-[11px] text-muted-foreground text-center">
                  Valor simulado:{" "}
                  <span className="font-mono text-foreground">
                    {formatCurrency(Number(input.total_amount))}
                  </span>
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
