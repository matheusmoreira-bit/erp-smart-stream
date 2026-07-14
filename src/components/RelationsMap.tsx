import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Send,
  ShieldCheck,
  Ban,
  AlertTriangle,
  Cable,
  FileCheck2,
  Receipt,
  Wallet,
  Sparkles,
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
import { RelationsMapFlow } from "./RelationsMapFlow";

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

interface SapHistoryRow {
  id: string;
  approver_name: string | null;
  approver_email: string | null;
  decision: string | null; // 'Y' aprovado, 'N' rejeitado, 'W'/'P' pendente
  decision_date: string | null;
  step: number | null;
  stage_name: string | null;
  remarks: string | null;
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
  sap_integration_error?: string | null;
  sap_integration_last_attempt_at?: string | null;
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
  { key: "finalizado", label: "Finalizado", icon: CheckCircle2 },
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
  const [sapHistory, setSapHistory] = useState<SapHistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [detailStage, setDetailStage] = useState<StageKey | null>(null);
  const [enriched, setEnriched] = useState(false);

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

  // Une pagamentos SAP (VendorPayments) às NFs pelo DocEntry da fatura.
  const nfLinksWithPayments = useMemo(() => {
    const raw = nfLinks.data || [];
    const byInv = apLinks.data?.paymentsByInvoice || {};
    if (!raw.length || Object.keys(byInv).length === 0) return raw;
    return raw.map((nf) => {
      const de = nf.sap_invoice_draft_id ? Number(nf.sap_invoice_draft_id) : null;
      if (!de || !byInv[de]?.length) return nf;
      const extra = byInv[de].map((p) => ({
        ap_doc_entry: String(p.DocEntry),
        ap_doc_num: String(p.DocNum),
        ap_total: p.appliedByInvoice[de] ?? p.DocTotal,
        ap_paid: p.appliedByInvoice[de] ?? p.DocTotal,
        source: "sap" as const,
        linked_at: p.DocDate,
        notes: p.Remarks,
        payment_doc_entry: p.DocEntry,
        payment_doc_num: p.DocNum,
        payment_date: p.DocDate,
      }));
      // dedup por ap_doc_entry (evita duplicar se já veio de nf_entrada_contas_pagar)
      const seen = new Set(nf.ap_links.map((l) => l.ap_doc_entry));
      const merged = [...nf.ap_links, ...extra.filter((l) => !seen.has(l.ap_doc_entry))];
      return { ...nf, ap_links: merged };
    });
  }, [nfLinks.data, apLinks.data]);

