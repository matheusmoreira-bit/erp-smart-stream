import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  FileText,
  Send,
  ShieldCheck,
  Ban,
  AlertTriangle,
  Cable,
  FileCheck2,
  Receipt,
  Wallet,
  CircleCheck,
  CircleDashed,
  Circle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { STATUS_LABELS } from "@/hooks/useExpenses";
import {
  useNfEntradaLinks,
  useContasPagarLinks,
  type NfEntradaLink,
  type ContaPagarLink,
} from "@/hooks/useRelationsMapDerived";
import { Loader2 } from "lucide-react";

type LogDecision =
  | "created"
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled"
  | "integrated"
  | "integration_failed";

interface ApprovalLogRow {
  id: string;
  decision: LogDecision;
  approver_name: string | null;
  approver_email: string | null;
  level_order: number | null;
  remarks: string | null;
  decided_at: string;
}

interface RuleLevelRow {
  level_order: number;
  approver_name: string;
  approver_email: string | null;
}

export interface RelationsMapExpense {
  id: string;
  status: string;
  current_approver?: string | null;
  approval_rule_id?: string | null;
  requester_name?: string | null;
  requester_email?: string | null;
  sap_doc_num?: number | null;
  sap_doc_entry?: number | null;
  total_amount?: number;
  currency?: string | null;
  supplier_name?: string | null;
  supplier_code?: string | null;
  company_db?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  expense: RelationsMapExpense | null;
  title?: string;
}

type StageKey = "rascunho" | "pendente_aprovacao" | "aprovado" | "pc_lancado" | "nf_entrada" | "pagamento" | "finalizado";

const STAGE_DEFS: { key: StageKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "rascunho", label: "Rascunho", icon: FileText },
  { key: "pendente_aprovacao", label: "Aprovação", icon: ShieldCheck },
  { key: "aprovado", label: "Aprovado", icon: CheckCircle2 },
  { key: "pc_lancado", label: "PC no SAP", icon: FileCheck2 },
  { key: "nf_entrada", label: "NF Entrada", icon: Receipt },
  { key: "pagamento", label: "Pagamento", icon: Wallet },
  { key: "finalizado", label: "Finalizado", icon: CircleCheck },
];

const ORDER: StageKey[] = STAGE_DEFS.map((s) => s.key);

const DECISION_META: Record<LogDecision, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  created: { label: "Criado", icon: FileText, color: "text-muted-foreground" },
  submitted: { label: "Enviado para aprovação", icon: Send, color: "text-primary" },
  approved: { label: "Aprovado", icon: CheckCircle2, color: "text-success" },
  rejected: { label: "Rejeitado", icon: XCircle, color: "text-destructive" },
  cancelled: { label: "Cancelado", icon: Ban, color: "text-muted-foreground" },
  integrated: { label: "Integrado ao ERP", icon: Cable, color: "text-success" },
  integration_failed: { label: "Falha na integração", icon: AlertTriangle, color: "text-destructive" },
};

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function formatCurrency(value?: number, currency?: string | null) {
  if (value === undefined || value === null) return "—";
  const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(value);
}

