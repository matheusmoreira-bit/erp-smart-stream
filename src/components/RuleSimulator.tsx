import { useCallback, useMemo, useState } from "react";
import { PlayCircle, CheckCircle2, XCircle, Trophy, Users as UsersIcon, X } from "lucide-react";
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
import { evaluateCriterion } from "@/lib/approvalSegments";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import { useSapCachedList } from "@/hooks/useSapCachedList";
import { useSapUsers } from "@/hooks/useSapUsers";
import type { SapSearchOption } from "@/components/SapSearchCombobox";

function fieldLabel(field: string): string {
  return FIELD_OPTIONS.find((f) => f.value === field)?.label || field;
}

function criterionSummary(c: RuleCriterion): string {
  const f = fieldLabel(c.field);
  const op = OPERATOR_LABELS[c.operator];
  if (c.operator === "between") return `${f} ${op} ${c.value} e ${c.value2}`;
  return `${f} ${op} ${c.value}`;
}

interface SimulationInput {
  total_amount: string;
  cost_center: SapSearchOption | null;
  project: SapSearchOption | null;
  requester: SapSearchOption | null;
  supplier: SapSearchOption | null;
  currency: string;
  doc_type: RuleDocType;
  item_codes: SapSearchOption[];
  item_groups: SapSearchOption[];
}