  useEffect(() => {
    if (!open || !expense) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const [logRes, levelsRes, sapRes] = await Promise.all([
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
        expense.sap_doc_entry && expense.company_db
          ? supabase
              .from("approval_history")
              .select("id, approver_name, approver_email, decision, decision_date, step, stage_name, remarks")
              .eq("company_db", expense.company_db)
              .eq("doc_entry", expense.sap_doc_entry)
              .order("step", { ascending: true })
          : Promise.resolve({ data: [] as SapHistoryRow[] }),
      ]);
      if (cancelled) return;
      setLog(((logRes as any).data || []) as ApprovalLogRow[]);
      setLevels(((levelsRes as any).data || []) as RuleLevelRow[]);
      setSapHistory(((sapRes as any).data || []) as SapHistoryRow[]);
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
        (s.key === "pendente_aprovacao" && (levels.length > 0 || log.length > 0 || sapHistory.length > 0)) ||
        (s.key === "aprovado" && reached) ||
        (s.key === "pc_lancado" && (!!expense.sap_doc_num || reached)) ||
        (s.key === "nf_entrada" && (nfCount > 0 || reached)) ||
        (s.key === "pagamento" && (apCount > 0 || reached)) ||
        (s.key === "finalizado" && reached);
      return { key: s.key, label: s.label, icon: s.icon, state, hasDoc };
    });
  }, [expense, levels.length, log.length, sapHistory.length, nfLinks.data, apLinks.data]);

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

  // Chain unificada: preferimos a regra local; senão, reconstruímos a partir do
  // histórico SAP (approval_history) — mostra anteriores, atual e próximos com
  // decisão registrada (aprovado/rejeitado/pendente).
  type ChainRow = {
    level_order: number;
    approver_name: string;
    approver_email: string | null;
    done: boolean;
    isCurrent: boolean;
    rejected?: boolean;
    decidedAt?: string | null;
    remarks?: string | null;
    stageName?: string | null;
    source: "rule" | "sap";
  };

  const approverRows: ChainRow[] = useMemo(() => {
    if (!expense) return [];
    // Regra global: só existe "aprovador atual" enquanto o documento está
    // efetivamente pendente. Se o documento foi aprovado/integrado, todos
    // os níveis de todas as ramificações são considerados concluídos.
    const stillPending = isPendingApproval(expense.status);
    const isRejectedDoc = expense.status === "rejeitado" || expense.status === "cancelado";
    const isFinalized = !stillPending && !isRejectedDoc; // aprovado/integrado

    if (levels.length > 0) {
      return levels.map((lv) => {
        const doneByLog = approvedNames.has(lv.approver_name.toLowerCase());
        const done = doneByLog || isFinalized;
        const isCurrent =
          stillPending &&
          !done &&
          !!expense.current_approver &&
          expense.current_approver.toLowerCase() === lv.approver_name.toLowerCase();
        return { ...lv, done, isCurrent, source: "rule" as const };
      });
    }
    // Fallback: reconstrói a partir do SAP approval_history
    if (sapHistory.length === 0 && !expense.current_approver) return [];
    const sorted = [...sapHistory].sort(
      (a, b) => (a.step ?? 0) - (b.step ?? 0),
    );
    const rows: ChainRow[] = sorted
      .filter((r) => (r.approver_name || r.approver_email))
      .map((r, i) => {
        const dec = (r.decision || "").toUpperCase();
        const approvedByDecision = dec === "Y" || dec === "APPROVED";
        const rejected = dec === "N" || dec === "REJECTED";
        const approved = approvedByDecision || (isFinalized && !rejected);
        return {
          level_order: r.step ?? i + 1,
          approver_name: r.approver_name || r.approver_email || "—",
          approver_email: r.approver_email,
          done: approved,
          rejected,
          isCurrent: false,
          decidedAt: r.decision_date,
          remarks: r.remarks,
          stageName: r.stage_name,
          source: "sap" as const,
        };
      });
    // Só há "aprovador atual" enquanto o doc está pendente.
    if (stillPending) {
      if (
        expense.current_approver &&
        !rows.some(
          (r) => r.approver_name.toLowerCase() === expense.current_approver!.toLowerCase() && !r.done && !r.rejected,
        )
      ) {
        const maxStep = rows.reduce((m, r) => Math.max(m, r.level_order), 0);
        rows.push({
          level_order: maxStep + 1,
          approver_name: expense.current_approver,
          approver_email: null,
          done: false,
          isCurrent: true,
          source: "sap",
        });
      } else {
        // marca o primeiro sem decisão como atual
        const firstPending = rows.find((r) => !r.done && !r.rejected);
        if (firstPending) firstPending.isCurrent = true;
      }
    }
    return rows;
  }, [levels, approvedNames, expense, sapHistory]);


  const currentApproverRow = approverRows.find((r) => r.isCurrent);
  const nextApproverRows = approverRows.filter((r) => !r.done && !r.rejected && !r.isCurrent);



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

          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-muted-foreground">
                Arraste os nós, use scroll para dar zoom. Clique em uma etapa para ver detalhes.
              </div>
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
                <Sparkles className="w-3.5 h-3.5 text-cactus-amber" />
                Enriquecer
                <Switch checked={enriched} onCheckedChange={setEnriched} />
              </label>
            </div>

            {isLoading ? (
              <div className="h-[65vh] flex items-center justify-center text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Montando o mapa…
              </div>
            ) : (
              <RelationsMapFlow
                expense={expense}
                approverRows={approverRows}
                nfLinks={nfLinksWithPayments}
                apPayables={apLinks.data?.payables || []}
                enriched={enriched}
                onNodeClick={(id) => {
                  if (id === "root") setDetailStage("pc_lancado");
                  else if (id === "requester") setDetailStage("rascunho");
                  else if (id === "status") setDetailStage("finalizado");
                  else if (id.startsWith("app-")) setDetailStage("pendente_aprovacao");
                  else if (id.startsWith("nf-ap-") || id.startsWith("orphan-ap-")) setDetailStage("pagamento");
                  else if (id.startsWith("nf-")) setDetailStage("nf_entrada");
                }}
              />
            )}

            {(nfLinks.isLoading || apLinks.isLoading) && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Buscando NFs e contas a pagar…
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Popup de detalhes da etapa */}
      <StageDetailDialog
        stage={detailStage}
        expense={expense}
        log={log}
        approverRows={approverRows}
        nfLinks={nfLinksWithPayments}
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
          <div className="space-y-3">
            <DetailGrid
              rows={[
                ["Status do PC", STATUS_LABELS[expense.status as keyof typeof STATUS_LABELS] || expense.status],
                ["NFs vinculadas", nfLoading ? "Carregando…" : String(nfLinks.length)],
              ]}
            />
            {nfLoading && nfLinks.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" /> Buscando NFs de entrada…
              </div>
            ) : nfLinks.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma NF de entrada vinculada a este pedido.
              </p>
            ) : (
              <ul className="space-y-2">
                {nfLinks.map((nf) => (
                  <li key={nf.id} className="border border-border/60 rounded-lg p-2.5 text-xs bg-muted/10">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">
                        NF {nf.numero_nf || "—"}{nf.serie ? `/${nf.serie}` : ""}
                      </span>
                      <span className="font-mono">{formatCurrency(nf.valor_total ?? undefined, expense.currency)}</span>
                    </div>
                    <div className="text-muted-foreground truncate">{nf.nome_fornecedor || "—"}</div>
                    <div className="flex items-center justify-between mt-1">
                      <Badge variant="outline" className="text-[10px]">{nf.status}</Badge>
                      <span className="font-mono text-[10px] text-muted-foreground">{formatDateTime(nf.created_at)}</span>
                    </div>
                    {nf.chave_acesso && (
                      <div className="font-mono text-[10px] text-muted-foreground mt-1 break-all">
                        {nf.chave_acesso}
                      </div>
                    )}
                    {nf.ap_links && nf.ap_links.length > 0 && (
                      <div className="mt-2 pl-2 border-l-2 border-primary/30 space-y-1">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Contas a pagar vinculadas ({nf.ap_links.length})
                        </div>
                        {nf.ap_links.map((ap) => (
                          <div key={`${ap.source}-${ap.ap_doc_entry}`} className="flex items-baseline justify-between gap-2 text-[11px]">
                            <span>
                              <Badge variant="outline" className="text-[9px] uppercase mr-1">{ap.source}</Badge>
                              Doc {ap.ap_doc_num || ap.ap_doc_entry}
                            </span>
                            <span className="font-mono">{formatCurrency(ap.ap_total ?? undefined, expense.currency)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      case "pagamento":
        return (
          <div className="space-y-3">
            <DetailGrid
              rows={[
                ["Valor do pedido", formatCurrency(expense.total_amount, expense.currency)],
                ["Fornecedor", expense.supplier_name || "—"],
                ["Títulos encontrados", apLoading ? "Carregando…" : String(apPayables.length)],
              ]}
            />
            {apLoading && apPayables.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" /> Consultando contas a pagar no ERP…
              </div>
            ) : apPayables.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum título de contas a pagar encontrado para este pedido.
              </p>
            ) : (
              <ul className="space-y-2">
                {apPayables.map((ap) => (
                  <li key={ap.id} className="border border-border/60 rounded-lg p-2.5 text-xs bg-muted/10">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">Doc {ap.numero_documento || "—"}</span>
                      <span className="font-mono">{formatCurrency(ap.valor_documento ?? undefined, expense.currency)}</span>
                    </div>
                    <div className="text-muted-foreground truncate">{ap.fornecedor || "—"}</div>
                    <div className="flex items-center justify-between mt-1 gap-2">
                      <Badge variant="outline" className="text-[10px] uppercase">{ap.source}</Badge>
                      {ap.status && <span className="text-[10px]">{ap.status}</span>}
                      <span className="font-mono text-[10px] text-muted-foreground">
                        Venc: {ap.data_vencimento ? formatDateTime(ap.data_vencimento).split(" ")[0] : "—"}
                      </span>
                    </div>
                    {ap.valor_pago !== null && ap.valor_pago !== undefined && (
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Pago: <span className="font-mono">{formatCurrency(ap.valor_pago, expense.currency)}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
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
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
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