export function RelationsMap({ open, onClose, expense, title }: Props) {
  const [log, setLog] = useState<ApprovalLogRow[]>([]);
  const [levels, setLevels] = useState<RuleLevelRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [detailStage, setDetailStage] = useState<StageKey | null>(null);

  const derivedInput = {
    expenseId: expense?.id || "",
    sapDocEntry: expense?.sap_doc_entry ?? null,
    sapDocNum: expense?.sap_doc_num ?? null,
    companyDb: expense?.company_db ?? null,
    supplierCode: expense?.supplier_code ?? null,
    enabled: open && !!expense,
  };
  const nfLinks = useNfEntradaLinks(derivedInput);
  const apLinks = useContasPagarLinks(derivedInput);

  useEffect(() => {
    if (!open || !expense) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const [logRes, levelsRes] = await Promise.all([
        supabase
          .from("expense_approval_log")
          .select("*")
          .eq("expense_id", expense.id)
          .order("decided_at", { ascending: true }),
        expense.approval_rule_id
          ? supabase
              .from("approval_rule_levels")
              .select("level_order, approver_name, approver_email")
              .eq("rule_id", expense.approval_rule_id)
              .order("level_order", { ascending: true })
          : Promise.resolve({ data: [] as RuleLevelRow[] }),
      ]);
      if (cancelled) return;
      setLog(((logRes as any).data || []) as ApprovalLogRow[]);
      setLevels(((levelsRes as any).data || []) as RuleLevelRow[]);
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, expense]);

  const stages = useMemo(() => {
    if (!expense) return [] as { key: StageKey; label: string; icon: any; state: "done" | "current" | "pending" | "skipped"; hasDoc: boolean }[];
    const currentIdx = ORDER.indexOf(expense.status as StageKey);
    const isBad = expense.status === "rejeitado" || expense.status === "cancelado";
    return STAGE_DEFS.map((s, i) => {
      const state: "done" | "current" | "pending" | "skipped" = isBad
        ? s.key === "rascunho"
          ? "done"
          : "skipped"
        : i < currentIdx
          ? "done"
          : i === currentIdx
            ? "current"
            : "pending";
      const reached = state === "done" || state === "current";
      const nfCount = nfLinks.data?.length || 0;
      const apCount = apLinks.data?.payables.length || 0;
      // hasDoc: there's something concrete to inspect at this stage
      const hasDoc =
        s.key === "rascunho" ||
        (s.key === "pendente_aprovacao" && (levels.length > 0 || log.length > 0)) ||
        (s.key === "aprovado" && reached) ||
        (s.key === "pc_lancado" && (!!expense.sap_doc_num || reached)) ||
        (s.key === "nf_entrada" && (nfCount > 0 || reached)) ||
        (s.key === "pagamento" && (apCount > 0 || reached)) ||
        (s.key === "finalizado" && reached);
      return { key: s.key, label: s.label, icon: s.icon, state, hasDoc };
    });
  }, [expense, levels.length, log.length, nfLinks.data, apLinks.data]);

  // Aprovadores: feitos, atual, próximos
  const approvedNames = useMemo(
    () =>
      new Set(
        log
          .filter((l) => l.decision === "approved" && l.approver_name)
          .map((l) => (l.approver_name as string).toLowerCase()),
      ),
    [log],
  );

  const approverRows = useMemo(() => {
    if (!expense) return [];
    return levels.map((lv) => {
      const done = approvedNames.has(lv.approver_name.toLowerCase());
      const isCurrent =
        !done &&
        !!expense.current_approver &&
        expense.current_approver.toLowerCase() === lv.approver_name.toLowerCase();
      return { ...lv, done, isCurrent };
    });
  }, [levels, approvedNames, expense]);

  const currentApproverRow = approverRows.find((r) => r.isCurrent);
  const nextApproverRows = approverRows.filter((r) => !r.done && !r.isCurrent);

  if (!expense) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-6xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <span>{title || "Mapa de Relações"}</span>
              {expense.sap_doc_num && (
                <Badge variant="outline" className="font-mono text-xs">
                  SAP #{expense.sap_doc_num}
                </Badge>
              )}
            </DialogTitle>
            <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {expense.supplier_name && <span>{expense.supplier_name}</span>}
              {expense.total_amount !== undefined && (
                <span className="font-mono">{formatCurrency(expense.total_amount, expense.currency)}</span>
              )}
              {expense.requester_name && <span>Solicitante: {expense.requester_name}</span>}
              <span>Criado: {formatDateTime(expense.created_at)}</span>
            </div>
          </DialogHeader>

          <div className="space-y-8 mt-4">
            {/* Fluxograma de etapas como cards */}
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                Fluxo do documento
              </h3>
              <div className="flex items-stretch gap-2 overflow-x-auto pb-2">
                {stages.map((s, i) => {
                  const Icon = s.icon;
                  const clickable = s.hasDoc;
                  const stateClasses =
                    s.state === "current"
                      ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                      : s.state === "done"
                        ? "border-success/40 bg-success/5"
                        : s.state === "skipped"
                          ? "border-border bg-muted/20 opacity-50"
                          : "border-dashed border-border bg-background";
                  const iconClasses =
                    s.state === "current"
                      ? "text-primary"
                      : s.state === "done"
                        ? "text-success"
                        : "text-muted-foreground";
                  return (
                    <div key={s.key} className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!clickable}
                        onClick={() => clickable && setDetailStage(s.key)}
                        className={`min-w-[150px] rounded-xl border p-3 text-left transition-all ${stateClasses} ${
                          clickable ? "hover:shadow-md hover:-translate-y-0.5 cursor-pointer" : "cursor-default"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <Icon className={`w-5 h-5 ${iconClasses}`} />
                          {s.state === "done" && <CircleCheck className="w-4 h-4 text-success" />}
                          {s.state === "current" && <Clock className="w-4 h-4 text-primary animate-pulse" />}
                          {s.state === "pending" && <CircleDashed className="w-4 h-4 text-muted-foreground" />}
                          {s.state === "skipped" && <Circle className="w-4 h-4 text-muted-foreground" />}
                        </div>
                        <div className={`text-sm font-medium ${s.state === "skipped" ? "line-through" : ""}`}>
                          {s.label}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">
                          {s.state === "current"
                            ? "Atual"
                            : s.state === "done"
                              ? "Concluído"
                              : s.state === "skipped"
                                ? "Ignorado"
                                : "Pendente"}
                        </div>
                      </button>
                      {i < stages.length - 1 && (
                        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Clique em uma etapa para ver detalhes do documento.
              </p>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Trilha de aprovações: atual + próximos */}
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Aprovadores
                </h3>

                {currentApproverRow && (
                  <div className="mb-3 p-3 rounded-lg border-2 border-primary/40 bg-primary/5">
                    <div className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-1">
                      Aprovador atual
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                        {currentApproverRow.level_order}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{currentApproverRow.approver_name}</div>
                        {currentApproverRow.approver_email && (
                          <div className="text-xs text-muted-foreground truncate">{currentApproverRow.approver_email}</div>
                        )}
                      </div>
                      <Badge className="gap-1">
                        <Clock className="w-3 h-3" /> Aguardando
                      </Badge>
                    </div>
                  </div>
                )}

                {nextApproverRows.length > 0 && (
                  <>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                      Próximos
                    </div>
                    <div className="space-y-1.5 mb-3">
                      {nextApproverRows.map((lv) => (
                        <div
                          key={`${lv.level_order}-${lv.approver_name}`}
                          className="flex items-center gap-3 p-2 rounded-lg border border-dashed border-border"
                        >
                          <div className="w-6 h-6 rounded-full bg-muted text-xs font-medium flex items-center justify-center">
                            {lv.level_order}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm">{lv.approver_name}</div>
                            {lv.approver_email && (
                              <div className="text-xs text-muted-foreground truncate">{lv.approver_email}</div>
                            )}
                          </div>
                          <Badge variant="outline" className="gap-1 text-muted-foreground text-xs">
                            Próximo
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {approverRows.filter((r) => r.done).length > 0 && (
                  <>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                      Já aprovado por
                    </div>
                    <div className="space-y-1.5">
                      {approverRows
                        .filter((r) => r.done)
                        .map((lv) => (
                          <div
                            key={`done-${lv.level_order}-${lv.approver_name}`}
                            className="flex items-center gap-3 p-2 rounded-lg border border-success/30 bg-success/5"
                          >
                            <div className="w-6 h-6 rounded-full bg-success/20 text-success text-xs font-medium flex items-center justify-center">
                              {lv.level_order}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm">{lv.approver_name}</div>
                            </div>
                            <ShieldCheck className="w-4 h-4 text-success" />
                          </div>
                        ))}
                    </div>
                  </>
                )}

                {approverRows.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nenhum aprovador previsto (regra de aprovação não associada).
                  </p>
                )}
              </section>

              {/* Trilha histórica */}
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Histórico de eventos
                </h3>
                {isLoading ? (
                  <p className="text-sm text-muted-foreground">Carregando…</p>
                ) : log.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum evento registrado ainda.</p>
                ) : (
                  <ol className="space-y-3 relative border-l border-border ml-2 pl-4">
                    {log.map((row) => {
                      const meta = DECISION_META[row.decision];
                      const Icon = meta.icon;
                      return (
                        <li key={row.id} className="relative">
                          <span className="absolute -left-[22px] top-0.5 w-4 h-4 rounded-full bg-background border border-border flex items-center justify-center">
                            <Icon className={`w-3 h-3 ${meta.color}`} />
                          </span>
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="text-sm font-medium">{meta.label}</div>
                            <div className="text-xs text-muted-foreground font-mono shrink-0">
                              {formatDateTime(row.decided_at)}
                            </div>
                          </div>
                          {row.approver_name && (
                            <div className="text-xs text-muted-foreground">
                              {row.approver_name}
                              {row.approver_email ? ` · ${row.approver_email}` : ""}
                              {row.level_order ? ` · nível ${row.level_order}` : ""}
                            </div>
                          )}
                          {row.remarks && (
                            <div className="text-xs bg-muted/40 rounded p-2 mt-1.5">{row.remarks}</div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Popup de detalhes da etapa */}
      <StageDetailDialog
        stage={detailStage}
        expense={expense}
        log={log}
        approverRows={approverRows}
        nfLinks={nfLinks.data || []}
        nfLoading={nfLinks.isLoading}
        apPayables={apLinks.data?.payables || []}
        apLoading={apLinks.isLoading}
        onClose={() => setDetailStage(null)}
      />
    </>
  );
}

interface StageDetailProps {
  stage: StageKey | null;
  expense: RelationsMapExpense;
  log: ApprovalLogRow[];
  approverRows: (RuleLevelRow & { done: boolean; isCurrent: boolean })[];
  nfLinks: NfEntradaLink[];
  nfLoading: boolean;
  apPayables: ContaPagarLink[];
  apLoading: boolean;
  onClose: () => void;
}

function StageDetailDialog({ stage, expense, log, approverRows, nfLinks, nfLoading, apPayables, apLoading, onClose }: StageDetailProps) {
  if (!stage) return null;
  const def = STAGE_DEFS.find((s) => s.key === stage);
  if (!def) return null;
  const Icon = def.icon;

  const renderBody = () => {
    switch (stage) {
      case "rascunho": {
        const createdLog = log.find((l) => l.decision === "created");
        return (
          <DetailGrid
            rows={[
              ["Solicitante", expense.requester_name || "—"],
              ["E-mail", expense.requester_email || "—"],
              ["Fornecedor", expense.supplier_name || "—"],
              ["Código fornecedor", expense.supplier_code || "—"],
              ["Valor total", formatCurrency(expense.total_amount, expense.currency)],
              ["Criado em", formatDateTime(expense.created_at)],
              ["Por", createdLog?.approver_name || expense.requester_name || "—"],
            ]}
          />
        );
      }
      case "pendente_aprovacao": {
        const current = approverRows.find((r) => r.isCurrent);
        const next = approverRows.filter((r) => !r.done && !r.isCurrent);
        return (
          <div className="space-y-3">
            <DetailGrid
              rows={[
                ["Aprovador atual", current ? `${current.approver_name} (nível ${current.level_order})` : "—"],
                ["E-mail atual", current?.approver_email || "—"],
                ["Próximos níveis", next.length > 0 ? next.map((n) => `${n.level_order}. ${n.approver_name}`).join(" → ") : "—"],
                ["Total de níveis", String(approverRows.length || "—")],
              ]}
            />
          </div>
        );
      }
      case "aprovado": {
        const approved = log.filter((l) => l.decision === "approved");
        return (
          <DetailGrid
            rows={[
              ["Aprovações registradas", String(approved.length)],
              ["Último aprovador", approved[approved.length - 1]?.approver_name || "—"],
              ["Em", formatDateTime(approved[approved.length - 1]?.decided_at)],
            ]}
          />
        );
      }
      case "pc_lancado": {
        const integrated = log.find((l) => l.decision === "integrated");
        return (
          <DetailGrid
            rows={[
              ["Nº SAP", expense.sap_doc_num ? `#${expense.sap_doc_num}` : "—"],
              ["DocEntry", expense.sap_doc_entry ? String(expense.sap_doc_entry) : "—"],
              ["Integrado em", formatDateTime(integrated?.decided_at)],
            ]}
          />
        );
      }
      case "nf_entrada":
        return (
          <DetailGrid
            rows={[
              ["Status", STATUS_LABELS[expense.status as keyof typeof STATUS_LABELS] || expense.status],
              ["Atualizado em", formatDateTime(expense.updated_at)],
            ]}
          />
        );
      case "pagamento":
        return (
          <DetailGrid
            rows={[
              ["Valor", formatCurrency(expense.total_amount, expense.currency)],
              ["Fornecedor", expense.supplier_name || "—"],
              ["Atualizado em", formatDateTime(expense.updated_at)],
            ]}
          />
        );
      case "finalizado":
        return (
          <DetailGrid
            rows={[
              ["Status", STATUS_LABELS[expense.status as keyof typeof STATUS_LABELS] || expense.status],
              ["Concluído em", formatDateTime(expense.updated_at)],
            ]}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={!!stage} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-primary" />
            {def.label}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-2">{renderBody()}</div>
      </DialogContent>
    </Dialog>
  );
}

function DetailGrid({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y divide-border">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-3 gap-2 py-2">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="col-span-2 text-sm font-medium break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