const EMPTY: SimulationInput = {
  total_amount: "",
  cost_center: null,
  project: null,
  requester: null,
  supplier: null,
  currency: "BRL",
  doc_type: "purchase",
  item_codes: [],
  item_groups: [],
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function buildContext(input: SimulationInput): Record<string, unknown> {
  const toList = (items: SapSearchOption[]) =>
    ` ${items
      .flatMap((i) => [i.code, i.name])
      .map((x) => (x || "").trim().toLowerCase())
      .filter(Boolean)
      .join(" ")} `;
  return {
    total_amount: Number(input.total_amount || 0),
    cost_center: (input.cost_center?.code || "").trim(),
    project: (input.project?.code || "").trim(),
    requester_name: (input.requester?.code || input.requester?.name || "").trim(),
    supplier_name: `${input.supplier?.name || ""} ${input.supplier?.code || ""}`.trim(),
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

  /* ── Data sources (cached SAP lists, mesmos usados na criação de despesa) ── */
  const supplierMapRow = useCallback(
    (row: any) => ({
      code: row.CardCode,
      name: row.CardName,
      extra: row.FederalTaxID || undefined,
      details: { fantasyName: row.AliasName || undefined, taxId: row.FederalTaxID || undefined },
    } as SapSearchOption),
    [],
  );
  const isSales = input.doc_type === "sales";
  const { options: supplierOptions, isLoading: suppliersLoading } = useSapCachedList({
    cacheKey: isSales ? "customers_active_v2" : "suppliers_active_v2",
    endpoint: "BusinessPartners",
    params: isSales
      ? { $select: "CardCode,CardName,AliasName,FederalTaxID,Currency", $filter: "CardType eq 'cCustomer' and Frozen eq 'tNO'" }
      : { $select: "CardCode,CardName,AliasName,FederalTaxID,Currency", $filter: "CardType eq 'cSupplier' and Frozen eq 'tNO'" },
    mapRow: supplierMapRow,
    enabled: open,
  });

  const itemMapRow = useCallback((row: any) => ({ code: row.ItemCode, name: row.ItemName }), []);
  const { options: itemOptions, isLoading: itemsLoading } = useSapCachedList({
    cacheKey: isSales ? "items_sales_active_v3" : "items_purchase_active_v3",
    endpoint: "Items",
    params: { $filter: "Valid eq 'tYES' and Frozen eq 'tNO'", $select: "ItemCode,ItemName" },
    mapRow: itemMapRow,
    enabled: open,
  });

  const costCenterMapRow = useCallback(
    (row: any) => ({ code: row.CenterCode, name: row.CenterName }),
    [],
  );
  const { options: rawCostCenterOptions, isLoading: costCentersLoading } = useSapCachedList({
    cacheKey: "cost_centers",
    endpoint: "ProfitCenters",
    params: { $filter: "Active eq 'tYES'", $select: "CenterCode,CenterName" },
    mapRow: costCenterMapRow,
    enabled: open,
  });
  const costCenterOptions = useMemo(
    () => rawCostCenterOptions.filter((o) => !o.name?.toLowerCase().startsWith("centro geral")),
    [rawCostCenterOptions],
  );

  const projectMapRow = useCallback((row: any) => ({ code: row.Code, name: row.Name }), []);
  const { options: projectOptions, isLoading: projectsLoading } = useSapCachedList({
    cacheKey: "projects",
    endpoint: "Projects",
    params: { $filter: "Active eq 'tYES'", $select: "Code,Name" },
    mapRow: projectMapRow,
    enabled: open,
  });

  const { options: itemGroupOptions, isLoading: itemGroupsLoading } = useSapCachedList({
    cacheKey: "item_groups",
    endpoint: "ItemGroups",
    params: { $select: "Number,GroupName", $orderby: "GroupName" },
    mapRow: (r: any) => ({ code: String(r.Number), name: r.GroupName }),
    enabled: open,
  });

  const { users: sapUsers, isLoading: sapUsersLoading } = useSapUsers();
  const requesterOptions = useMemo<SapSearchOption[]>(
    () =>
      sapUsers.map((u) => ({
        code: u.UserCode,
        name: u.UserName || u.UserCode,
        extra: u.eMail || undefined,
      })),
    [sapUsers],
  );

  /* ── Simulation ── */
  const results = useMemo<Match[]>(() => {
    if (!ran) return [];
    const ctx = buildContext(input);
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
      const allMatched = criteria.length > 0 && perCriterion.every((p) => p.passed);
      return { rule: r, perCriterion, allMatched };
    });
  }, [ran, input, rules]);

  const matched = results.filter((r) => r.allMatched);
  const winner = matched[0];

  const reset = () => {
    setInput(EMPTY);
    setRan(false);
  };

  /* ── Multi-add helpers for chips ── */
  const addTag = (key: "item_codes" | "item_groups", opt: SapSearchOption | null) => {
    if (!opt) return;
    setInput((prev) => {
      if (prev[key].some((x) => x.code === opt.code)) return prev;
      return { ...prev, [key]: [...prev[key], opt] };
    });
  };
  const removeTag = (key: "item_codes" | "item_groups", code: string) => {
    setInput((prev) => ({ ...prev, [key]: prev[key].filter((x) => x.code !== code) }));
  };

  // Reset combobox after each pick — use a bump key
  const [itemPickKey, setItemPickKey] = useState(0);
  const [groupPickKey, setGroupPickKey] = useState(0);

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
                  <SelectItem value="advance">Adiantamento</SelectItem>
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
              <CachedSearchCombobox
                options={costCenterOptions}
                isLoading={costCentersLoading}
                value={input.cost_center}
                onChange={(v) => setField("cost_center", v)}
                placeholder="Buscar centro de custo..."
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">
                Projeto
              </label>
              <CachedSearchCombobox
                options={projectOptions}
                isLoading={projectsLoading}
                value={input.project}
                onChange={(v) => setField("project", v)}
                placeholder="Buscar projeto..."
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">
                Solicitante
              </label>
              <CachedSearchCombobox
                options={requesterOptions}
                isLoading={sapUsersLoading}
                value={input.requester}
                onChange={(v) => setField("requester", v)}
                placeholder="Buscar usuário..."
              />
            </div>

            <div className="col-span-2 md:col-span-3">
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">
                {isSales ? "Cliente" : "Fornecedor"}
              </label>
              <CachedSearchCombobox
                options={supplierOptions}
                isLoading={suppliersLoading}
                value={input.supplier}
                onChange={(v) => setField("supplier", v)}
                placeholder={isSales ? "Buscar cliente..." : "Buscar fornecedor..."}
              />
            </div>

            <div className="col-span-2 md:col-span-3">
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">
                Códigos dos Itens
              </label>
              <CachedSearchCombobox
                key={`item-${itemPickKey}`}
                options={itemOptions}
                isLoading={itemsLoading}
                value={null}
                onChange={(v) => {
                  addTag("item_codes", v);
                  setItemPickKey((k) => k + 1);
                }}
                placeholder="Buscar item para adicionar..."
              />
              {input.item_codes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {input.item_codes.map((it) => (
                    <Badge key={it.code} variant="secondary" className="gap-1 text-[11px]">
                      <span className="font-mono">{it.code}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="truncate max-w-[180px]">{it.name}</span>
                      <button
                        type="button"
                        onClick={() => removeTag("item_codes", it.code)}
                        className="hover:text-destructive"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="col-span-2 md:col-span-3">
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">
                Grupos dos Itens
              </label>
              <CachedSearchCombobox
                key={`group-${groupPickKey}`}
                options={itemGroupOptions}
                isLoading={itemGroupsLoading}
                value={null}
                onChange={(v) => {
                  addTag("item_groups", v);
                  setGroupPickKey((k) => k + 1);
                }}
                placeholder="Buscar grupo para adicionar..."
              />
              {input.item_groups.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {input.item_groups.map((g) => (
                    <Badge key={g.code} variant="secondary" className="gap-1 text-[11px]">
                      <span className="truncate max-w-[220px]">{g.name}</span>
                      <button
                        type="button"
                        onClick={() => removeTag("item_groups", g.code)}
                        className="hover:text-destructive"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
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

          {ran && (
            <div className="space-y-4">
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
